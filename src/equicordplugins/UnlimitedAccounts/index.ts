/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UnlimitedAccounts (author thororen) as found in Equicord's copy of Vencord's plugins. Same four patches. As the original says, the first one is best effort: Discord's account list starts before the engine can patch it, so that part only caps the saved list when the connection opens. The option is a number (0 = no limit); the patched code reads it when it runs.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    maxAccounts: { type: "number", default: 0, min: 0, max: 1000, integer: true, description: "How many accounts can be added, or 0 for no limit" }
});

const plugin: PluginCode & { getMaxAccounts(): number; } = {
    settings,
    patches: [
        {
            // The account list starts before the patcher can hook it, so this one is best effort: it caps the saved list when the connection opens
            find: "pushSyncToken:null}),",
            lazy: true,
            required: false,
            replacements: [
                { match: /(\).length>)5/, replace: "$1$self.getMaxAccounts()" },
                { match: /(\i.splice\()5/, replace: "$1$self.getMaxAccounts()" }
            ]
        },
        {
            // The switch accounts window keeps the add button behind a fixed maxNumAccounts and its own length>=5 checks. This chunk loads late, so the patch applies reliably
            find: "getCurrentUser(),multiAccountUsers",
            lazy: true,
            required: false,
            replacements: [
                { match: /(maxNumAccounts:)5/, replace: "$1$self.getMaxAccounts()" },
                { match: /(\i\.length(?:<|>=))5/g, replace: "$1$self.getMaxAccounts()" }
            ]
        }
    ],

    getMaxAccounts() {
        return settings.store.maxAccounts === 0 ? Infinity : settings.store.maxAccounts;
    }
};

export default plugin;
