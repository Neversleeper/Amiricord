/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowHiddenThings (author Dolfies) as found in TestCord's copy of Vencord's plugins.
// The four patches are the original's, each one only while its setting is on (read when the plugin starts, so a change needs a restart, as in the original).
// On build 653945 only the "invites paused" one could be checked (it matches once); the others are in code Discord loads later, so they are marked lazy
// and it is NOT known that they still match.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

interface Role { id: string; }

const settings = definePluginSettings({
    showTimeouts: { type: "boolean", default: true, restartNeeded: true, description: "Show member timeout icons in chat." },
    showInvitesPaused: { type: "boolean", default: true, restartNeeded: true, description: "Show the invites paused tooltip in the server list." },
    showModView: { type: "boolean", default: true, restartNeeded: true, description: "Show the member mod view context menu item in all servers." }
} as const);

const plugin: PluginCode & { getHighestRole(props: { member?: { highestRoleId?: string; }; }, roles: Role[]): Role | undefined; } = {
    settings,

    get patches(): PatchDefinition[] {
        const patches: PatchDefinition[] = [];
        if (settings.store.showTimeouts) {
            patches.push({
                find: "showCommunicationDisabledStyles",
                lazy: true,
                required: false,
                replacements: [{ match: /&&\i\.\i\.canManageUser\(\i\.\i\.MODERATE_MEMBERS,\i\.author,\i\)/, replace: "" }]
            });
        }
        if (settings.store.showInvitesPaused) {
            patches.push({
                find: "INVITES_DISABLED)||",
                lazy: true,
                required: false,
                replacements: [{ match: /\i\.\i\.can\(\i\.\i.MANAGE_GUILD,\i\)/, replace: "true" }]
            });
        }
        if (settings.store.showModView) {
            patches.push(
                {
                    find: /,checkElevated:!1}\),\i\.\i\)}(?<=getCurrentUser\(\);return.+?)/,
                    lazy: true,
                    required: false,
                    replacements: [{ match: /return \i\.\i\(\i\.\i\(\{user:\i,context:\i,checkElevated:!1\}\),\i\.\i\)/, replace: "return true" }]
                },
                {
                    // The Members page need not be loaded to see the highest role (93S+lG is the hash of the translation key GUILD_MEMBER_MOD_VIEW_HIGHEST_ROLE).
                    find: ".t[\"93S+lG\"]),children:",
                    lazy: true,
                    required: false,
                    replacements: [{
                        match: /(\.t\["93S\+lG"\].{0,80})role:\i(?<=\[\i\.roles,\i\.highestRoleId,(\i)\].+?)/,
                        replace: "$1role:$self.getHighestRole(arguments[0],$2)"
                    }]
                }
            );
        }
        return patches;
    },

    getHighestRole(props, roles) {
        try {
            return roles.find(role => role.id === props.member?.highestRoleId);
        } catch {
            return undefined;
        }
    }
};

export default plugin;
