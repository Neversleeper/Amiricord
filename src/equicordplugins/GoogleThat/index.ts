/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GoogleThat (authors Samwich, KrystalSkull) as found in Equicord's copy of Vencord's plugins. Same sites and same four ways to write the link (with or without a preview, with or without the query as the label). The option to type your own site is kept.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

export const SEARCH_ENGINES: Record<string, string> = {
    Google: "https://www.google.com/search?q=",
    Bing: "https://www.bing.com/search?q=",
    Yahoo: "https://search.yahoo.com/search?p=",
    DuckDuckGo: "https://duckduckgo.com/?q=",
    Baidu: "https://www.baidu.com/s?wd=",
    Yandex: "https://yandex.com/search/?text=",
    Ecosia: "https://www.ecosia.org/search?q=",
    Ask: "https://www.ask.com/web?q=",
    AOL: "https://search.aol.com/aol/search?q=",
    LetMeGoogleThatForYou: "https://letmegooglethat.com/?q="
};

const settings = definePluginSettings({
    hyperlink: { type: "boolean", default: false, description: "The link is written with the query as its label" },
    embed: { type: "boolean", default: true, description: "The link shows a preview" },
    defaultEngine: { type: "select", default: "Google", description: "The search site to use", options: Object.keys(SEARCH_ENGINES).map(name => ({ label: name, value: name })) },
    customEngineURL: { type: "string", default: "", description: "The address of a search site of your own (the query is added at the end). Leave empty to use the one above" }
});

/** The text to send for a query: a link, as a hyperlink or plain, with or without a preview. */
export function searchMessage(query: string, store: { hyperlink: boolean; embed: boolean; defaultEngine: string | number; customEngineURL: string; }): string {
    const base = store.customEngineURL || SEARCH_ENGINES[String(store.defaultEngine)] || SEARCH_ENGINES.Google;
    const url = base + encodeURIComponent(query);
    if (store.hyperlink) return store.embed ? `[${query}](${url})` : `[${query}](<${url}>)`;
    return store.embed ? url : `<${url}>`;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        ctx.commands.add({
            name: "googlethat",
            description: "Send a link to a search",
            options: [{ name: "input", description: "The search query", type: "string", required: true }],
            execute(args) {
                const query = args.find(arg => arg.name === "input")?.value;
                if (typeof query !== "string" || query.trim() === "") return undefined;
                return { content: searchMessage(query, settings.store) };
            }
        });
    }
};

export default plugin;
