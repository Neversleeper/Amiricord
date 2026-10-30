/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin InRole (author nin0dev) as found in Equicord's copy of Vencord's plugins. Same command and same limit (only the members Discord has loaded: if you are not a moderator of a big server, offline members and members beyond the first hundred are missing until you scroll the member list). The original also adds an item to a role's right-click menu and turns on Discord's developer mode to get it; that part is not ported. Names come from Discord's user store.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface RoleMember { userId: string; roles: string[]; nick?: string | null; }

/** The members that have a role. */
export function membersInRole(members: RoleMember[], roleId: string): RoleMember[] {
    return members.filter(member => member.roles.includes(roleId));
}

const plugin: PluginCode = {
    start(ctx) {
        const memberStore = ctx.common.GuildMemberStore;
        const users = ctx.common.UserStore;
        const selectedGuild = ctx.common.SelectedGuildStore;
        const roles = ctx.finders.byStore<{ getRole(guildId: string, roleId: string): { name?: string; } | undefined; }>("GuildRoleStore");
        ctx.commands.add({
            name: "inrole",
            description: "Know who is in a role",
            options: [{ name: "role", description: "The role", type: "role", required: true }],
            execute(args) {
                const roleId = String(args.find(arg => arg.name === "role")?.value ?? "");
                const guildId = selectedGuild.get()?.getGuildId();
                if (!guildId) { ctx.toasts.show("Make sure that you are in a server.", "failure"); return; }
                const all = (memberStore.get() as unknown as { getMembers(guildId: string): RoleMember[]; } | undefined)?.getMembers(guildId) ?? [];
                const found = membersInRole(all, roleId);
                const roleName = roles.get()?.getRole(guildId, roleId)?.name ?? "that role";
                const opened = openPanelWindow(ctx, `Members of ${roleName} (${found.length})`, kit => kit.panel(found.length === 0
                    ? kit.card([kit.note("No cached members with that role were found. Try scrolling down your member list to load more people.")])
                    : kit.card(found.map(member => {
                        const user = users.get()?.getUser(member.userId) as { username?: string; globalName?: string; } | undefined;
                        return kit.item(member.userId, null, member.nick ?? user?.globalName ?? user?.username ?? member.userId, user?.username ?? member.userId, []);
                    }))));
                if (!opened) ctx.toasts.show(`${roleName}: ${found.length} members`, "info");
            }
        });
    }
};

export default plugin;
