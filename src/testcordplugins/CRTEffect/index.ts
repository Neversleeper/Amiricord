/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CRTEffect (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
/* MallCord CRTEffect - scanline + flicker overlay */
body::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 100000;
    pointer-events: none;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.16) 0,
        rgba(0, 0, 0, 0.16) 1px,
        transparent 1px,
        transparent 3px
    );
    mix-blend-mode: multiply;
    animation: mc-crt-flicker 6s steps(60) infinite;
}

@keyframes mc-crt-flicker {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 1; }
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
