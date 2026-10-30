/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MediaPlaybackSpeed (author D3SOX) as found in Equicord's copy of Vencord's plugins. The original also draws a speed button with a menu on each player (three patches into Discord's players). This port keeps the default speeds only: when any video or sound starts, its speed is set to the one in the settings (voice messages, other sounds and videos each have one), once per player. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const speed = (description: string) => ({ type: "number" as const, default: 1, min: 0.25, max: 3.5, description });

const settings = definePluginSettings({
    defaultVoiceMessageSpeed: speed("Speed of voice messages (0.25 to 3.5)"),
    defaultVideoSpeed: speed("Speed of videos (0.25 to 3.5)"),
    defaultAudioSpeed: speed("Speed of other sounds (0.25 to 3.5)")
});

/** The speed to set for a player, from its kind. */
export function speedFor(tag: string, className: string, values: { defaultVoiceMessageSpeed: number; defaultVideoSpeed: number; defaultAudioSpeed: number; }): number | undefined {
    if (tag === "VIDEO") return values.defaultVideoSpeed;
    if (tag === "AUDIO") return className.includes("audioElement") ? values.defaultVoiceMessageSpeed : values.defaultAudioSpeed;
    return undefined;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const seen = new WeakSet<Element>();
        const onPlay = (event: Event) => {
            const media = event.target as HTMLMediaElement | null;
            if (!media || seen.has(media)) return;
            seen.add(media);
            const value = speedFor(media.tagName, String(media.className), settings.store);
            if (value !== undefined && value !== 1) media.playbackRate = value;
        };
        document.addEventListener("play", onPlay, true);
        ctx.onDispose(() => { document.removeEventListener("play", onPlay, true); });
    }
};

export default plugin;
