/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoMosaic (author AutumnVN) as found in TestCord's copy of Vencord's plugins. Same three patches. Difference: the original's
// setting "Play videos without carousel modal" (default on, applied by leaving the third patch out) is not carried over: the third patch is always applied.
// Checked live on build 655747: each anchor is in one module (127038, 394839, 91688) and the pattern matches in each.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "\"PLAINTEXT_PREVIEW\":\"OTHER\"",
            lazy: true,
            replacements: [{ match: /"IMAGE"===\i\|\|"VIDEO"===\i\|\|"CLIP"===\i/, replace: "(false)" }]
        },
        {
            find: "return{visualMediaItems:",
            lazy: true,
            replacements: [{
                match: /return\{visualMediaItems:.+?props:(\i)(?=.{0,20}?\1\.item\.uniqueId)/,
                replace: "$&,useFullWidth:[\"IMAGE\",\"VIDEO\",\"CLIP\"].includes($1.item?.type)?false:undefined"
            }]
        },
        {
            find: "renderAttachments(",
            lazy: true,
            replacements: [{ match: /url:(\i)\.url\}\);return /, replace: "$&$1.content_type?.startsWith('image/')&&" }]
        }
    ]
};

export default plugin;
