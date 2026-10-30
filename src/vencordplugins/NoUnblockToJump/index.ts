/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoUnblockToJump (author Rini) as found in TestCord's copy of Vencord's plugins. Same patch, with the `#{intl::}` key notation. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "#{intl::UNIGNORE_TO_JUMP_BODY}",
            lazy: true,
            required: false,
            replacements: [{ match: /if\(\i\.\i\.isBlockedForMessage\(/, replace: "return true;$&" }]
        }
    ]
};

export default plugin;
