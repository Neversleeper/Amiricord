/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BetterGifPicker (author Samwich) as found in TestCord's copy of Vencord's plugins. Same patch.
// Checked on build 653945: the anchor and the replacement match once, in the module of the GIF picker.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "renderHeaderContent(){",
            lazy: true,
            replacements: [{ match: /(?<=state={resultType:)null/, replace: '"Favorites"' }]
        }
    ]
};

export default plugin;
