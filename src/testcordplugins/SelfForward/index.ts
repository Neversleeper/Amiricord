/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SelfForward (author VillainsRule) as found in TestCord. Same patch: Discord leaves the channel you are in out of the
// "forward to" list (`g=null==o||U?[]:[o.id]`); the patch makes that list of left-out channels empty. Checked live on build 655747: one module (446244), one match.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: ".getChannelHistory(),",
            lazy: true,
            replacements: [{ match: /(?<=:\[)\i\.id(?=\])/, replace: "" }]
        }
    ]
};

export default plugin;
