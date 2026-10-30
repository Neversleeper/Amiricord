/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ValidReply (author newwares) as found in TestCord's copy of Vencord's plugins. Same idea: a reply whose original message Discord did not load says
// "Message could not be loaded"; when the mouse goes over that text the message is asked for (the one message around its id, with Discord's own request function) and shown in its place, or the
// text becomes "Original message was deleted" when it is not there any more. Differences: the original patched Discord's reply component and wrote into Discord's reply store; here nothing of
// Discord's code is touched: the placeholder (`repliedTextPlaceholder_*`, read in her running Discord, build 655747) is found on hover and its text is replaced, and what was read is kept in a small
// list so the same reply is not asked for twice. The replacement lives in the page, so Discord drawing the reply again brings the placeholder back, and the next hover puts the text back at once.
// A failed request is not repeated for five seconds. Not tried on a message that was really deleted.

import type { PluginCode } from "../../renderer/engine";

const PLACEHOLDER = "[class*=\"repliedTextPlaceholder\"]";
const RETRY_COOLDOWN_MS = 5000;
const KEEP_MAX = 300;
const PREVIEW_CHARS = 160;
export const DELETED_TEXT = "Original message was deleted";

/** The channel and message ids of a message row (`chat-messages-<channel>-<message>`). */
export function idsOfRow(id: string | null | undefined): { channelId: string; messageId: string; } | undefined {
    const match = /^chat-messages-(\d+)-(\d+)$/.exec(id ?? "");
    return match ? { channelId: match[1], messageId: match[2] } : undefined;
}

export interface FetchedMessage {
    id?: unknown;
    content?: unknown;
    author?: { username?: unknown; global_name?: unknown; } | null;
    attachments?: unknown;
    embeds?: unknown;
    sticker_items?: unknown;
}

const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/** What the reply preview says for a message: "name: text" on one line, cut short; "[attachment]" and the like when there is no text. */
export function previewText(message: FetchedMessage): string {
    const author = message.author;
    const name = typeof author?.global_name === "string" && author.global_name !== "" ? author.global_name : typeof author?.username === "string" ? author.username : "";
    const text = (typeof message.content === "string" ? message.content : "").replace(/\s+/g, " ").trim();
    let body = text;
    if (body === "") body = count(message.attachments) > 0 ? "[attachment]" : count(message.embeds) > 0 ? "[embed]" : count(message.sticker_items) > 0 ? "[sticker]" : "";
    if (body.length > PREVIEW_CHARS) body = `${body.slice(0, PREVIEW_CHARS - 1)}…`;
    return name === "" ? body : body === "" ? name : `${name}: ${body}`;
}

/** Picks the message with this id out of what the request gave back; undefined when it is not there. */
export function pickMessage(body: unknown, id: string): FetchedMessage | undefined {
    return Array.isArray(body) ? (body as FetchedMessage[]).find(message => message?.id === id) : undefined;
}

interface Rest { get(options: { url: string; query?: Record<string, unknown>; }): Promise<{ body?: unknown; }>; }
interface Store { getMessage(channelId: string, messageId: string): { messageReference?: { channel_id?: string; message_id?: string; } | null; } | undefined; }

let stop: (() => void) | undefined;

const plugin: PluginCode = {
    start(ctx) {
        const page = (globalThis as unknown as { document: Document; }).document;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const messages = ctx.common.MessageStore;
        const known = new Map<string, string>();
        const waiting = new Set<string>();
        const retryAt = new Map<string, number>();
        const remember = (key: string, text: string) => {
            if (known.size >= KEEP_MAX) known.delete(known.keys().next().value as string);
            known.set(key, text);
        };
        const show = (placeholder: Element, text: string) => {
            if (placeholder.textContent !== text) placeholder.textContent = text;
            (placeholder as HTMLElement).style.fontStyle = "normal";
        };
        const onOver = (event: Event) => {
            const placeholder = (event.target as Element | null)?.closest?.(PLACEHOLDER);
            if (!placeholder) return;
            const row = idsOfRow(placeholder.closest("li[id^=\"chat-messages-\"]")?.id);
            if (!row) return;
            const reference = (messages.get() as unknown as Store | undefined)?.getMessage(row.channelId, row.messageId)?.messageReference;
            const channelId = reference?.channel_id ?? row.channelId;
            const messageId = reference?.message_id;
            if (!messageId) return;
            const key = `${channelId}:${messageId}`;
            const cached = known.get(key);
            if (cached !== undefined) { show(placeholder, cached); return; }
            if (waiting.has(key) || Date.now() < (retryAt.get(key) ?? 0)) return;
            waiting.add(key);
            const client = rest.get();
            if (!client) { waiting.delete(key); return; }
            void client.get({ url: `/channels/${channelId}/messages`, query: { limit: 1, around: messageId } })
                .then(response => {
                    const found = pickMessage(response?.body, messageId);
                    const text = found ? previewText(found) : DELETED_TEXT;
                    remember(key, text);
                    for (const spot of page.querySelectorAll(PLACEHOLDER)) {
                        const spotRow = idsOfRow(spot.closest("li[id^=\"chat-messages-\"]")?.id);
                        const spotRef = spotRow && (messages.get() as unknown as Store | undefined)?.getMessage(spotRow.channelId, spotRow.messageId)?.messageReference;
                        if (spotRef?.message_id === messageId) show(spot, text);
                    }
                })
                .catch(() => { retryAt.set(key, Date.now() + RETRY_COOLDOWN_MS); })
                .finally(() => { waiting.delete(key); });
        };
        page.addEventListener("mouseover", onOver, true);
        stop = () => page.removeEventListener("mouseover", onOver, true);
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
