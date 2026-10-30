/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoDraftLengthLimit (author x2b) as found in TestCord. Same idea and anchor. The original names a minified export (`.CS1`) that changes with every build; here that name is any name. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "ApplicationLauncherCommand=3",
            lazy: true,
            required: false,
            replacements: [{ match: /(let \i=)\i\(\d+\)\.\i\+500/, replace: "$1Number.MAX_SAFE_INTEGER" }]
        }
    ]
};

export default plugin;
