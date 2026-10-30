/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FixCodeblockGap (author Grzesiek11) as found in TestCord's copy of Vencord's plugins. Same patch: the rule that reads code blocks gets an optional newline after the closing fence. Not checked live (the anchor is a regular expression written in Discord's code).

import type { PluginCode } from "../../renderer/engine";

const FENCE = "\u0060".repeat(3);
const CODE_BLOCK = "/^" + FENCE + "(?:([a-z0-9_+\-.#]+?)\n)?\n*([^\n][^]*?)\n*" + FENCE;

const plugin: PluginCode = {
    patches: [
        {
            find: CODE_BLOCK,
            lazy: true,
            required: false,
            replacements: [{ match: CODE_BLOCK, replace: "$&\n?" }]
        }
    ]
};

export default plugin;
