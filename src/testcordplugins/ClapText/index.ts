/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ClapText (author Sharp) as found in TestCord. `/clap` rewrites the text you give it and sends the result as your message.
// Not verified in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const convert = (text: string): string => text.split(/\s+/).filter(Boolean).join(" 👏 ");

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "clap",
            description: "Put claps between words",
            options: [{ name: "message", description: "The text to convert", type: "string", required: true }],
            execute(args) {
                const text = String(args.find(arg => arg.name === "message")?.value ?? "");
                return { content: convert(text) };
            }
        });
    }
};

export default plugin;
