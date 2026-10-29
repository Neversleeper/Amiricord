/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SpaceOut (author Sharp) as found in TestCord. `/spaceout` rewrites the text you give it and sends the result as your message.
// Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const convert = (text: string): string => text.split("").join(" ");

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "spaceout",
            description: "Space out every letter",
            options: [{ name: "message", description: "The text to convert", type: "string", required: true }],
            execute(args) {
                const text = String(args.find(arg => arg.name === "message")?.value ?? "");
                return { content: convert(text) };
            }
        });
    }
};

export default plugin;
