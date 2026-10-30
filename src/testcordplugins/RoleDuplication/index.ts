/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RoleDuplication (authors i am me, x2b) as found in TestCord. The original adds Duplicate and Clone to role menus, can copy the role to other servers you manage and can copy the role icon. Here it is a command that copies a role inside the current server (colour, permissions, mentionable, hoist; not the icon). You need the Manage Roles permission in that server, and Discord refuses the request when you do not. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export interface RoleData { name: string; color: number; permissions: string | number | bigint; mentionable: boolean; hoist: boolean; }

/** The body of the request that makes a role like another one. */
export function roleBody(role: RoleData, name?: string): Record<string, unknown> {
    return { name: name && name.trim() !== "" ? name.trim() : role.name, color: role.color, permissions: String(role.permissions), mentionable: role.mentionable, hoist: role.hoist };
}

interface Rest { post(request: { url: string; body: unknown; }): Promise<unknown>; }

const plugin: PluginCode = {
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const roles = ctx.finders.byStore<{ getRole(guildId: string, roleId: string): RoleData | undefined; }>("GuildRoleStore");
        const selected = ctx.common.SelectedGuildStore;
        ctx.commands.add({
            name: "duplicaterole",
            description: "Make a copy of a role of this server",
            options: [
                { name: "role", description: "The role to copy", type: "role", required: true },
                { name: "name", description: "A name for the copy (the same name when empty)" }
            ],
            async execute(args) {
                const guildId = selected.get()?.getGuildId();
                const roleId = String(args.find(arg => arg.name === "role")?.value ?? "");
                const role = guildId ? roles.get()?.getRole(guildId, roleId) : undefined;
                if (!guildId || !role) { ctx.toasts.show("Use this in a server and pick one of its roles.", "failure"); return; }
                try {
                    await rest.get()?.post({ url: `/guilds/${guildId}/roles`, body: roleBody(role, String(args.find(arg => arg.name === "name")?.value ?? "")) });
                    ctx.toasts.show("The role was copied.", "success");
                } catch (error) {
                    ctx.reportError("RoleDuplication", error);
                    ctx.toasts.show("The role could not be copied (do you have Manage Roles here?).", "failure");
                }
            }
        });
    }
};

export default plugin;
