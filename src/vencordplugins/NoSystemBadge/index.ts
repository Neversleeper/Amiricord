/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoSystemBadge (author rushii) as found in TestCord's copy of Vencord's plugins. Same two patches (the functions that set the badge and the tray icon are replaced by ones that do nothing). Windows only has the taskbar badge; the tray part is the one Discord uses for its own icon. The patches are optional: if Discord changes that code they simply do not apply. Not checked against this Discord build.

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode = {
    patches: [
        {
            find: ",setSystemTrayApplications",
            lazy: true,
            required: false,
            replacements: [
                { match: /setBadge\(\i\).+?},/, replace: "setBadge(){}," },
                { match: /setSystemTrayIcon\(\i\).+?},/, replace: "setSystemTrayIcon(){}," }
            ]
        }
    ]
};

export default plugin;
