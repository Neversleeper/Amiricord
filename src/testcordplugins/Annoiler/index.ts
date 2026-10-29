/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Annoiler (author x2b, idea by Kyza for Powercord) as found in TestCord. Not verified in a real Discord. Discord limits a message
// to 2000 characters, so a long text stops being sent as it grows: each letter costs five characters (||x||).

import type { PluginCode } from "../../renderer/engine";

export const MESSAGE_LIMIT = 2000;

/** Every character inside its own spoiler. Spaces and line breaks are left alone, since a spoiler around them hides nothing. */
export const annoil = (text: string): string => [...text].map(char => (/\s/.test(char) ? char : `||${char}||`)).join("");

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "annoil",
            description: "Send your message with a spoiler around every single character",
            options: [{ name: "message", description: "The text to hide", type: "string", required: true }],
            execute(args) {
                const content = annoil(String(args.find(arg => arg.name === "message")?.value ?? ""));
                if (content.length > MESSAGE_LIMIT) {
                    ctx.toasts.show(`That text is too long: with a spoiler on every letter it takes ${content.length} of the ${MESSAGE_LIMIT} characters Discord allows.`, "failure");
                    return undefined;
                }
                return { content };
            }
        });
    }
};

export default plugin;
