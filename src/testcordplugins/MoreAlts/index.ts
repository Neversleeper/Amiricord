/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MoreAlts (authors zastix and x2b) as found in TestCord (commit af92dba of its public repository).
// The original's patch looked for the module of the account switcher's "tooltip seen" flag, which Discord removed (build 652418: its health report said "no module
// matched" in every session). In that build the limit is a plain `5` in Discord's own account store (`MultiAccountStore`): when someone signs in, the list is cut to
// five and the tokens of the rest are deleted. This plugin's own patch (found by reading Discord's code, not taken from TestCord) puts the setting in both places.
// Seen in build 653945: the store has the same two fives, and the "Manage Accounts" window checks three more of its own (with the store patch alone the owner saw
// "Sorry, you can only add 5 accounts"), so a second patch takes those; both are tested against the real modules. Not verified in a real Discord: that a sixth account
// can really be added. The setting is a whole number from 5 to 100, because a number below
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
            // Discord's "Manage Accounts" window (build 653945), loaded when it is first opened. It checks the same five by itself: the button "Add an account" shows
            // "Sorry, you can only add 5 accounts" when the list has five or more, an effect hides that notice when it has fewer than five, and the notice names the number.
            // All three become the setting, or none does, so the button and the notice never disagree.
            find: "maxNumAccounts:5",
            group: true,
            lazy: true,
            required: false,
            replacements: [
                { match: /(\i\.length>=)5(\?\i\(!0\):)/, replace: "$1$self.altLimit()$2" },
                { match: /(\i\.length<)5(&&\i\(!1\))/, replace: "$1$self.altLimit()$2" },
                { match: /maxNumAccounts:5/, replace: "maxNumAccounts:$self.altLimit()" }
            ]
        },
        {
            // The list of accounts that opens from the profile panel at the bottom left (build 653945: a submenu, `navId:"switch-accounts-submenu"`, with one row per account and
            // "Manage Accounts" last). With more than five accounts it grows taller than the window and the last row, the one that opens Manage Accounts, falls off the screen.
            // The patch gives the menu a class of ours and `start` adds the CSS that makes it scroll.
            find: "navId:\"switch-accounts-submenu\"",
            lazy: true,
            required: false,
            replacements: [{ match: /navId:"switch-accounts-submenu",/, replace: "navId:\"switch-accounts-submenu\",className:\"amiricord-account-list\"," }]
        }
    ],

    start(ctx) {
        ctx.addStyle(".amiricord-account-list{max-height:min(60vh,26rem);overflow-y:auto}", "more-alts");
    },

    /** Called by the patched Discord code in place of its fixed limit. */
    altLimit() {
        return settings.store.amtOfAcounts;
    }
};

export default plugin;
