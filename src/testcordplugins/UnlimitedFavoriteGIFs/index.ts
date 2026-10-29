/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UnlimitedFavoriteGIFs (by Neversleeper, who posted it in TestCord under another account) as found in TestCord.
// It lifts Discord's limit on how many favourite GIFs an account can have: the check that compares the size of the saved settings with a fixed number is
// changed to compare with the largest safe integer. The anchor and the expression were run against the main bundle of Discord build 653945 and matched once.
// Differences, NOT verified in a real Discord: the original also looked through every module at run time and put a changed copy of Discord's code in its
// place (`eval`), which Amiricord's rules do not allow, so the limit is lifted only by the patch and needs a restart of Discord after switching the plugin on;
// the original's "Export local favorites" and "Clear local favorites" buttons are NOT carried over (nothing ever wrote that list, so they only ever said
// "nothing to export"); GifTransfer lifts the same limit, so when both are on the second patch finds nothing left to change and says nothing.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "toBinary(t).length>",
            required: false,
            replacements: [{ match: /\.toBinary\((\i)\)\.length>\d+/, replace: ".toBinary($1).length>Number.MAX_SAFE_INTEGER" }]
        }
    ]
};

export default plugin;
