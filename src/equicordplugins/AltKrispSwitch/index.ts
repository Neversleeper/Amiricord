/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AltKrispSwitch (author newwares) as found in Equicord's copy of Vencord's plugins. Same patch and same decision method. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode & { shouldCancelSuppression(args: [boolean, { section?: string; } | undefined]): boolean; } = {
    patches: [
        {
            find: ",setNoiseCancellation(",
            lazy: true,
            required: false,
            replacements: [{
                match: /(}\),)(.{1,10}\.\i\.dispatch\({type:"AUDIO_SET_NOISE_SUPPRESSION",)/,
                replace: "$1!$self.shouldCancelSuppression(arguments)&&$2"
            }]
        }
    ],

    shouldCancelSuppression([enableKrisp, options]) {
        return options?.section === "Noise Cancellation Popout" && !enableKrisp;
    }
};

export default plugin;
