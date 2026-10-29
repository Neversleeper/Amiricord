/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AvatarGrabber (author Sharp) as found in TestCord. `/avatar` sends the address of the full-size avatar as a message. Differences:
// when the user is not found a notice is shown to you only (the original sent a bot message to the chat). Needs the command option type "user" (added to the engine's
// commands). Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

interface IconUtils { getUserAvatarURL(user: unknown, canAnimate: boolean, size?: number): string; }

const plugin: PluginCode = {
    start(ctx) {
        const icons = ctx.finders.byProps<IconUtils>("getUserAvatarURL", "getGuildIconURL");
        const users = ctx.common.UserStore;
        ctx.commands.add({
            name: "avatar",
            description: "Get a user's full-size avatar",
            options: [{ name: "user", description: "Whose avatar (defaults to you)", type: "user" }],
            execute(args) {
                const store = users.get();
                const chosen = args.find(arg => arg.name === "user")?.value;
                const id = typeof chosen === "string" ? chosen : store?.getCurrentUser()?.id;
                const user = id ? store?.getUser(id) : undefined;
                const url = user ? icons.get()?.getUserAvatarURL(user, true, 1024) : undefined;
                if (!url) {
                    ctx.toasts.show("Could not find that user's avatar.", "failure");
                    return undefined;
                }
                return { content: url };
            }
        });
    }
};

export default plugin;
