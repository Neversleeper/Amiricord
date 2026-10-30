/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowResourceChannels (author VillainsRule) as found in Equicord's copy of Vencord's plugins. Same patch. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: ".GUILD_DIRECTORY:null",
            lazy: true,
            required: false,
            replacements: [{ match: /\i\.hideResourceChannels&&/, replace: "false&&" }]
        }
    ]
};

export default plugin;
