/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ReadableSpoilers (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord ReadableSpoilers - outline unrevealed spoilers */
[class*="spoilerContent"]:not([class*="spoilerContentHidden"]),
span[class*="spoilerText"]:not([class*="hidden"]) {
    /* revealed: leave untouched */
}

[class*="spoilerContent"],
[class*="spoilerWarning"] {
    outline: 1px dashed rgba(1, 205, 254, 0.7);
    outline-offset: 1px;
    border-radius: 4px;
    box-shadow: 0 0 6px rgba(255, 113, 206, 0.35);
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
