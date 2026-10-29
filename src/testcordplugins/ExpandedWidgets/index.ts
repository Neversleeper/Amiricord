/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ExpandedWidgets as found in TestCord. Same patch. Checked live on build 655747: one module (753437), one match.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "BETTER_THAN_YOU]:{",
            lazy: true,
            replacements: [{ match: /(type:)"radio"/, replace: "$1\"checkbox\"" }]
        }
    ]
};

export default plugin;
