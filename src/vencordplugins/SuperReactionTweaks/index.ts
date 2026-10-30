/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SuperReactionTweaks (authors FieryFlames, ant0n) as found in TestCord's copy of Vencord's plugins. Same two patches and same rules. The slider became a number setting (0 to 100). "Super react by default" needs Nitro, read from Discord's premium store, found by name when the plugin starts. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    superReactByDefault: { type: "boolean", default: true, description: "The reaction picker opens on super reactions" },
    unlimitedSuperReactionPlaying: { type: "boolean", default: false, description: "No limit on super reactions playing at once" },
    superReactionPlayingLimit: { type: "number", default: 20, min: 0, max: 100, integer: true, description: "Most super reactions that play at once. 0 plays none" }
});

let premium: { get(): { getState(): { premiumTypeActual?: unknown; }; } | undefined; } | undefined;

/** Whether one more super reaction may play when `playing` are playing now. */
export function mayPlay(playing: number, unlimited: boolean, limit: number): boolean {
    return unlimited || limit > playing;
}

const plugin: PluginCode & { shouldPlayBurstReaction(playingCount: number): boolean; shouldSuperReactByDefault(): boolean; } = {
    settings,
    patches: [
        {
            find: ",BURST_REACTION_EFFECT_PLAY",
            lazy: true,
            required: false,
            // if (inlinedCalculatePlayingCount(a,b) >= limit) return;
            replacements: [{
                match: /(BURST_REACTION_EFFECT_PLAY:(?:\i=>|function\(\i\)){.+?if\()(\(?(?:function)?\(\i,\i\)(?:=>)?{.+?\(\i,\i\))>=5+?(?=\))/,
                replace: (_whole: string, rest: string, playingCount: string) => `${rest}!$self.shouldPlayBurstReaction(${playingCount})`
            }]
        },
        {
            find: ".EMOJI_PICKER_CONSTANTS_EMOJI_CONTAINER_PADDING_HORIZONTAL)",
            lazy: true,
            required: false,
            replacements: [{
                match: /(openPopoutType:void 0(?=.+?isBurstReaction:(\i).+?\.intention===(\i\.\i\.REACTION)).+?\[\2,\i\]=\i\.useState\()!1\)(?<=pickerIntention:(\i).+?)/,
                replace: (_whole: string, rest: string, _isBurstReaction: string, reactionIntention: string, pickerIntention: string) => `${rest}$self.shouldSuperReactByDefault()&&${pickerIntention}===${reactionIntention})`
            }]
        }
    ],

    start(ctx) {
        premium = ctx.finders.byStore<{ getState(): { premiumTypeActual?: unknown; }; }>("OverridePremiumTypeStore");
    },
    stop() {
        premium = undefined;
    },

    shouldPlayBurstReaction(playingCount) {
        return mayPlay(playingCount, settings.store.unlimitedSuperReactionPlaying, settings.store.superReactionPlayingLimit);
    },
    shouldSuperReactByDefault() {
        return settings.store.superReactByDefault && premium?.get()?.getState().premiumTypeActual !== null && premium?.get()?.getState().premiumTypeActual !== undefined;
    }
};

export default plugin;
