/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BoldText (author Sharp) as found in TestCord. `/bold` rewrites the text you give it and sends the result as your message.
// Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const convert = (text: string): string => [...text].map(ch => {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1D400 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1D41A + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1D7CE + c - 48);
    return ch;
}).join("");

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "bold",
            description: "Make your text unicode-bold",
            options: [{ name: "message", description: "The text to convert", type: "string", required: true }],
            execute(args) {
                const text = String(args.find(arg => arg.name === "message")?.value ?? "");
                return { content: convert(text) };
            }
        });
    }
};

export default plugin;
