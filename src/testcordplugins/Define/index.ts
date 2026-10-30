/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Define (author Sharp) as found in TestCord. The answer opens in a window instead of being a message only you see (the engine cannot yet show a private message). The word is sent to the free dictionary service api.dictionaryapi.dev, which learns your address and the word.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

interface Entry { phonetic?: string; meanings?: Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string; example?: string; }>; }>; }

/** The lines to show for a dictionary answer: up to three meanings, each with its first definition and example. */
export function definitionLines(data: unknown): Array<{ kind: string; text: string; example?: string; }> {
    const entry = Array.isArray(data) ? (data[0] as Entry | undefined) : undefined;
    const lines: Array<{ kind: string; text: string; example?: string; }> = [];
    for (const meaning of (entry?.meanings ?? []).slice(0, 3)) {
        const first = meaning.definitions?.[0];
        if (first?.definition) lines.push({ kind: meaning.partOfSpeech ?? "", text: first.definition, example: first.example });
    }
    return lines;
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "define",
            description: "Look up the definition of a word (shown only to you)",
            options: [{ name: "word", description: "The word", required: true }],
            async execute(args) {
                const word = String(args.find(arg => arg.name === "word")?.value ?? "").trim();
                if (!word) return;
                try {
                    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
                    const lines = response.ok ? definitionLines(await response.json()) : [];
                    if (lines.length === 0) { ctx.toasts.show(`No definition found for "${word}".`, "failure"); return; }
                    openPanelWindow(ctx, word, kit => kit.panel(kit.card(lines.map((line, index) => kit.item(String(index), null, line.kind || "meaning", line.example ? `${line.text} (e.g. ${line.example})` : line.text, [])))));
                } catch (error) {
                    ctx.reportError("Define", error);
                    ctx.toasts.show("Could not reach the dictionary.", "failure");
                }
            }
        });
    }
};

export default plugin;
