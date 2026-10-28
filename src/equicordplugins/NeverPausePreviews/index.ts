/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NeverPausePreviews (author vappstar) as found in TestCord's copy of Equicord's plugins.
// The original showed a warning in its settings (it makes Discord use more resources); here the warning is in the plugin's description.
// Differences from the original, read from Discord's web build 652418:
//  - the first patch is changed: in that build `streamerPaused` is a getter (`get streamerPaused(){let{isMainWindowFocused:e,...`), so the original's `streamerPaused(){`
//    does not match; this one puts `return false;` at the start of the getter. It matches exactly once in the files that could be read;
//  - the second patch (the stream tile asking whether the window is focused) is the original's, unchanged: its module is not among the files that could be read
//    without an account, so it is NOT known that it still matches; it is optional, so if it does not match only the first patch works.
// Tried in a real Discord (Stable): the owner reported that it works. Which of the two patches does the work was not checked.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "get streamerPaused(){",
            lazy: true,
            replacements: [{ match: /get streamerPaused\(\)\{/, replace: "$&return false;" }]
        },
        {
            find: "StreamTile",
            lazy: true,
            required: false,
            replacements: [{ match: /\i\.\i\.isFocused\(\)/, replace: "true" }]
        }
    ]
};

export default plugin;
