/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MuteUnmuteServers (author x2b) as found in TestCord. Same request for each server (mute with no end time and no @everyone or role pings, or the reverse). The original adds the entries to Discord's own server menu; here they go in Amiricord's right-click menu of a server icon. It changes the notification settings of every server you are in, one after the other, and says how many it updated.

import { guildIdFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

interface Rest { patch(request: { url: string; body: unknown; }): Promise<unknown>; }
interface Guilds { getGuilds(): Record<string, unknown>; }

/** The notification settings to send to mute or unmute one server. */
export function muteSettings(muted: boolean): Record<string, unknown> {
    return {
        muted,
        mute_config: muted ? { selected_time_window: -1, end_time: null } : null,
        suppress_everyone: muted,
        suppress_roles: muted,
        message_notifications: muted ? 2 : 0,
        mobile_push: !muted
    };
}

const plugin: PluginCode = {
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const guilds = ctx.common.GuildStore;
        const setAll = async (muted: boolean) => {
            const ids = Object.keys((guilds.get() as unknown as Guilds | undefined)?.getGuilds() ?? {});
            const word = muted ? "Muting" : "Unmuting";
            ctx.toasts.show(`${word} all servers...`, "info");
            let count = 0;
            for (const id of ids) {
                try {
                    await rest.get()?.patch({ url: `/users/@me/guilds/${id}/settings`, body: muteSettings(muted) });
                    count++;
                } catch (error) {
                    ctx.reportError("MuteUnmuteServers", error);
                }
            }
            ctx.toasts.show(`${word} done: ${count} of ${ids.length} servers updated.`, count === ids.length ? "success" : "failure");
        };
        ctx.menuItems.add("mute-unmute-servers", click => {
            if (!guildIdFromTarget(click.target)) return null;
            return [
                { label: "Mute all servers", action: () => setAll(true) },
                { label: "Unmute all servers", action: () => setAll(false) }
            ];
        });
    }
};

export default plugin;
