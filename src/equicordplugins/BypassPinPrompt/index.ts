/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BypassPinPrompt as found in TestCord's copy of Equicord's plugins. Same three patches (the message menu, the pin button and
// the pins panel). Checked live on build 655747: each anchor is in one module (519222, 979766, 945830) and the pattern matches in each.

import type { PluginCode } from "../../renderer/engine";

const PIN_CALL = /(\i\.\i\.(?:unpin|pin)Message\(\i,\i\.id\)):\i\.\i\.confirm(?:Unpin|Pin)\(\i,\i\)/g;

const plugin: PluginCode = {
    patches: ['source:"message-actions"', 'id:"pin",action', "\"Channel Pins\""].map(find => ({
        find,
        lazy: true,
        replacements: [{ match: PIN_CALL, replace: "$1:$1" }]
    }))
};

export default plugin;
