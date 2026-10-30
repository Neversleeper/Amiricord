/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PermissionsViewer (authors Nuckyz, Ven) as found in TestCord's copy of Vencord's plugins. A smaller version of the original (which also has the role and channel menus and a sort setting): it takes the roles of the person in the server you are in, adds up their permissions, and lists each one with the highest role that has it. Owners and administrators have everything. Channel overwrites are not applied (they are not in the role data). The permission names are the public ones of Discord's API. Not tried in a real Discord.

import { userIdFromTarget } from "../../api/clickTargets";
import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

/** The permission names, by bit number (Discord's public API list). */
export const PERMISSIONS: Array<[bigint, string]> = [
    [0n, "Create Invite"], [1n, "Kick Members"], [2n, "Ban Members"], [3n, "Administrator"], [4n, "Manage Channels"], [5n, "Manage Server"], [6n, "Add Reactions"], [7n, "View Audit Log"],
    [8n, "Priority Speaker"], [9n, "Video / Stream"], [10n, "View Channels"], [11n, "Send Messages"], [12n, "Send TTS Messages"], [13n, "Manage Messages"], [14n, "Embed Links"],
    [15n, "Attach Files"], [16n, "Read Message History"], [17n, "Mention Everyone"], [18n, "Use External Emojis"], [19n, "View Server Insights"], [20n, "Connect"], [21n, "Speak"],
    [22n, "Mute Members"], [23n, "Deafen Members"], [24n, "Move Members"], [25n, "Use Voice Activity"], [26n, "Change Nickname"], [27n, "Manage Nicknames"], [28n, "Manage Roles"],
    [29n, "Manage Webhooks"], [30n, "Manage Expressions"], [31n, "Use Application Commands"], [32n, "Request to Speak"], [33n, "Manage Events"], [34n, "Manage Threads"],
    [35n, "Create Public Threads"], [36n, "Create Private Threads"], [37n, "Use External Stickers"], [38n, "Send Messages in Threads"], [39n, "Use Activities"], [40n, "Timeout Members"],
    [42n, "Use Soundboard"], [43n, "Create Expressions"], [44n, "Create Events"], [45n, "Use External Sounds"], [46n, "Send Voice Messages"], [49n, "Send Polls"], [50n, "Use External Apps"]
];

export interface RoleData { id: string; name: string; permissions: bigint | string | number; position?: number; }

/** The permissions a person has from their roles (and @everyone): each with the highest role that gives it. Owners and administrators get all of them, from "Owner" or the role that has Administrator. */
export function permissionsOf(roles: RoleData[], isOwner: boolean): Array<{ name: string; from: string; }> {
    const sorted = [...roles].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    const admin = sorted.find(role => (BigInt(role.permissions) & (1n << 3n)) !== 0n);
    return PERMISSIONS.flatMap(([bit, name]) => {
        if (isOwner) return [{ name, from: "Server owner" }];
        if (admin) return [{ name, from: `${admin.name} (Administrator)` }];
        const giver = sorted.find(role => (BigInt(role.permissions) & (1n << bit)) !== 0n);
        return giver ? [{ name, from: giver.name }] : [];
    });
}

const plugin: PluginCode = {
    start(ctx) {
        const selectedGuild = ctx.common.SelectedGuildStore;
        const guilds = ctx.common.GuildStore;
        const members = ctx.common.GuildMemberStore;
        const users = ctx.common.UserStore;
        const roleStore = ctx.finders.byStore<{ getRoles(guildId: string): Record<string, RoleData>; }>("GuildRoleStore");
        ctx.menuItems.add("view-permissions", click => {
            const userId = userIdFromTarget(click.target);
            const guildId = selectedGuild.get()?.getGuildId();
            if (!userId || !guildId) return null;
            return {
                label: "View Permissions",
                action: () => {
                    const member = (members.get() as unknown as { getMember(guildId: string, userId: string): { roles?: string[]; } | undefined; } | undefined)?.getMember(guildId, userId);
                    const all = roleStore.get()?.getRoles(guildId) ?? {};
                    const have = [all[guildId], ...(member?.roles ?? []).map(id => all[id])].filter((role): role is RoleData => !!role);
                    const owner = (guilds.get()?.getGuild(guildId) as { ownerId?: string; } | undefined)?.ownerId === userId;
                    const found = permissionsOf(have, owner);
                    const user = users.get()?.getUser(userId) as { globalName?: string; username?: string; } | undefined;
                    openPanelWindow(ctx, `Permissions of ${user?.globalName ?? user?.username ?? userId}`, kit => kit.panel(found.length === 0
                        ? kit.card([kit.note("No permissions found (the member is not loaded).")])
                        : kit.card(found.map(permission => kit.item(permission.name, null, permission.name, permission.from, [])))));
                }
            };
        });
    }
};

export default plugin;
