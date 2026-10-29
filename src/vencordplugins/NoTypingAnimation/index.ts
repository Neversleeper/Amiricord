/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoTypingAnimation (author AutumnVN) as found in TestCord's copy of Vencord's plugins.
// Same patch, with `all: true` because on build 653945 the text "dotCycle" is in several modules and the original would only change the first one it meets.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "dotCycle",
            all: true,
            lazy: true,
            replacements: [{ match: /focused:(\i)/g, replace: "_focused:$1=false" }]
        }
    ]
};

export default plugin;
