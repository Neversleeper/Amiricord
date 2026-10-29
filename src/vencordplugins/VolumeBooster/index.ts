/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VolumeBooster (authors Nuckyz and sadan) as found in TestCord's copy of Vencord's plugins.
// The patches are the original's, with Discord's translation key USER_VOLUME written as its hash (`m7TNdF`). The group of patches the original used only on the web
// and Vesktop (`streamSourceNode`, with `patchVolume`) is NOT carried over: Amiricord only runs in Discord's desktop app, where the original skipped it too.
// Checked on build 653945: the "AudioContextSettingsMigrated" patch matches once and the MediaEngineStore one matches once; the slider ones (USER_VOLUME and
// `currentVolume:`) are in code Discord loads later, so they are lazy and NOT known to match. The slider's "multiplier" is read when the page loads, so a change needs a restart.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    multiplier: {
        type: "select",
        default: 2,
        restartNeeded: true,
        description: "Volume multiplier: how many times louder than Discord's maximum (200%) the volume sliders may go.",
        options: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(value => ({ label: `${value}x`, value }))
    }
} as const);

const plugin: PluginCode & { multiplier(): number; } = {
    settings,

    patches: [
        {
            find: ".t.m7TNdF",
            lazy: true,
            required: false,
            replacements: [{
                match: /(?<=maxValue:)\i\.isPlatformEmbedded\?(\i\.\i):\i\.\i(?=,)/,
                replace: "$1*$self.multiplier()"
            }]
        },
        {
            find: "currentVolume:",
            lazy: true,
            required: false,
            replacements: [{
                match: /(?<=maxValue:)\i\.\i\?(\d+?):\d+?(?=,)/,
                replace: "$1*$self.multiplier()"
            }]
        },
        {
            // Discord's audio settings sync must not try to save values above 200: they are cut to 200 before they go to Discord.
            find: "AudioContextSettingsMigrated",
            lazy: true,
            replacements: [
                {
                    match: /(?<=isLocalMute\(\i,\i\),volume:(\i).+?\(0,\i\.\i\)\(\i,\i,\{volume:)\1(?=\}\))/,
                    replace: "$&>200?200:$&"
                },
                {
                    match: /(?<=Object\.entries\(\i\.localMutes\).+?volume:).+?(?=,)/,
                    replace: "$&>200?200:$&"
                },
                {
                    match: /(?<=Object\.entries\(\i\.localVolumes\).+?volume:).+?(?=})/,
                    replace: "$&>200?200:$&"
                }
            ]
        },
        {
            // The MediaEngineStore must not overwrite our volumes above 200 with the ones the settings sync sends.
            find: '="MediaEngineStore",',
            lazy: true,
            replacements: [{
                match: /(\.settings\.audioContextSettings.+?)(\i\[\i\])=(\i\.volume)(.+?setLocalVolume\(\i,).+?\)/,
                replace: "$1($2>200?void 0:$2=$3)$4$2??$3)"
            }]
        }
    ],

    multiplier() {
        return settings.store.multiplier;
    }
};

export default plugin;
