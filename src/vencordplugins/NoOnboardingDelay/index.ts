/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoOnboardingDelay (author nekohaxx) as found in TestCord's copy of Vencord's plugins. Same patch. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "step:-1,required:!0",
            lazy: true,
            required: false,
            replacements: [{ match: /(setTimeout\(\(\)=>\{\i\.current=!0,\i\(\)\},)3e3\)/, replace: "$10)" }]
        }
    ]
};

export default plugin;
