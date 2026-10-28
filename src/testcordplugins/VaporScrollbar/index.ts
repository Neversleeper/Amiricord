/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VaporScrollbar (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord VaporScrollbar - neon gradient scrollbars */
::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #ff71ce, #b967ff, #01cdfe) !important;
    border-radius: 8px !important;
    border: 2px solid transparent !important;
    background-clip: padding-box !important;
}

::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #01cdfe, #b967ff, #ff71ce) !important;
}

::-webkit-scrollbar-track {
    background: rgba(25, 0, 51, 0.4) !important;
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
