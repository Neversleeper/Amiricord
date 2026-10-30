/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NewGuildSettings (authors Glitch, Nuckyz, carince) as found in TestCord's copy of Vencord's plugins. Same settings and the same request to Discord (the notification settings of the server). The original reacts to its own patch of Discord's join function; here a server counts as new when Discord says you joined it in the last two minutes, so settings are not applied again to every server at start. "Show all channels" and "hide voice channel names" are not ported. The meaning of the highlights value is taken from the original and not checked.

import { guildIdFromTarget } from "../../api/clickTargets";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    guild: { type: "boolean", default: true, description: "Mute the server automatically" },
    messages: {
        type: "select", default: "3", description: "Server notification settings",
        options: [{ label: "All messages", value: "0" }, { label: "Only @mentions", value: "1" }, { label: "Nothing", value: "2" }, { label: "Server default", value: "3" }]
    },
    everyone: { type: "boolean", default: true, description: "Suppress @everyone and @here" },
    role: { type: "boolean", default: true, description: "Suppress all role @mentions" },
    highlights: { type: "boolean", default: true, description: "Suppress highlights" },
    events: { type: "boolean", default: true, description: "Mute new events" },
    mobilePush: { type: "boolean", default: true, description: "Mute mobile push notifications" }
});

export interface NewGuildValues { guild: boolean; messages: string; everyone: boolean; role: boolean; highlights: boolean; events: boolean; mobilePush: boolean; }
export const NEW_GUILD_WINDOW_MS = 2 * 60_000;

/** The requests (bodies) to send for one server: the main settings, and the message level on its own when one was chosen. */
export function guildSettingsBodies(values: NewGuildValues): Array<Record<string, unknown>> {
    const bodies: Array<Record<string, unknown>> = [{
        muted: values.guild, mobile_push: !values.mobilePush, suppress_everyone: values.everyone, suppress_roles: values.role,
        mute_scheduled_events: values.events, notify_highlights: values.highlights ? 1 : 0
    }];
    if (values.messages !== "3") bodies.push({ message_notifications: Number(values.messages) });
    return bodies;
}

/** Whether a server joined at this time counts as new. */
export function isNewJoin(joinedAt: string | number | undefined, now: number): boolean {
    if (joinedAt === undefined) return false;
    const time = typeof joinedAt === "number" ? joinedAt : Date.parse(joinedAt);
    return Number.isFinite(time) && now - time >= 0 && now - time <= NEW_GUILD_WINDOW_MS;
}

interface Rest { patch(request: { url: string; body: unknown; }): Promise<unknown>; }

let apply: ((guildId: string) => Promise<void>) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        apply = async guildId => {
            for (const body of guildSettingsBodies(settings.store)) {
                try {
                    await rest.get()?.patch({ url: `/users/@me/guilds/${guildId}/settings`, body });
                } catch (error) {
                    ctx.reportError("NewGuildSettings", error);
                }
            }
        };
        ctx.menuItems.add("apply-new-guild-settings", click => {
            const id = guildIdFromTarget(click.target);
            return id ? { label: "Apply NewGuildSettings", action: async () => { await apply?.(id); ctx.toasts.show("Notification settings applied.", "success"); } } : null;
        });
    },
    flux: {
        GUILD_CREATE({ guild }: { guild?: { id: string; joined_at?: string; unavailable?: boolean; }; }) {
            if (guild && !guild.unavailable && isNewJoin(guild.joined_at, Date.now())) void apply?.(guild.id);
        }
    },
    stop() {
        apply = undefined;
    }
};

export default plugin;
