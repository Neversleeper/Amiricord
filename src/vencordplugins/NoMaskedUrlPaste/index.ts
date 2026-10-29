/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoMaskedUrlPaste (author CatNoir) as found in TestCord's copy of Vencord's plugins. Same patch.
// Checked live on build 655747: the anchor is in one module (683167) and the pattern matches there (twice; like the original, only the first is changed).

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: ".selection,preventEmojiSurrogates:",
            lazy: true,
            replacements: [{ match: /if\(null!=\i\.selection&&\i\.\i\.isExpanded\(\i\.selection\)\)/, replace: "if(false)" }]
        }
    ]
};

export default plugin;
