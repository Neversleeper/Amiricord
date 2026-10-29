/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the patches of the plugin EquicordHelper (authors thororen, nyx, Naibuu) of Equicord. Only the four patches that fix crashes are kept: the rest
// of that plugin is Equicord's support-server interface (plugin cards, a warning in its support channel, its own title-bar setting), which does not exist here.
// All four were checked against the text of Discord's web build 653945 (`web.*.js`): the `throw Error(`Unknown resolution: ${e}`)` and `Unknown frame rate` lines, the
// `this.nextId();t(r),this.pending.set(r,{...reject:i})` line of the database worker, `await c(e)` before `this.databases` (in this build `c` already returns null), and
// `handleContextMenu=(e,t)=>{...link:t.url` of the GIF picker. Every patch is optional: if Discord moves one, only that fix is missing. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            // A resolution or frame rate that Discord does not know (a new preset) is passed through instead of throwing.
            find: "Unknown resolution:",
            required: false,
            replacements: [
                { match: /throw Error\(`Unknown resolution: \$\{(\i)\}`\)/, replace: "return $1;" },
                { match: /throw Error\(`Unknown frame rate: \$\{(\i)\}`\)/, replace: "return $1;" }
            ]
        },
        {
            // The pending operation was registered after the call that could answer it at once.
            find: ".completeOperation(",
            required: false,
            replacements: [{ match: /(?<=this\.nextId\(\);)(\i\(\i\)),(.{0,200}reject:\i\}\))/, replace: "$2,$1" }]
        },
        {
            // A database that fails to open leaves the start-up going.
            find: "discarding speculative database",
            required: false,
            replacements: [{ match: /await \i\(\i\)(?=;.{0,15}this\.databases)/, replace: "$&.catch(()=>null)" }]
        },
        {
            // The right-click menu of a favourite GIF gets the whole GIF object, not only its address.
            find: "renderEmptyFavorite",
            required: false,
            lazy: true,
            replacements: [{ match: /(?<=handleContextMenu.{0,150})(?=link:(\i)\.url)/, replace: "...$1," }]
        }
    ]
};

export default plugin;
