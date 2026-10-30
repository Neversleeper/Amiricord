/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoF1 (author Cyn) as found in TestCord's copy of Vencord's plugins. Same patch. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: ",\"f1\"],comboKeysBindGlobal:",
            lazy: true,
            required: false,
            replacements: [{ match: ",\"f1\"],comboKeysBindGlobal:", replace: "],comboKeysBindGlobal:" }]
        }
    ]
};

export default plugin;
