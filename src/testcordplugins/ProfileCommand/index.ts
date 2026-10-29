/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ProfileCommand (author x2b) as found in TestCord. `/profile` opens the profile card of a user, yours when none is given. Discord's
// own `openUserProfileModal` is used (the original used Vencord's helper for it). Needs the command option type "user". Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

interface ProfileActions { openUserProfileModal?(options: { userId: string; }): unknown; }

const plugin: PluginCode = {
    start(ctx) {
        const actions = ctx.finders.byProps<ProfileActions>("openUserProfileModal");
        const users = ctx.common.UserStore;
        ctx.commands.add({
            name: "profile",
            description: "Open a user profile",
            options: [{ name: "user", description: "The user profile you want to view. Leave empty to view your own profile", type: "user" }],
            execute(args) {
                const chosen = args.find(arg => arg.name === "user")?.value;
                const userId = typeof chosen === "string" ? chosen : users.get()?.getCurrentUser()?.id;
                const open = actions.get()?.openUserProfileModal;
                if (!userId || typeof open !== "function") {
                    ctx.toasts.show("Could not open that profile.", "failure");
                    return undefined;
                }
                void open.call(actions.get(), { userId });
                return undefined;
            }
        });
    }
};

export default plugin;
