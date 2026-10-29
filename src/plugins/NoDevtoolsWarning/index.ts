/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoDevtoolsWarning (author Ven) as found in TestCord (src/plugins/noDevtoolsWarning). A core plugin: always on, and its card
// is drawn only for the owners (`OWNER_ONLY_PLUGINS`). It is on by default because the developer tools are on by default (docs/decisions.md): a person who is asked to open
// the console and read a plugin's errors should not first see "Hold Up!" and be scared.
// In Discord's web build (read in 652418, module with `setDevtoolsCallbacks`) the code is `if(null==tn||"0.0.0"!==tn.app.getVersion()){ ...setDevtoolsCallbacks(()=>{hideToken(),printWarning()},()=>{showToken()}) ... }`;
// the original's pattern matches it as it is, and the whole check becomes `if(false)`. Not tried in a real Discord at the time of writing.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "setDevtoolsCallbacks",
            replacements: [{
                match: /if\(null==\i\|\|"0\.0\.0"!==\i\.app\.getVersion\(\)\)/,
                replace: "if(false)"
            }]
        }
    ]
};

export default plugin;
