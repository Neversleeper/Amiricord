/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin LeetText (author Sharp) as found in TestCord. `/leet` rewrites the text you give it and sends the result as your message.
// Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

const swaps: Record<string, string> = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7", b: "8", g: "9", l: "1" };
export const convert = (text: string): string => text.replace(/[aeiostbgl]/gi, c => swaps[c.toLowerCase()]);

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "leet",
            description: "Convert to leetspeak",
            options: [{ name: "message", description: "The text to convert", type: "string", required: true }],
            execute(args) {
                const text = String(args.find(arg => arg.name === "message")?.value ?? "");
                return { content: convert(text) };
            }
        });
    }
};

export default plugin;
