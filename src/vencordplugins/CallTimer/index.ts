/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CallTimer (author Nuckyz) as found in TestCord's copy of Vencord's plugins. The original draws the time on the call panel; the panel cannot be changed by plugins yet, so the time is asked for with the command and shown as a notice. The start is the moment this plugin saw you join (it cannot know about a call you were already in when Discord started, in which case it counts from the start of Discord).

import type { PluginCode } from "../../renderer/engine";

/** "1:05:09" or "5:09": hours only when there are some. */
export function formatDuration(milliseconds: number): string {
    const total = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const two = (value: number) => value.toString().padStart(2, "0");
    return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

let joinedAt: number | undefined;
let joinedIn: string | null = null;

const plugin: PluginCode & { onVoiceChannel?: (channelId: string | null) => void; } = {
    start(ctx) {
        const selected = ctx.common.SelectedChannelStore;
        const voiceId = () => (selected.get() as unknown as { getVoiceChannelId(): string | null; } | undefined)?.getVoiceChannelId() ?? null;
        joinedIn = voiceId();
        joinedAt = joinedIn ? Date.now() : undefined;
        plugin.onVoiceChannel = channelId => {
            if (channelId === joinedIn) return;
            joinedIn = channelId;
            joinedAt = channelId ? Date.now() : undefined;
        };
        ctx.commands.add({
            name: "calltime",
            description: "Show how long you have been in your voice call",
            execute() {
                if (!joinedIn || joinedAt === undefined) { ctx.toasts.show("You are not in a voice call.", "failure"); return; }
                ctx.notifications.show({ title: "Call time", body: formatDuration(Date.now() - joinedAt) });
            }
        });
    },
    flux: {
        VOICE_CHANNEL_SELECT(event: { channelId?: string | null; }) { plugin.onVoiceChannel?.(event.channelId ?? null); }
    },
    stop() { plugin.onVoiceChannel = undefined; joinedAt = undefined; joinedIn = null; }
};

export default plugin;
