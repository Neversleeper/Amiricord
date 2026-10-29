/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VibeCheck (author Sharp) as found in TestCord. Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const VIBES = [
    "✦ the vibes are immaculate ✦",
    "🌴 endless summer, endless mall 🌴",
    "📼 rewinding to a time that never was 📼",
    "🛍️ welcome to the mall, population: you 🛍️",
    "🌅 chasing a sunset that never sets 🌅",
    "💾 saving your aesthetic... done 💾",
    "🪩 disco ball energy detected 🪩",
    "🌊 floating on a sea of neon 🌊",
    "☎️ this call is being routed through 1987 ☎️",
    "🍹 sipping something pink by the fountain 🍹"
];

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "vibe",
            description: "Send a random vaporwave vibe",
            execute: () => ({ content: VIBES[Math.floor(Math.random() * VIBES.length)] })
        });
    }
};

export default plugin;
