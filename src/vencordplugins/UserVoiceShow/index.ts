/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UserVoiceShow (authors LordElias, Ven, Sqaaakoi) as found in TestCord's copy of Vencord's plugins. A smaller version of the original (which also adds it to the member list, the profile and DM list): in messages, a short "in #channel" appears after the name of anyone who is in a voice channel in the same server (or in the call of the same group chat); the hover text names the server. It is read from Discord's voice state store and refreshed every few seconds. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

/** The text shown for a person in a voice channel. */
export function voiceText(channelName: string | undefined): string | undefined {
    return channelName ? `in ${channelName}` : undefined;
}

interface Messages { getMessage(channel: string, id: string): { author?: { id: string; }; } | undefined; }
interface Voice { getVoiceStateForUser(userId: string): { channelId?: string | null; } | undefined; }

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const voice = ctx.common.VoiceStateStore;
        const channels = ctx.common.ChannelStore;
        const guilds = ctx.common.GuildStore;
        const voiceChannelOf = (channelId: string, messageId: string) => {
            const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
            const inVoice = author ? (voice.get() as unknown as Voice | undefined)?.getVoiceStateForUser(author.id)?.channelId : undefined;
            return inVoice ? (channels.get()?.getChannel(inVoice) as { name?: string; guild_id?: string; } | undefined) : undefined;
        };
        ctx.messageDecor.add({
            id: "voice",
            placement: "after-name",
            text: ({ channelId, messageId }) => voiceText(voiceChannelOf(channelId, messageId)?.name),
            title: ({ channelId, messageId }) => { const channel = voiceChannelOf(channelId, messageId); return channel?.guild_id ? guilds.get()?.getGuild(channel.guild_id)?.name : undefined; }
        });
        const timer = setInterval(() => { ctx.messageDecor.refresh(); }, 5000);
        ctx.onDispose(() => { clearInterval(timer); });
    }
};

export default plugin;
