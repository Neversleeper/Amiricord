/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SunsetChat (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord SunsetChat - sunset gradient behind chat */
[class*="chatContent"],
[class*="messagesWrapper"] {
    background:
        linear-gradient(180deg,
            rgba(255, 113, 206, 0.10) 0%,
            rgba(185, 103, 255, 0.08) 35%,
            rgba(1, 205, 254, 0.06) 70%,
            transparent 100%) !important;
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
