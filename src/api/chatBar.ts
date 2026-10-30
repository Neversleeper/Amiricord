/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Buttons for the row of buttons at the right of the message box (next to the gift, GIF and emoji buttons): `ctx.chatBar.add({ id, label, icon, onClick })`. They go away
// when the plugin stops. Written from scratch. The buttons are put in the page by hand, not through Discord's React code: Vencord's way (a patch on the text `"sticker")`)
// no longer finds its place in Discord build 655747, and the row can be found without it: it is the element whose class name contains "buttons" inside the form that has
// the message box (checked live on build 655747, class `buttons__74017`). Discord redraws that row now and then, so a watcher puts missing buttons back. When Discord
// changes the name of that class the buttons do not show (nothing breaks). Not covered: buttons that appear only in some chats, a button that opens a menu of its own.

export interface ChatBarIcon {
    /** The `viewBox` of the picture, for example "0 0 24 24". */
    viewBox: string;
    /** The `d` of one SVG path, drawn with the colour of the other icons. */
    path: string;
}

export interface ChatBarButton {
    /** Unique among the plugin's own buttons. */
    id: string;
    /** The text of the tooltip and the screen reader label; a function when it changes (an on/off button). */
    label: string | (() => string);
    icon: ChatBarIcon;
    onClick(): void;
    /** Whether the button looks switched on (the icon turns green). */
    active?(): boolean;
}

export interface PluginChatBar {
    /** Adds a button. Returns false (and adds nothing) for a bad definition or an id that this plugin already uses. */
    add(button: ChatBarButton): boolean;
    /** Draws the buttons again, for when `label` or `active` now answer something else. */
    refresh(): void;
}

export const MAX_BUTTONS_PER_PLUGIN = 5;
export const BUTTON_ATTRIBUTE = "data-amiricord-chatbar";
const STYLE_NAME = "chat-bar";
const SYNC_DELAY_MS = 60;
const BODY_WAIT_MS = 100;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const CHAT_BAR_CSS = `
.amiricord-chatbar-button { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; margin: 0 2px; padding: 0; border: 0; background: none; cursor: pointer; color: var(--interactive-icon-default, var(--channel-icon, #b5bac1)); }
.amiricord-chatbar-button:hover { color: var(--interactive-icon-hover, var(--interactive-hover, #dbdee1)); }
.amiricord-chatbar-button[data-active="true"] { color: var(--green-360, #23a55a); }
.amiricord-chatbar-button svg { width: 20px; height: 20px; fill: currentColor; pointer-events: none; }
`;

/** What to do to a row that has the buttons `present` when the buttons `wanted` should be there (both are lists of keys, `wanted` in the order to show). */
export function planSync(present: readonly string[], wanted: readonly string[]): { add: string[]; remove: string[]; } {
    return { add: wanted.filter(key => !present.includes(key)), remove: present.filter(key => !wanted.includes(key)) };
}

interface Entry { plugin: string; button: ChatBarButton; }

export interface ChatBarPage {
    document: Document;
    MutationObserver: typeof MutationObserver;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

const keyOf = (plugin: string, id: string) => `${plugin}:${id}`;

export class ChatBarHub {
    private readonly entries = new Map<string, Entry>();
    private observer: MutationObserver | undefined;
    private timer: unknown;
    private styled = false;

    constructor(private readonly page: ChatBarPage, private readonly addStyle: (css: string, name: string) => void, private readonly onError: (plugin: string, source: string, error: unknown) => void) { }

    add(plugin: string, button: ChatBarButton): boolean {
        if (typeof button?.id !== "string" || button.id.length === 0 || typeof button.onClick !== "function" || typeof button.icon?.path !== "string" || typeof button.icon.viewBox !== "string") return false;
        const label = typeof button.label === "function" ? button.label() : button.label;
        if (typeof label !== "string" || label.length === 0) return false;
        const key = keyOf(plugin, button.id);
        if (this.entries.has(key)) return false;
        if ([...this.entries.values()].filter(entry => entry.plugin === plugin).length >= MAX_BUTTONS_PER_PLUGIN) return false;
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
        // A plugin that starts before the page has a body (the "init" stage) gets its buttons as soon as the body exists
        const body = this.page.document.body as HTMLElement | null;
        if (!body) {
            this.page.setTimeout(() => { if (this.entries.size > 0) this.start(); }, BODY_WAIT_MS);
            return;
        }
        if (!this.styled) { this.styled = true; this.addStyle(CHAT_BAR_CSS, STYLE_NAME); }
        this.observer = new this.page.MutationObserver(() => { this.schedule(); });
        this.observer.observe(body, { childList: true, subtree: true });
        this.schedule();
    }

    private stop(): void {
        this.observer?.disconnect();
        this.observer = undefined;
    }

    private schedule(): void {
        if (this.timer !== undefined) return;
        this.timer = this.page.setTimeout(() => { this.timer = undefined; this.sync(); }, SYNC_DELAY_MS);
    }

    /** The rows of buttons of every message box on the page. */
    private rows(): Element[] {
        const rows: Element[] = [];
        for (const editor of this.page.document.querySelectorAll("[role=\"textbox\"][data-slate-editor=\"true\"]")) {
            const row = editor.closest("form")?.querySelector("[class*=\"buttons\"]");
            if (row && !rows.includes(row)) rows.push(row);
        }
        return rows;
    }

    private sync(): void {
        const doc = this.page.document;
        const wanted = [...this.entries.keys()];
        // Buttons left behind by a plugin that stopped.
        for (const element of doc.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`)) if (!wanted.includes(element.getAttribute(BUTTON_ATTRIBUTE) ?? "")) element.remove();
        for (const row of this.rows()) {
            const here = [...row.children].map(child => child.getAttribute(BUTTON_ATTRIBUTE)).filter((key): key is string => key !== null);
            for (const key of planSync(here, wanted).add) {
                const entry = this.entries.get(key);
                if (entry) row.append(this.draw(key, entry));
            }
            for (const element of row.children) {
                const key = element.getAttribute(BUTTON_ATTRIBUTE);
                const entry = key === null ? undefined : this.entries.get(key);
                if (entry) this.update(element, entry);
            }
        }
    }

    private draw(key: string, entry: Entry): HTMLElement {
        const doc = this.page.document;
        const element = doc.createElement("div");
        element.className = "amiricord-chatbar-button";
        element.setAttribute(BUTTON_ATTRIBUTE, key);
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
        svg.setAttribute("viewBox", entry.button.icon.viewBox);
        svg.setAttribute("aria-hidden", "true");
        const path = doc.createElementNS(SVG_NAMESPACE, "path");
        path.setAttribute("d", entry.button.icon.path);
        svg.append(path);
        element.append(svg);
        const run = () => {
            try { entry.button.onClick(); } catch (error) { this.onError(entry.plugin, `chat bar button ${entry.button.id}`, error); }
            this.schedule();
        };
        element.addEventListener("click", run);
        element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); run(); } });
        return element;
    }

    private update(element: Element, entry: Entry): void {
        let label = "";
        let active = false;
        try { label = typeof entry.button.label === "function" ? entry.button.label() : entry.button.label; } catch (error) { this.onError(entry.plugin, `chat bar label ${entry.button.id}`, error); }
        try { active = entry.button.active?.() === true; } catch (error) { this.onError(entry.plugin, `chat bar state ${entry.button.id}`, error); }
        if (element.getAttribute("aria-label") !== label) { element.setAttribute("aria-label", label); element.setAttribute("title", label); }
        const state = active ? "true" : "false";
        if (element.getAttribute("data-active") !== state) element.setAttribute("data-active", state);
    }
}

export function buildChatBar(hub: ChatBarHub, plugin: string, onDispose: (callback: () => void) => void): PluginChatBar {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(button) { return hub.add(plugin, button); },
        refresh() { hub.refresh(); }
    };
}
