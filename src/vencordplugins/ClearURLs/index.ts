/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ClearURLs (authors adryd, thororen) as found in TestCord's copy of Vencord's plugins. Same rules and same list. The list is asked for once when the plugin starts, from raw.githubusercontent.com (declared in the plugin's permissions; the engine does nothing else with the network for it). Only sent messages are cleaned: the engine has no hook for edits yet. Until the list arrives, messages go out as they are.

import type { PluginCode } from "../../renderer/engine";

const RULES_URL = "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";
const HAS_URL = /https?:\/\//;
const URL_MATCH = /(https?:\/\/[^\s<]+[^<.,:;"'>)|\]\s])/g;

interface Provider { urlPattern: string; rules?: string[]; rawRules?: string[]; exceptions?: string[]; }
export interface RuleSet { urlPattern: RegExp; rules?: RegExp[]; rawRules?: RegExp[]; exceptions?: RegExp[]; }

const compile = (patterns: string[] | undefined) => patterns?.map(pattern => new RegExp(pattern, "i"));

/** The rules of the list as regular expressions. A provider with a bad pattern is left out. */
export function buildRules(providers: Record<string, Provider>): RuleSet[] {
    const out: RuleSet[] = [];
    for (const provider of Object.values(providers)) {
        try {
            out.push({ urlPattern: new RegExp(provider.urlPattern, "i"), rules: compile(provider.rules), rawRules: compile(provider.rawRules), exceptions: compile(provider.exceptions) });
        } catch { /* skip this provider */ }
    }
    return out;
}

/** One link without its tracking parts; a link that cannot be read stays as it is. */
export function cleanUrl(match: string, rules: RuleSet[]): string {
    let url: URL;
    try {
        url = new URL(match);
    } catch {
        return match;
    }
    if (url.searchParams.entries().next().done) return match;
    for (const { urlPattern, exceptions, rawRules, rules: paramRules } of rules) {
        if (!urlPattern.test(url.href) || exceptions?.some(exception => exception.test(url.href))) continue;
        if (paramRules) {
            const toDelete: string[] = [];
            url.searchParams.forEach((_value, param) => { if (paramRules.some(rule => rule.test(param))) toDelete.push(param); });
            for (const param of toDelete) url.searchParams.delete(param);
        }
        let cleaned = url.href;
        for (const rawRule of rawRules ?? []) cleaned = cleaned.replace(rawRule, "");
        url = new URL(cleaned);
    }
    return url.toString();
}

/** A message with every link cleaned. */
export function cleanMessage(content: string, rules: RuleSet[]): string {
    return HAS_URL.test(content) ? content.replace(URL_MATCH, match => cleanUrl(match, rules)) : content;
}

let rules: RuleSet[] = [];

const plugin: PluginCode = {
    async start(ctx) {
        ctx.messageEvents.onBeforeSend(content => cleanMessage(content, rules));
        try {
            const response = await fetch(RULES_URL);
            const data = await response.json() as { providers: Record<string, Provider>; };
            rules = buildRules(data.providers);
        } catch (error) {
            ctx.reportError("ClearURLs", error);
        }
    },
    stop() {
        rules = [];
    }
};

export default plugin;
