/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MoreAlts (authors zastix and x2b) as found in TestCord (commit af92dba of its public repository).
// The original's patch looked for the module of the account switcher's "tooltip seen" flag, which Discord removed (build 652418: its health report said "no module
// matched" in every session). In that build the limit is a plain `5` in Discord's own account store (`MultiAccountStore`): when someone signs in, the list is cut to
// five and the tokens of the rest are deleted. This plugin's own patch (found by reading Discord's code, not taken from TestCord) puts the setting in both places.
// The "Manage Accounts" window has its own two fives (found by searching module source in a running Stable); the second patch changes them.
// Not verified in a real Discord: that nothing else in the switcher stops a sixth account. The setting is a whole number from 5 to 100, because a number below
// Discord's own five would delete the saved accounts that are over it.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    amtOfAcounts: { type: "number", default: 10, min: 5, max: 100, integer: true, restartNeeded: true, description: "The amount of alts to allow (5 is Discord's own limit; a lower number is not accepted because it would sign accounts out)." }
});

const plugin: PluginCode & { altLimit(): number; } = {
    settings,
    patches: [
        {
            // Discord's store of the accounts you can switch between.
            find: "static displayName=\"MultiAccountStore\"",
            // `(list = next).length > 5 && list.splice(5).forEach(remove)`: both fives become the setting.
            replacements: [{ match: /(\.length>)5(&&\i\.splice\()5\)/, replace: "$1$self.altLimit()$2$self.altLimit())" }]
        },
        {
            // The "Manage Accounts" window (read in a running Stable, module 623161): "Add an account" shows "Sorry, you can only add 5 accounts." when `accounts.length>=5`,
            // and the notice goes away when `accounts.length<5`. Both fives become the setting. The window loads when it is opened, so the patch is lazy.
            // "ImpressionNames." matters: without it the first module found is Discord's list of screen names, which has the word but not the fives.
            find: "ImpressionNames.MULTI_ACCOUNT_SWITCH_LANDING",
            lazy: true,
            required: false,
            replacements: [
                { match: /(\.length<)5(&&\i\(!1\))/, replace: "$1$self.altLimit()$2" },
                { match: /(\.length>=)5(\?\i\(!0\))/, replace: "$1$self.altLimit()$2" }
            ]
        }
    ],

    /** Called by the patched Discord code in place of its fixed limit. */
    altLimit() {
        return settings.store.amtOfAcounts;
    }
};

export default plugin;
