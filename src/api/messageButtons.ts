/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Buttons for the small bar that appears over a message when the pointer is on it (reply, react, more...): `ctx.messageButtons.add({ id, label, icon, onClick })`. They go
// away when the plugin stops. Written from scratch. Like the chat bar, the buttons are put in the page by hand, not through Discord's React code. Checked live on Discord
// build 655747: the bar is `div.buttonContainer_*` > `div[role="group"].buttons_*` > `div.buttonsInner_*` > one `span` per button > `div.hoverBarButton_* [role="button"]` with
// an `svg.icon_*`, inside the message's `li#chat-messages-<channel>-<message>`. The new button copies the classes of a button Discord already drew in that bar, so it looks
// like the others after Discord renames its classes; the bar is found by the words "buttonContainer" and "buttonsInner" in class names. When Discord changes those the
// buttons do not show (nothing breaks). Not covered: a button that opens a menu of its own, and the bar of a message in search results or in a thread preview.

import type { ChatBarIcon } from "./chatBar";
import { planSync } from "./chatBar";

export interface MessageRef {
    channelId: string;
    messageId: string;
}

export interface MessageButton {
    /** Unique among the plugin's own buttons. */
    id: string;
    /** The text of the tooltip and the screen reader label. */
    label: string | (() => string);
    icon: ChatBarIcon;
    onClick(message: MessageRef): void;
    /** Whether the button shows over this message. Asked each time the bar is drawn; a button without it shows over every message. */
    shouldShow?(message: MessageRef): boolean;
}

export interface PluginMessageButtons {
    /** Adds a button. Returns false (and adds nothing) for a bad definition or an id that this plugin already uses. */
    add(button: MessageButton): boolean;
    /** Draws the buttons again, for when `label` or `shouldShow` now answer something else. */
    refresh(): void;
}

export const MAX_MESSAGE_BUTTONS_PER_PLUGIN = 5;
export const MESSAGE_BUTTON_ATTRIBUTE = "data-amiricord-msgbutton";
const STYLE_NAME = "message-buttons";
const SYNC_DELAY_MS = 16;
const BODY_WAIT_MS = 100;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MESSAGE_ID = /^chat-messages-(?:\d+-)?(\d{15,25})-(\d{15,25})$/;

export const MESSAGE_BUTTONS_CSS = `
[${MESSAGE_BUTTON_ATTRIBUTE}] { cursor: pointer; }
[${MESSAGE_BUTTON_ATTRIBUTE}][data-active="true"] { color: var(--green-360, #23a55a); }
[${MESSAGE_BUTTON_ATTRIBUTE}] svg { fill: currentColor; }
`;

interface Entry { plugin: string; button: MessageButton; }

export interface MessageButtonsPage {
    document: Document;
    MutationObserver: typeof MutationObserver;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

const keyOf = (plugin: string, id: string) => `${plugin}:${id}`;

/** The channel and message of a message list entry, from its id; undefined for anything else. */
export function messageOfId(id: string | null | undefined): MessageRef | undefined {
    const found = MESSAGE_ID.exec(id ?? "");
    return found ? { channelId: found[1], messageId: found[2] } : undefined;
}

export class MessageButtonsHub {
    private readonly entries = new Map<string, Entry>();
    private observer: MutationObserver | undefined;
    private timer: unknown;
    private styled = false;

    constructor(private readonly page: MessageButtonsPage, private readonly addStyle: (css: string, name: string) => void, private readonly onError: (plugin: string, source: string, error: unknown) => void) { }

    add(plugin: string, button: MessageButton): boolean {
        if (typeof button?.id !== "string" || button.id.length === 0 || typeof button.onClick !== "function" || typeof button.icon?.path !== "string" || typeof button.icon.viewBox !== "string") return false;
        const label = typeof button.label === "function" ? button.label() : button.label;
        if (typeof label !== "string" || label.length === 0) return false;
        const key = keyOf(plugin, button.id);
        if (this.entries.has(key)) return false;
        if ([...this.entries.values()].filter(entry => entry.plugin === plugin).length >= MAX_MESSAGE_BUTTONS_PER_PLUGIN) return false;
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
        if (!this.styled) { this.styled = true; this.addStyle(MESSAGE_BUTTONS_CSS, STYLE_NAME); }
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

    private sync(): void {
        const doc = this.page.document;
        const wanted = [...this.entries.keys()];
        // Buttons left behind by a plugin that stopped.
        for (const element of doc.querySelectorAll(`[${MESSAGE_BUTTON_ATTRIBUTE}]`)) {
            if (!wanted.includes(element.getAttribute(MESSAGE_BUTTON_ATTRIBUTE) ?? "")) (element.closest("span") ?? element).remove();
        }
        if (this.entries.size === 0) return;
        for (const row of doc.querySelectorAll("[class*=\"buttonContainer\"] [class*=\"buttonsInner\"]")) {
            const message = messageOfId(row.closest("li[id^=\"chat-messages-\"]")?.id);
            if (!message) continue;
            const model = row.querySelector("[class*=\"hoverBarButton\"]");
            if (!model) continue;
            const show = wanted.filter(key => this.shows(key, message));
            const here = [...row.querySelectorAll(`[${MESSAGE_BUTTON_ATTRIBUTE}]`)].map(element => element.getAttribute(MESSAGE_BUTTON_ATTRIBUTE) ?? "");
            const plan = planSync(here, show);
            for (const key of plan.remove) row.querySelector(`[${MESSAGE_BUTTON_ATTRIBUTE}="${key}"]`)?.closest("span")?.remove();
            for (const key of plan.add.reverse()) {
                const entry = this.entries.get(key);
                if (entry) row.prepend(this.draw(key, entry, model));
            }
            for (const element of row.querySelectorAll(`[${MESSAGE_BUTTON_ATTRIBUTE}]`)) {
                const entry = this.entries.get(element.getAttribute(MESSAGE_BUTTON_ATTRIBUTE) ?? "");
                if (entry) this.update(element, entry);
            }
        }
    }

    private shows(key: string, message: MessageRef): boolean {
        const entry = this.entries.get(key);
        if (!entry) return false;
        try {
            return entry.button.shouldShow?.(message) !== false;
        } catch (error) {
            this.onError(entry.plugin, `message button show ${entry.button.id}`, error);
            return false;
        }
    }

    private draw(key: string, entry: Entry, model: Element): HTMLElement {
        const doc = this.page.document;
        const wrapper = doc.createElement("span");
        const element = doc.createElement("div");
        // The same classes as a button Discord drew in this bar, so it looks and sits like the others
        element.className = model.className;
        element.setAttribute(MESSAGE_BUTTON_ATTRIBUTE, key);
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        const modelIcon = model.querySelector("svg");
        const svg = doc.createElementNS(SVG_NAMESPACE, "svg");
        svg.setAttribute("class", modelIcon?.getAttribute("class") ?? "");
        svg.setAttribute("viewBox", entry.button.icon.viewBox);
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        svg.setAttribute("aria-hidden", "true");
        const path = doc.createElementNS(SVG_NAMESPACE, "path");
        path.setAttribute("d", entry.button.icon.path);
        path.setAttribute("fill", "currentColor");
        svg.append(path);
        element.append(svg);
        const run = () => {
            const message = messageOfId(element.closest("li[id^=\"chat-messages-\"]")?.id);
            if (!message) return;
            try { entry.button.onClick(message); } catch (error) { this.onError(entry.plugin, `message button ${entry.button.id}`, error); }
            this.schedule();
        };
        element.addEventListener("click", event => { event.stopPropagation(); run(); });
        element.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); run(); } });
        wrapper.append(element);
        return wrapper;
    }

    private update(element: Element, entry: Entry): void {
        let label = "";
        try { label = typeof entry.button.label === "function" ? entry.button.label() : entry.button.label; } catch (error) { this.onError(entry.plugin, `message button label ${entry.button.id}`, error); }
        if (element.getAttribute("aria-label") !== label) { element.setAttribute("aria-label", label); element.setAttribute("title", label); }
    }
}

export function buildMessageButtons(hub: MessageButtonsHub, plugin: string, onDispose: (callback: () => void) => void): PluginMessageButtons {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(button) { return hub.add(plugin, button); },
        refresh() { hub.refresh(); }
    };
}
