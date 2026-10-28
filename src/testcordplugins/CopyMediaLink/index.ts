/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CopyMediaLink (author x2b) as found in TestCord (commit af92dba of its public repository).
// Written against Amiricord's own right-click menu (`ctx.menuItems`), which adds the item to the end of Discord's menu instead of patching the menu's code.
// Differences, NOT verified against a real Discord: the item is added at the end of the menu (the original put it next to Discord's own "Copy Link"), it shows
// only when the click was on a picture, GIF or video (the original also added "Copy Link" for plain links, where Discord's own menu already has it), and the
// picture's address is the one the page is showing at that moment.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    start(ctx) {
        ctx.menuItems.add("media-link", ({ src }) => {
            if (!src) return null;
            return {
                label: "Copy Media Link",
                action: async () => {
                    try {
                        await navigator.clipboard.writeText(src);
                        ctx.toasts.show("Media link copied!", "success");
                    } catch (error) {
                        ctx.reportError("CopyMediaLink", error);
                        ctx.toasts.show("Could not copy the link", "failure");
                    }
                }
            };
        });
    }
};

export default plugin;
