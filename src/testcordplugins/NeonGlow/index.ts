/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NeonGlow (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord NeonGlow - hover glow accents */
img[class*="avatar"]:hover,
[class*="wrapper"] img[class*="avatar"]:hover {
    box-shadow: 0 0 12px 2px #ff71ce, 0 0 22px 4px #01cdfe;
    border-radius: 50%;
    transition: box-shadow 0.2s ease;
}

a:hover,
[class*="anchor"]:hover {
    text-shadow: 0 0 8px #01cdfe;
}

button[class*="lookFilled"]:hover {
    box-shadow: 0 0 14px rgba(255, 113, 206, 0.6);
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
