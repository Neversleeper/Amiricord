/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NewlinesInCommands (author x2b) as found in TestCord. Same patch (a new case for the Enter key in the editor's key handler, placed before the Tab case, written with the same captured names). It only applies if Discord's editor code still looks like the original's. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "\"italics\"),!0;",
            lazy: true,
            required: false,
            replacements: [
                {
                    match: /case (\i\.\i)\.TAB:if\(null!=(\i).selection&&\i\((\i)(?=.{0,300}(\i\.\i\.insertText))/,
                    replace: "case $1.ENTER:if($3.shiftKey){$3.preventDefault();$3.stopPropagation();$4($2,'\\n');return true}break;$&"
                }
            ]
        }
    ]
};

export default plugin;
