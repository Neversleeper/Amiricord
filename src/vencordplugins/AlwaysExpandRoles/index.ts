/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AlwaysExpandRoles (author surgedevs) as found in TestCord's copy of Vencord's plugins. Same patches. The original removes the arrow with `predicate` when "Hide Arrow" is on; here the patched code asks the plugin when it runs, so the option works without a restart. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    hideArrow: { type: "boolean", default: false, description: "Hide the arrow that shows and hides the roles" }
});

const plugin: PluginCode & { hideArrow(): boolean; } = {
    settings,
    patches: [
        {
            find: "hasDeveloperContextMenu:",
            lazy: true,
            required: false,
            replacements: [
                { match: /(?<=\?\i\.current\[\i\].{0,100}?)useState\(!1\)/, replace: "useState(!0)" },
                // Without this the roles that do not fit are never counted, because they start expanded and the collapse button never appears
                { match: /(?<=useLayoutEffect\(\(\)=>\{if\()\i/, replace: "false" },
                { match: /return (\i\.length<\i\.length)/, replace: "return $self.hideArrow()?false:$1" }
            ]
        }
    ],

    hideArrow() {
        return settings.store.hideArrow;
    }
};

export default plugin;
