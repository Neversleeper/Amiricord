/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UnlockedAvatarZoom (author nakoyasha) as found in TestCord's copy of Vencord's plugins. Same patch; the original's slider
// is a number setting from 2 to 16. Checked live on build 655747: one module (59039), one match.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    zoomMultiplier: { type: "number", default: 4, min: 2, max: 16, integer: true, description: "How far the avatar picture can be zoomed" }
});

const plugin: PluginCode & { zoom(): number; } = {
    settings,
    patches: [
        {
            find: "changeAvatarButtonText",
            lazy: true,
            replacements: [{ match: /maxValue:\d/, replace: "maxValue:$self.zoom()" }]
        }
    ],

    zoom() {
        return settings.store.zoomMultiplier;
    }
};

export default plugin;
