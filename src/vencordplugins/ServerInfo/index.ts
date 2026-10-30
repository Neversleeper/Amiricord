/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ServerInfo (authors Ven, Nuckyz, Z1xus) as found in TestCord's copy of Vencord's plugins. A smaller version of the original window (which also lists friends, blocked people and mutual members in tabs): here one window with the facts Discord has already loaded about the server. The dates come from the server's id. Not tried in a real Discord.

import { guildIdFromTarget } from "../../api/clickTargets";
import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

const DISCORD_EPOCH = 1420070400000n;

/** When a Discord id was made. */
export function createdAt(id: string): Date {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

interface GuildLike {
    id: string; name?: string; ownerId?: string; description?: string | null; premiumTier?: number; premiumSubscriberCount?: number;
    features?: Set<string> | string[]; joinedAt?: string | Date | null; vanityURLCode?: string | null; preferredLocale?: string; maxMembers?: number; verificationLevel?: number;
}

/** The lines of the window: a name and a value each. */
export function guildFacts(guild: GuildLike, extra: { owner?: string; roles?: number; members?: number; }): Array<[string, string]> {
    const features = guild.features ? [...guild.features] : [];
    const facts: Array<[string, string | undefined]> = [
        ["Name", guild.name], ["Id", guild.id], ["Created", createdAt(guild.id).toLocaleString()],
        ["You joined", guild.joinedAt ? new Date(guild.joinedAt).toLocaleString() : undefined],
        ["Owner", extra.owner ?? guild.ownerId], ["Members loaded", extra.members === undefined ? undefined : String(extra.members)],
        ["Maximum members", guild.maxMembers === undefined ? undefined : String(guild.maxMembers)], ["Roles", extra.roles === undefined ? undefined : String(extra.roles)],
        ["Boost level", guild.premiumTier === undefined ? undefined : String(guild.premiumTier)], ["Boosts", guild.premiumSubscriberCount === undefined ? undefined : String(guild.premiumSubscriberCount)],
        ["Vanity link", guild.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : undefined], ["Language", guild.preferredLocale],
        ["Description", guild.description ?? undefined], ["Features", features.length > 0 ? features.join(", ") : undefined]
    ];
    return facts.filter((fact): fact is [string, string] => fact[1] !== undefined && fact[1] !== "");
}

const plugin: PluginCode = {
    start(ctx) {
        const guilds = ctx.common.GuildStore;
        const users = ctx.common.UserStore;
        const members = ctx.common.GuildMemberStore;
        const roles = ctx.finders.byStore<{ getRoles(guildId: string): Record<string, unknown>; }>("GuildRoleStore");
        ctx.menuItems.add("server-info", click => {
            const id = guildIdFromTarget(click.target);
            const guild = id ? guilds.get()?.getGuild(id) as GuildLike | undefined : undefined;
            if (!id || !guild) return null;
            return {
                label: "Server Info",
                action: () => {
                    const owner = guild.ownerId ? users.get()?.getUser(guild.ownerId) as { username?: string; globalName?: string; } | undefined : undefined;
                    const memberCount = (members.get() as unknown as { getMemberIds?(guildId: string): string[]; } | undefined)?.getMemberIds?.(id)?.length;
                    const facts = guildFacts(guild, { owner: owner ? owner.globalName ?? owner.username : undefined, roles: Object.keys(roles.get()?.getRoles(id) ?? {}).length, members: memberCount });
                    openPanelWindow(ctx, guild.name ?? "Server", kit => kit.panel(kit.card(facts.map(([name, value]) => kit.item(name, null, name, value, [])))));
                }
            };
        });
    }
};

export default plugin;
