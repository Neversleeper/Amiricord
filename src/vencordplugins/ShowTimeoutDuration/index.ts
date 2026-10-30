/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowTimeoutDuration (authors Ven, Sqaaakoi) as found in TestCord's copy of Vencord's plugins. A smaller version of the original (which changes the tooltip of the timeout icon): a short text such as "timed out 2h 5m" is placed after the name of anyone whose timeout has not ended, and it is refreshed once a minute. The hover text gives the exact time it ends. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

/** "2d 3h", "5h 10m" or "40s": the two largest units of the time left, or nothing when it has passed. */
export function timeLeft(until: string | number | Date | null | undefined, now: number): string | undefined {
    if (until === null || until === undefined) return undefined;
    let seconds = Math.floor((new Date(until).getTime() - now) / 1000);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    const parts: string[] = [];
    for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]] as const) {
        const count = Math.floor(seconds / size);
        seconds -= count * size;
        if (count > 0) parts.push(`${count}${unit}`);
        if (parts.length === 2) break;
    }
    return parts.join(" ");
}

interface Messages { getMessage(channel: string, id: string): { author?: { id: string; }; } | undefined; }
interface Members { getMember(guildId: string, userId: string): { communicationDisabledUntil?: string | null; } | undefined; }

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const members = ctx.common.GuildMemberStore;
        const channels = ctx.common.ChannelStore;
        const until = (channelId: string, messageId: string) => {
            const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
            const guildId = channels.get()?.getChannel(channelId)?.guild_id;
            return author && guildId ? (members.get() as unknown as Members | undefined)?.getMember(guildId, author.id)?.communicationDisabledUntil : undefined;
        };
        ctx.messageDecor.add({
            id: "timeout",
            placement: "after-name",
            text: ({ channelId, messageId }) => { const left = timeLeft(until(channelId, messageId), Date.now()); return left ? `timed out ${left}` : undefined; },
            title: ({ channelId, messageId }) => { const end = until(channelId, messageId); return end && timeLeft(end, Date.now()) ? `The timeout ends ${new Date(end).toLocaleString()}` : undefined; }
        });
        const timer = setInterval(() => { ctx.messageDecor.refresh(); }, 60_000);
        ctx.onDispose(() => { clearInterval(timer); });
    }
};

export default plugin;
