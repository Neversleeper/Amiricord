/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GridFloor (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
body::before {
    content: "";
    position: fixed;
    left: -50%;
    right: -50%;
    bottom: 0;
    height: 38vh;
    z-index: 1;
    pointer-events: none;
    background-image:
        linear-gradient(rgba(1, 205, 254, 0.5) 2px, transparent 2px),
        linear-gradient(90deg, rgba(255, 113, 206, 0.45) 2px, transparent 2px);
    background-size: 48px 48px;
    transform: perspective(320px) rotateX(74deg);
    mask-image: linear-gradient(transparent, #000 80%);
    -webkit-mask-image: linear-gradient(transparent, #000 80%);
    animation: mc-grid 4s linear infinite;
}

@keyframes mc-grid {
    from { background-position: 0 0; }
    to { background-position: 0 48px; }
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
