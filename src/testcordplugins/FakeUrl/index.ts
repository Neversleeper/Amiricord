/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FakeUrl (author x2b) as found in TestCord. Same message shape (a masked link with invisible characters mixed into the shown text, and optionally the destination in angle brackets so no preview shows). It is a command with three fields instead of the original's window. Use it only for fun with people who know; a link that hides where it goes can be used to trick people.

import type { PluginCode } from "../../renderer/engine";

const INVISIBLES = "​‌‍﻿⁠⁡⁢⁣⁤⁪⁫⁬⁭⁮⁯︀︁︂︃︄︅︆︇︈︉︊︋︌︍︎️";

/** The text with an invisible character after each visible one. `pick` gives a number in [0, 1). */
export function spoof(text: string, pick: () => number = Math.random): string {
    let out = "";
    for (const char of text) out += char + INVISIBLES[Math.floor(pick() * INVISIBLES.length)];
    return out;
}

/** The markdown of the masked link, or undefined when either part is empty. */
export function fakeLink(shown: string, destination: string, hideEmbed: boolean, pick?: () => number): string | undefined {
    const fake = shown.trim();
    const real = destination.trim().replace(/^<(.+)>$/, "$1");
    if (!fake || !real) return undefined;
    return `[${spoof(fake, pick)}](${hideEmbed ? `<${real}>` : real})`;
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "fakeurl",
            description: "Send a link that shows one text and goes to another address",
            options: [
                { name: "shown", description: "The text or address people will see", required: true },
                { name: "destination", description: "Where the link really goes", required: true },
                { name: "hide-embed", description: "Do not show a preview of the destination", type: "boolean" }
            ],
            execute(args) {
                const value = (name: string) => args.find(arg => arg.name === name)?.value;
                const content = fakeLink(String(value("shown") ?? ""), String(value("destination") ?? ""), value("hide-embed") === true);
                if (!content) { ctx.toasts.show("Both the shown text and the destination are needed.", "failure"); return; }
                return { content };
            }
        });
    }
};

export default plugin;
