/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Starfield (author Sharp) as found in TestCord's plugins (commit af92dba). Same look, written
// against Amiricord's engine: the style sheet is kept in this file and added with `ctx.addStyle`, which removes it again when the plugin stops
// or fails to start. The selectors match Discord's class names by part of the name, as the original did; whether they still match the
// current Discord build was not checked in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const CSS = `
html::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image:
        radial-gradient(1px 1px at 20% 30%, #fff, transparent),
        radial-gradient(1px 1px at 70% 60%, #01cdfe, transparent),
        radial-gradient(1px 1px at 40% 80%, #ff71ce, transparent),
        radial-gradient(1px 1px at 90% 20%, #fff, transparent),
        radial-gradient(1px 1px at 55% 15%, #b967ff, transparent);
    background-repeat: repeat;
    background-size: 240px 240px;
    opacity: 0.5;
    animation: mc-twinkle 5s ease-in-out infinite alternate;
}

@keyframes mc-twinkle {
    from { opacity: 0.25; }
    to { opacity: 0.65; }
}
`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS);
    }
};

export default plugin;
