/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowRolesInChat (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. The original shows a small icon with a menu to exclude roles; here it is the name of the role as text (up to 60 characters), with a setting for roles to leave out (their ids, separated by commas) and for bots. The roles are read from Discord's member and role stores.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showBots: { type: "boolean", default: false, description: "Show the role of bots too" },
    excludedRoles: { type: "string", default: "", description: "Ids of roles to skip, separated by commas" }
});

export interface RoleLike { id: string; name: string; }

/** The first role (the list is from highest to lowest) that the person has and is not excluded. */
export function highestRole(sorted: RoleLike[], memberRoles: string[], excluded: string[]): RoleLike | undefined {
    const has = new Set(memberRoles);
    const skip = new Set(excluded);
    return sorted.find(role => has.has(role.id) && !skip.has(role.id));
}

interface Messages { getMessage(channel: string, id: string): { author?: { id: string; bot?: boolean; }; } | undefined; }
interface Members { getMember(guildId: string, userId: string): { roles?: string[]; } | undefined; }

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const members = ctx.common.GuildMemberStore;
        const channels = ctx.common.ChannelStore;
        const roles = ctx.finders.byStore<{ getSortedRoles(guildId: string): RoleLike[]; }>("GuildRoleStore");
        const roleOf = (channelId: string, messageId: string) => {
            const guildId = channels.get()?.getChannel(channelId)?.guild_id;
            const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
            if (!guildId || !author || (author.bot && !settings.store.showBots)) return undefined;
            const memberRoles = (members.get() as unknown as Members | undefined)?.getMember(guildId, author.id)?.roles;
            if (!memberRoles?.length) return undefined;
            return highestRole(roles.get()?.getSortedRoles(guildId) ?? [], memberRoles, settings.store.excludedRoles.split(",").map(id => id.trim()).filter(Boolean));
        };
        ctx.messageDecor.add({
            id: "role",
            text: ({ channelId, messageId }) => roleOf(channelId, messageId)?.name,
            title: () => "Highest role"
        });
    }
};

export default plugin;
