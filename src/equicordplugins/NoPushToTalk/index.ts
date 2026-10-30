/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoPushToTalk (author omaw) as found in Equicord's copy of Vencord's plugins. Same three patches. Not checked live.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: "PermissionVADStore",
            lazy: true,
            required: false,
            replacements: [
                { match: /\|\|\i\.\i\.can\(\i\.\i\.USE_VAD,\i\)\|\|/, replace: "||true||" },
                { match: /shouldShowWarning\(\)\{return!\i\}/, replace: "shouldShowWarning(){return false}" },
                { match: /canUseVoiceActivity\(\)\{return \i\}/, replace: "canUseVoiceActivity(){return true}" }
            ]
        }
    ]
};

export default plugin;
