/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A short piece of text next to the name of the person who wrote a message: `ctx.messageDecor.add({ id, text(message) })`. It goes away when the plugin stops. Written from
// scratch. Like the message buttons, the text is put in the page by hand, not through Discord's React code. Checked live on Discord build 655747: the first message of a
// group has `h3.header_*` > `span.headerText_*` (the name, the server tag, the role icon) and `span.timestamp_*`, inside `li#chat-messages-<channel>-<message>`; messages that
// continue a group have no header, so they get nothing. "after-name" goes right after the name inside `headerText`; "after-time" (the default) goes at the end of the header; "reply" goes at the end of `div.repliedMessage_*`, the preview above a reply.
// The text is always set as text, never as HTML. When Discord changes the header, nothing shows (nothing breaks).

import { messageOfId, type MessageRef } from "./messageButtons";

export interface MessageDecoration {
    /** Unique among the plugin's own decorations. */
    id: string;
    /** The text to show for this message, or nothing. Asked each time the list is drawn, so keep it quick. */
    text(message: MessageRef): string | undefined;
    /** A tooltip for the text. */
    title?(message: MessageRef): string | undefined;
    /** Where: right after the name, after the time (default), or at the end of the small preview of the message that this one replies to (the text is asked for the replying message). */
    placement?: "after-name" | "after-time" | "reply";
}

export interface PluginMessageDecor {
    /** Adds a decoration. Returns false (and adds nothing) for a bad definition or an id that this plugin already uses. */
    add(decoration: MessageDecoration): boolean;
    /** Draws the decorations again, for when what `text` answers has changed. */
    refresh(): void;
}

export const MAX_DECORATIONS_PER_PLUGIN = 3;
export const MAX_DECORATION_TEXT = 60;
export const MESSAGE_DECOR_ATTRIBUTE = "data-amiricord-decor";
const STYLE_NAME = "message-decor";
const SYNC_DELAY_MS = 100;
const BODY_WAIT_MS = 100;

export const MESSAGE_DECOR_CSS = `
[${MESSAGE_DECOR_ATTRIBUTE}] { margin-left: 4px; font-size: 0.75rem; font-weight: 500; color: var(--text-muted, #949ba4); white-space: nowrap; vertical-align: baseline; }
`;

interface Entry { plugin: string; decoration: MessageDecoration; }

export interface MessageDecorPage {
    document: Document;
    MutationObserver: typeof MutationObserver;
    setTimeout(run: () => void, ms: number): unknown;
}

const keyOf = (plugin: string, id: string) => `${plugin}:${id}`;

/** The text cut to the allowed length; an empty or a wrong kind of answer is nothing. */
export function cleanDecorationText(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const text = value.trim();
    if (text.length === 0) return undefined;
    return text.length > MAX_DECORATION_TEXT ? `${text.slice(0, MAX_DECORATION_TEXT - 1)}…` : text;
}

export class MessageDecorHub {
    private readonly entries = new Map<string, Entry>();
    private observer: MutationObserver | undefined;
    private timer: unknown;
    private dirty = false;
    private styled = false;

    constructor(private readonly page: MessageDecorPage, private readonly addStyle: (css: string, name: string) => void, private readonly onError: (plugin: string, source: string, error: unknown) => void) {}

    add(plugin: string, decoration: MessageDecoration): boolean {
        if (typeof decoration?.id !== "string" || decoration.id.length === 0 || typeof decoration.text !== "function") return false;
        const key = keyOf(plugin, decoration.id);
        if (this.entries.has(key)) return false;
        if ([...this.entries.values()].filter(entry => entry.plugin === plugin).length >= MAX_DECORATIONS_PER_PLUGIN) return false;
        this.entries.set(key, { plugin, decoration });
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
        if (!this.styled) { this.styled = true; this.addStyle(MESSAGE_DECOR_CSS, STYLE_NAME); }
        this.observer = new this.page.MutationObserver(() => { this.schedule(); });
        this.observer.observe(body, { childList: true, subtree: true });
        this.schedule();
    }

    private stop(): void {
        this.observer?.disconnect();
        this.observer = undefined;
    }

    /**
     * The first change runs at once: the observer's callback comes before the browser draws, so a text added there (the username after a name, a time in a reply) is on the screen with
     * the message and does not pop in a moment later. Changes that come while the wait runs are put together into one more run when it ends.
     */
    private schedule(): void {
        if (this.timer !== undefined) { this.dirty = true; return; }
        this.run();
    }

    private run(): void {
        this.dirty = false;
        this.sync();
        this.timer = this.page.setTimeout(() => {
            this.timer = undefined;
            if (this.dirty) this.run();
        }, SYNC_DELAY_MS);
    }

    private sync(): void {
        const doc = this.page.document;
        // Text left behind by a plugin that stopped.
        for (const element of doc.querySelectorAll(`[${MESSAGE_DECOR_ATTRIBUTE}]`)) {
            if (!this.entries.has(element.getAttribute(MESSAGE_DECOR_ATTRIBUTE) ?? "")) element.remove();
        }
        if (this.entries.size === 0) return;
        for (const header of doc.querySelectorAll("li[id^=\"chat-messages-\"] h3[class*=\"header\"]")) {
            const message = messageOfId(header.closest("li[id^=\"chat-messages-\"]")?.id);
            if (!message) continue;
            for (const [key, entry] of this.entries) if (entry.decoration.placement !== "reply") this.place(header, key, entry, message);
        }
        if (![...this.entries.values()].some(entry => entry.decoration.placement === "reply")) return;
        for (const preview of doc.querySelectorAll("li[id^=\"chat-messages-\"] [class*=\"repliedMessage_\"]")) {
            if (preview.parentElement?.matches("[class*=\"repliedMessage_\"]")) continue;
            const message = messageOfId(preview.closest("li[id^=\"chat-messages-\"]")?.id);
            if (!message) continue;
            for (const [key, entry] of this.entries) if (entry.decoration.placement === "reply") this.place(preview, key, entry, message);
        }
    }

    private place(header: Element, key: string, entry: Entry, message: MessageRef): void {
        let text: string | undefined;
        let title: string | undefined;
        try {
            text = cleanDecorationText(entry.decoration.text(message));
            title = text === undefined ? undefined : cleanDecorationText(entry.decoration.title?.(message));
        } catch (error) {
            this.onError(entry.plugin, `message decoration ${entry.decoration.id}`, error);
            text = undefined;
        }
        const selector = `[${MESSAGE_DECOR_ATTRIBUTE}="${key}"]`;
        let element = header.querySelector(selector);
        if (text === undefined) { element?.remove(); return; }
        const headerText = header.querySelector("[class*=\"headerText\"]");
        const parent = entry.decoration.placement === "after-name" && headerText ? headerText : header;
        if (!element) {
            element = this.page.document.createElement("span");
            element.setAttribute(MESSAGE_DECOR_ATTRIBUTE, key);
            if (parent === headerText) {
                const name = headerText?.querySelector("[class*=\"username\"]");
                if (name?.nextSibling) parent.insertBefore(element, name.nextSibling);
                else parent.append(element);
            } else {
                parent.append(element);
            }
        }
        if (element.textContent !== text) element.textContent = text;
        if ((element.getAttribute("title") ?? undefined) !== title) {
            if (title === undefined) element.removeAttribute("title");
            else element.setAttribute("title", title);
        }
    }
}

export function buildMessageDecor(hub: MessageDecorHub, plugin: string, onDispose: (callback: () => void) => void): PluginMessageDecor {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(decoration) { return hub.add(plugin, decoration); },
        refresh() { hub.refresh(); }
    };
}
