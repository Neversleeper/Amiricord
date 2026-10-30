/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WikiLookup (author Sharp) as found in TestCord. Same idea as the original, but the answer opens in a window instead of being a message only you see (the engine cannot yet show a private message), so nothing is sent to the chat. The search goes to Wikipedia's public summary service (en.wikipedia.org), which learns your address and the subject.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface WikiSummary { title: string; extract: string; url: string; }

/** The part of Wikipedia's answer that is shown, or nothing for a missing or ambiguous article. */
export function wikiSummary(data: unknown, query: string): WikiSummary | undefined {
    if (typeof data !== "object" || data === null) return undefined;
    const answer = data as { type?: string; title?: string; extract?: string; content_urls?: { desktop?: { page?: string; }; }; };
    if (answer.type === "disambiguation" || !answer.extract) return undefined;
    return { title: answer.title ?? query, extract: answer.extract, url: answer.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}` };
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "wiki",
            description: "Look up a Wikipedia summary (shown only to you)",
            options: [{ name: "subject", description: "What to look up", required: true }],
            async execute(args) {
                const query = String(args.find(arg => arg.name === "subject")?.value ?? "").trim();
                if (!query) return;
                try {
                    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
                    const summary = response.ok ? wikiSummary(await response.json(), query) : undefined;
                    if (!summary) { ctx.toasts.show(`No clear Wikipedia article for "${query}".`, "failure"); return; }
                    openPanelWindow(ctx, summary.title, kit => kit.panel(kit.card([kit.note(summary.extract), kit.note(summary.url)])));
                } catch (error) {
                    ctx.reportError("WikiLookup", error);
                    ctx.toasts.show("Could not reach Wikipedia.", "failure");
                }
            }
        });
    }
};

export default plugin;
