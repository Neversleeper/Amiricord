/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SmallCaps (author Sharp) as found in TestCord. `/smallcaps` rewrites the text you give it and sends the result as your message.
// Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

const caps: Record<string, string> = {
    a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
    j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
    s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ"
};
export const convert = (text: string): string => text.toLowerCase().replace(/[a-z]/g, c => caps[c] ?? c);

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "smallcaps",
            description: "Convert to small caps",
            options: [{ name: "message", description: "The text to convert", type: "string", required: true }],
            execute(args) {
                const text = String(args.find(arg => arg.name === "message")?.value ?? "");
                return { content: convert(text) };
            }
        });
    }
};

export default plugin;
