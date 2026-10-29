/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ImageLink as found in TestCord's copy of Vencord's plugins. Same patch (the link stays visible next to the embedded image).
// Checked live on build 655747: one module (448767), one match.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "={linkCount:0,onlyLinks:!1};function ",
            lazy: true,
            replacements: [{ match: /\i\.has\(\i\.type\)&&\(0,\i\.\i\)\(\i\)/, replace: "false" }]
        }
    ]
};

export default plugin;
