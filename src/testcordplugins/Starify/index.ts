/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Starify (author Sharp) as found in TestCord. Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const starify = (text: string): string => `✦ﾟ｡⋆ ${text} ⋆｡ﾟ✦`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "starify",
            description: "Decorate your message with sparkles",
            options: [{ name: "message", description: "The text to decorate", type: "string", required: true }],
            execute(args) {
                return { content: starify(String(args.find(arg => arg.name === "message")?.value ?? "")) };
            }
        });
    }
};

export default plugin;
