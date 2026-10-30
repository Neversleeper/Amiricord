/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowMeYourName (author Equicord contributors) as found in TestCord's copy of Vencord's plugins. The original is a very large plugin that rewrites how names are drawn everywhere (messages, replies, mentions, the member list, voice, typing, reactions) with a format you write. Only the simple, useful part is ported: in messages, the username is shown after the name when the name shown is a nickname or display name. The format, the other places and the display-name styling are not ported.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showBots: { type: "boolean", default: true, description: "Also on bots" },
    onlyWhenDifferent: { type: "boolean", default: true, description: "Only when the name shown is not already the username" }
});

/** The text to show after the name: the username, or nothing when it is the name already shown (and that is asked for). */
export function usernameText(username: string | undefined, shown: string | undefined, onlyWhenDifferent: boolean): string | undefined {
    if (!username) return undefined;
    if (onlyWhenDifferent && (shown === undefined || shown === username)) return undefined;
    return `@${username}`;
}

interface Messages { getMessage(channel: string, id: string): { author?: { id: string; username?: string; globalName?: string | null; bot?: boolean; }; } | undefined; }
interface Members { getMember(guildId: string, userId: string): { nick?: string | null; } | undefined; }

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const members = ctx.common.GuildMemberStore;
        const channels = ctx.common.ChannelStore;
        ctx.messageDecor.add({
            id: "username",
            placement: "after-name",
            text: ({ channelId, messageId }) => {
                const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
                if (!author || (author.bot && !settings.store.showBots)) return undefined;
                const guildId = channels.get()?.getChannel(channelId)?.guild_id;
                const nick = guildId ? (members.get() as unknown as Members | undefined)?.getMember(guildId, author.id)?.nick : undefined;
                return usernameText(author.username, nick ?? author.globalName ?? author.username, settings.store.onlyWhenDifferent);
            }
        });
    }
};

export default plugin;
