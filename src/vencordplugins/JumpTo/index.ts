/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin JumpTo (author Equicord contributors) as found in TestCord's copy of Vencord's plugins. Jump to start asks Discord for the oldest message of the channel and goes to it; jump to bottom goes to the newest. Both use Discord's own jump function (found by name). A channel you cannot read just shows a notice. Not tried in a real Discord.

import { channelIdFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

interface Rest { get(request: { url: string; query?: Record<string, unknown>; }): Promise<{ body: Array<{ id: string; }>; }>; }
interface Jumper {
    jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; jumpType?: string; }): void;
    jumpToPresent?(channelId: string, options?: { limit?: number; }): void;
}

/** The query that asks for the oldest message of a channel. */
export const OLDEST_QUERY = { after: "0", limit: 1 } as const;

const plugin: PluginCode = {
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const jumper = ctx.finders.byProps<Jumper>("jumpToMessage");
        ctx.menuItems.add("jump-to", click => {
            const channelId = channelIdFromTarget(click.target);
            if (!channelId) return null;
            return [
                {
                    label: "Jump to start",
                    action: async () => {
                        try {
                            const response = await rest.get()?.get({ url: `/channels/${channelId}/messages`, query: OLDEST_QUERY });
                            const first = response?.body?.[0];
                            if (!first) { ctx.toasts.show("There are no messages to jump to.", "failure"); return; }
                            jumper.get()?.jumpToMessage({ channelId, messageId: first.id, flash: true, jumpType: "INSTANT" });
                        } catch (error) {
                            ctx.reportError("JumpTo", error);
                            ctx.toasts.show("Could not find the first message.", "failure");
                        }
                    }
                },
                { label: "Jump to bottom", action: () => { jumper.get()?.jumpToPresent?.(channelId, { limit: 50 }); } }
            ];
        });
    }
};

export default plugin;
