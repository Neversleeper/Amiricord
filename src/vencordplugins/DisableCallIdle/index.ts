/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin DisableCallIdle (author Nuckyz) as found in TestCord's copy of Vencord's plugins. Same two patches.
// Checked on build 653945: the first anchor is in a module of 1257 characters and the second in the big one (both match).

import type { PluginCode } from "../../renderer/engine";

const plugin: PluginCode & { noop(): void; } = {
    patches: [
        {
            find: "this.idleTimeout.start(",
            lazy: true,
            replacements: [{ match: /this\.idleTimeout\.(start|stop)/g, replace: "$self.noop" }]
        },
        {
            find: "handleIdleUpdate(){",
            lazy: true,
            replacements: [{ match: "handleIdleUpdate(){", replace: "handleIdleUpdate(){return;" }]
        }
    ],

    noop() { }
};

export default plugin;
