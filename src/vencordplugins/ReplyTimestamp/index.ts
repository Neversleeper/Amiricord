/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ReplyTimestamp (author Kyuuhachi) as found in TestCord's copy of Vencord's plugins. The original patches the reply preview and draws Discord's own timestamp; here the time is added as text at the end of the preview by the engine (placement "reply" of ctx.messageDecor, new in this round). The time is just the hour when both messages are from the same day and the date and hour when they are not. Only when the original message is one Discord has loaded. Not seen on a real reply yet.

import type { PluginCode } from "../../renderer/engine";

/** "[14:05]" when both times are on the same day, "[3/4/2026, 14:05]" otherwise. */
export function replyTime(referenced: number, base: number, locale?: string): string {
    const a = new Date(referenced);
    const b = new Date(base);
    const hour: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
    if (a.toDateString() === b.toDateString()) return `[${a.toLocaleTimeString(locale, hour)}]`;
    return `[${a.toLocaleDateString(locale)}, ${a.toLocaleTimeString(locale, hour)}]`;
}

interface Message { timestamp?: unknown; messageReference?: { message_id?: string; channel_id?: string; } | null; }

/** A message's time as milliseconds (Discord keeps a moment object or a date); undefined when it is not there. */
export function millisecondsOf(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const time = typeof value === "number" ? value : new Date(value as string | Date).getTime();
    return Number.isFinite(time) ? time : undefined;
}

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const text = (channelId: string, messageId: string) => {
            const store = messages.get() as unknown as { getMessage(channel: string, id: string): Message | undefined; } | undefined;
            const base = store?.getMessage(channelId, messageId);
            const reference = base?.messageReference;
            if (!base || !reference?.message_id) return undefined;
            const referenced = store?.getMessage(reference.channel_id ?? channelId, reference.message_id);
            const referencedTime = millisecondsOf(referenced?.timestamp);
            const baseTime = millisecondsOf(base.timestamp);
            return referencedTime === undefined || baseTime === undefined ? undefined : replyTime(referencedTime, baseTime);
        };
        ctx.messageDecor.add({ id: "reply-time", placement: "reply", text: ({ channelId, messageId }) => text(channelId, messageId) });
    }
};

export default plugin;
