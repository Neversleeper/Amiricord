/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AlwaysTrust (authors zt and Trwy) as found in TestCord's copy of Vencord's plugins. Same three patches, each one only while
// its setting is on (read when the plugin starts: a change needs a restart, as in the original). Checked on build 653945: the first two match once; the third one is in code
// Discord loads later (the translation key DELETE_SERVER_ENTER_NAME is `abprOC`), so it is lazy and NOT known to match.
// Differences: the "are you sure" question is the browser's own `confirm()` instead of Discord's alert component (which an Amiricord plugin does not have yet); and,
// as in the original, the patch only adds a deletion before Discord's own code reads the server name, it does not remove Discord's name box.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

interface GuildActions { deleteGuild(id: string, name?: string): unknown; }

const settings = definePluginSettings({
    domain: { type: "boolean", default: true, restartNeeded: true, description: "Remove the untrusted domain popup when opening links" },
    file: { type: "boolean", default: true, restartNeeded: true, description: "Remove the 'Potentially Dangerous Download' popup when opening links" },
    noDeleteSafety: { type: "boolean", default: true, restartNeeded: true, description: "Removes the enter server name requirement when deleting a server" },
    confirmModal: { type: "boolean", default: true, description: "Ask \"are you sure you want to delete\" before deleting a server" }
} as const);

let context: EnginePluginContext | undefined;
let lastHandled: { id: string; at: number; } | undefined;

function deleteServer(id: string): void {
    const ctx = context;
    if (!ctx) return;
    const guild = ctx.common.GuildStore.get()?.getGuild(id);
    if (!guild) return;
    ctx.finders.byProps<GuildActions>("deleteGuild", "sendTransferOwnershipPincode").get()?.deleteGuild(id, guild.name);
}

const plugin: PluginCode & { HandleGuildDeleteModal(server: { id?: string; } | undefined): void; } = {
    settings,

    get patches(): PatchDefinition[] {
        const patches: PatchDefinition[] = [];
        if (settings.store.domain) {
            patches.push({
                find: '="MaskedLinkStore",',
                lazy: true,
                replacements: [{ match: /(?<=isTrustedDomain\(\i\){)return \i\(\i\)/, replace: "return true" }]
            });
        }
        if (settings.store.file) {
            patches.push({
                find: "bitbucket.org",
                lazy: true,
                replacements: [{ match: /function \i\(\i\){(?=.{0,30}pathname:\i)/, replace: "$&return null;" }]
            });
        }
        if (settings.store.noDeleteSafety) {
            patches.push({
                find: ".t.abprOC",
                lazy: true,
                required: false,
                replacements: [{ match: /\{name:\i\}\s*=\s*(\i)\.guild/, replace: "$self.HandleGuildDeleteModal($1.guild);$&" }]
            });
        }
        return patches;
    },

    start(ctx) {
        context = ctx;
    },

    stop() {
        context = undefined;
    },

    HandleGuildDeleteModal(server) {
        if (!server?.id) return;
        // This runs every time Discord draws the delete window, so the same server is not asked about (or deleted) twice in a row.
        const now = Date.now();
        if (lastHandled && lastHandled.id === server.id && now - lastHandled.at < 5000) return;
        lastHandled = { id: server.id, at: now };
        if (settings.store.confirmModal && !globalThis.confirm("Delete server? It's permanent, if that wasn't obvious.")) return;
        deleteServer(server.id);
    }
};

export default plugin;
