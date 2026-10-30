/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Buttons for the row of icons in the header of a channel (next to the pins, members and search icons): `ctx.headerBar.add({ id, label, icon, onClick })`. They go away
// when the plugin stops. Written from scratch, in the same way as `chatBar.ts`: the buttons are put in the page by hand and a watcher puts back the ones Discord redraws
// away. The row is the element whose class name contains "toolbar" inside the channel header; when Discord renames it the buttons do not show (nothing breaks).
// Not covered: buttons that open a menu, buttons only in some kinds of channel.

import type { ChatBarIcon } from "./chatBar";

export interface HeaderBarButton {
    /** Unique among the plugin's own buttons. */
    id: string;
    /** The text of the tooltip and the screen reader label; a function when it changes. */
    label: string | (() => string);
    icon: ChatBarIcon;
    onClick(): void;
    /** Whether the button looks switched on. */
    active?(): boolean;
}

export interface PluginHeaderBar {
    /** Adds a button. Returns false (and adds nothing) for a bad definition or an id that this plugin already uses. */
    add(button: HeaderBarButton): boolean;
    /** Draws the buttons again, for when `label` or `active` now answer something else. */
    refresh(): void;
}

export const MAX_HEADER_BUTTONS_PER_PLUGIN = 3;
export const HEADER_BUTTON_ATTRIBUTE = "data-amiricord-headerbutton";
const STYLE_NAME = "header-bar";
const SYNC_DELAY_MS = 100;
const BODY_WAIT_MS = 100;
/** Where the row of icons may be, most specific first. */
export const TOOLBAR_SELECTORS: readonly string[] = [
    "section[aria-label=\"Channel header\"] [class*=\"toolbar\"]",
    "[class*=\"title_\"] [class*=\"toolbar\"]",
    "[class*=\"upperContainer\"] [class*=\"toolbar\"]"
];

export const HEADER_BAR_CSS = `
[${HEADER_BUTTON_ATTRIBUTE}] { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin: 0 8px; padding: 0; border: 0; background: transparent; color: var(--interactive-normal, #b5bac1); cursor: pointer; }
[${HEADER_BUTTON_ATTRIBUTE}]:hover { color: var(--interactive-hover, #dbdee1); }
[${HEADER_BUTTON_ATTRIBUTE}][data-active="true"] { color: var(--status-positive, #23a55a); }
`;

interface Entry { plugin: string; button: HeaderBarButton; }

export interface HeaderBarPage {
    document: Document;
    MutationObserver: typeof MutationObserver;
    setTimeout(run: () => void, ms: number): unknown;
}

const keyOf = (plugin: string, id: string) => `${plugin}:${id}`;
const labelOf = (button: HeaderBarButton) => (typeof button.label === "function" ? button.label() : button.label);

export class HeaderBarHub {
    private readonly entries = new Map<string, Entry>();
    private observer: MutationObserver | undefined;
    private timer: unknown;
    private styled = false;

    constructor(private readonly page: HeaderBarPage, private readonly addStyle: (css: string, name: string) => void, private readonly onError: (plugin: string, source: string, error: unknown) => void) {}

    add(plugin: string, button: HeaderBarButton): boolean {
        if (typeof button?.id !== "string" || button.id.length === 0 || typeof button.onClick !== "function" || typeof button.icon?.path !== "string" || typeof button.icon.viewBox !== "string") return false;
        const key = keyOf(plugin, button.id);
        if (this.entries.has(key)) return false;
        if ([...this.entries.values()].filter(entry => entry.plugin === plugin).length >= MAX_HEADER_BUTTONS_PER_PLUGIN) return false;
        this.entries.set(key, { plugin, button });
        this.start();
        this.schedule();
        return true;
    }

    removeAll(plugin: string): void {
        for (const [key, entry] of this.entries) if (entry.plugin === plugin) this.entries.delete(key);
        this.schedule();
        if (this.entries.size === 0) this.stop();
    }

    refresh(): void { this.schedule(); }

    private start(): void {
        if (this.observer) return;
        const body = this.page.document.body as HTMLElement | null;
        if (!body) {
            this.page.setTimeout(() => { if (this.entries.size > 0) this.start(); }, BODY_WAIT_MS);
            return;
        }
        if (!this.styled) { this.styled = true; this.addStyle(HEADER_BAR_CSS, STYLE_NAME); }
        this.observer = new this.page.MutationObserver(() => { this.schedule(); });
        this.observer.observe(body, { childList: true, subtree: true });
    }

    private stop(): void {
        this.observer?.disconnect();
        this.observer = undefined;
    }

    private schedule(): void {
        if (this.timer !== undefined) return;
        this.timer = this.page.setTimeout(() => { this.timer = undefined; this.sync(); }, SYNC_DELAY_MS);
    }

    private toolbar(): Element | null {
        for (const selector of TOOLBAR_SELECTORS) {
            const found = this.page.document.querySelector(selector);
            if (found) return found;
        }
        return null;
    }

    private sync(): void {
        const doc = this.page.document;
        for (const element of doc.querySelectorAll(`[${HEADER_BUTTON_ATTRIBUTE}]`)) {
            if (!this.entries.has(element.getAttribute(HEADER_BUTTON_ATTRIBUTE) ?? "")) element.remove();
        }
        if (this.entries.size === 0) return;
        const toolbar = this.toolbar();
        if (!toolbar) return;
        for (const [key, entry] of this.entries) {
            let element = toolbar.querySelector(`[${HEADER_BUTTON_ATTRIBUTE}="${key}"]`);
            if (!element) {
                element = this.make(key, entry);
                toolbar.prepend(element);
            }
            let label = "";
            let active = false;
            try { label = labelOf(entry.button); active = entry.button.active?.() ?? false; } catch (error) { this.onError(entry.plugin, `header button ${entry.button.id}`, error); }
            if (element.getAttribute("aria-label") !== label) { element.setAttribute("aria-label", label); element.setAttribute("title", label); }
            element.setAttribute("data-active", String(active));
        }
    }

    private make(key: string, entry: Entry): Element {
        const doc = this.page.document;
        const element = doc.createElement("button");
        element.setAttribute("type", "button");
        element.setAttribute(HEADER_BUTTON_ATTRIBUTE, key);
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", entry.button.icon.viewBox);
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("aria-hidden", "true");
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("fill", "currentColor");
        path.setAttribute("d", entry.button.icon.path);
        svg.append(path);
        element.append(svg);
        element.addEventListener("click", () => {
            try { entry.button.onClick(); } catch (error) { this.onError(entry.plugin, `header button ${entry.button.id}`, error); }
            this.schedule();
        });
        return element;
    }
}

export function buildHeaderBar(hub: HeaderBarHub, plugin: string, onDispose: (callback: () => void) => void): PluginHeaderBar {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(button) { return hub.add(plugin, button); },
        refresh() { hub.refresh(); }
    };
}
