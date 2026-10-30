/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FindReply (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. The original shows a small page-by-page bar; here every press of the button goes to the next reply and wraps around, with a notice saying which one (for example 2 of 5). The replies are looked for in the messages Discord has loaded for the channel, so replies far below that were not loaded are not found. The button shows only on messages that have a reply loaded.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    includePings: { type: "boolean", default: false, description: "Also count messages that ping the author of the message" }
});

export interface LoadedMessage { id: string; deleted?: boolean; content?: string; messageReference?: { message_id?: string; } | null; author?: { id: string; }; }

/** The messages after `target` that reply to it (or ping its author, when asked), oldest first. */
export function findReplies(loaded: LoadedMessage[], target: { id: string; authorId?: string; }, includePings: boolean): LoadedMessage[] {
    return loaded.filter(other => {
        if (other.deleted || other.id === target.id || BigInt(other.id) < BigInt(target.id)) return false;
        if (other.messageReference?.message_id === target.id) return true;
        return includePings && target.authorId !== undefined && (other.content ?? "").includes(`<@${target.authorId}>`);
    }).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

interface Messages { getMessages(channel: string): { _array?: LoadedMessage[]; toArray?(): LoadedMessage[]; } | undefined; getMessage(channel: string, id: string): LoadedMessage | undefined; }

const next = new Map<string, number>();

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const jumper = ctx.finders.byProps<{ jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; jumpType?: string; }): void; }>("jumpToMessage");
        const repliesOf = (channelId: string, messageId: string) => {
            const store = messages.get() as unknown as Messages | undefined;
            const target = store?.getMessage(channelId, messageId);
            const cache = store?.getMessages(channelId);
            const loaded = cache?._array ?? cache?.toArray?.() ?? [];
            return target ? findReplies(loaded, { id: messageId, authorId: target.author?.id }, settings.store.includePings) : [];
        };
        ctx.messageButtons.add({
            id: "find-reply",
            label: "Find reply",
            icon: { viewBox: "0 0 24 24", path: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" },
            shouldShow: ({ channelId, messageId }) => repliesOf(channelId, messageId).length > 0,
            onClick: ({ channelId, messageId }) => {
                const replies = repliesOf(channelId, messageId);
                if (replies.length === 0) { ctx.toasts.show("No replies to that message are loaded.", "failure"); return; }
                const index = (next.get(messageId) ?? 0) % replies.length;
                next.set(messageId, index + 1);
                jumper.get()?.jumpToMessage({ channelId, messageId: replies[index].id, flash: true, jumpType: "INSTANT" });
                ctx.toasts.show(`Reply ${index + 1} of ${replies.length}`, "info");
            }
        });
    },
    stop() {
        next.clear();
    }
};

export default plugin;
