/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BlockKrisp (author D3SOX) as found in Equicord's copy of Vencord's plugins. Same three patches. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            // Desktop: do not load the module
            find: "Failed to load Krisp module",
            lazy: true,
            required: false,
            replacements: [{ match: /await \i.\i.ensureModule\("discord_krisp"\)/, replace: "await Promise.resolve()" }]
        },
        {
            // Web: do not load the models
            find: "krisp_browser_models",
            lazy: true,
            required: false,
            replacements: [{ match: /if\(this._noiseCancellation\)/, replace: "if(false)" }]
        },
        {
            // Tell Discord Krisp is not supported
            find: "isNoiseCancellationSupported(){",
            lazy: true,
            required: false,
            replacements: [{ match: /isNoiseCancellationSupported\(\)\{/, replace: "$&return false;" }]
        }
    ]
};

export default plugin;
