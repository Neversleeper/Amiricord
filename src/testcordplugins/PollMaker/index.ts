/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PollMaker (author Dann) as found in TestCord. `/poll question | option | option` sends a message with the question and numbered options (1 to 10) to react to. New: empty options and repeated options are dropped, and the question line is cut so the message stays under Discord's limit. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"] as const;

/** The message for a poll typed as "question | option | option", or undefined when it has no question or fewer than two different options. */
export function pollText(input: string): string | undefined {
    const parts = input.split("|").map(part => part.trim()).filter(part => part !== "");
    const question = parts.shift();
    const options = [...new Set(parts)].slice(0, NUMBERS.length);
    if (!question || options.length < 2) return undefined;
    const body = options.map((option, index) => `${NUMBERS[index]} ${option}`).join("\n");
    return `📊 **${question.slice(0, 300)}**\n${body}`.slice(0, 2000);
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "poll",
            description: "Make a poll: question | option one | option two",
            options: [{ name: "text", description: "question | option | option ...", required: true }],
            execute(args) {
                const content = pollText(String(args.find(arg => arg.name === "text")?.value ?? ""));
                if (content === undefined) { ctx.toasts.show("A poll needs a question and at least two different options, split with |", "failure"); return undefined; }
                return { content };
            }
        });
    }
};

export default plugin;
