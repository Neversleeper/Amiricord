/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CopyUserURLs (author castdrian) as found in TestCord's copy of Vencord's plugins. The original adds the item to Discord's own user menu; here it is added to Amiricord's right-click menu (`ctx.menuItems`) and the person is found from the clicked place (`src/api/clickTargets.ts`). The link is wrapped in `<...>` as in the original so it does not make a preview. Not checked live.

import { userIdFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

export const userUrl = (id: string) => `<https://discord.com/users/${id}>`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.menuItems.add("copy-user-url", click => {
            const id = userIdFromTarget(click.target);
            if (!id) return null;
            return {
                label: "Copy User URL",
                action: async () => {
                    try {
                        await navigator.clipboard.writeText(userUrl(id));
                        ctx.toasts.show("User URL copied!", "success");
                    } catch (error) {
                        ctx.reportError("CopyUserURLs", error);
                        ctx.toasts.show("Could not copy the link", "failure");
                    }
                }
            };
        });
    }
};

export default plugin;
