/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Plugins tab decides, apart from drawing it: which cards pass the search and the filters, in what order, what the counts
// and the header say, the plain words for a card's state, and the words for each answer of the switch. Pure functions over the plain
// data of `ctx.plugins.cards()`: no React, no Discord, nothing live. Design: docs/analysis-18-plugins-tab.md.

import type { PluginCard } from "../../api/pluginCards";
import type { ToggleResult } from "../../api/pluginSwitch";
import { HIGH_RISK_LABEL, type Origin } from "../../shared/manifest";

export const STATE_FILTERS = [
    { value: "all", label: "All plugins" },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
    { value: "restart", label: "Needs a restart" },
    { value: "problems", label: "With problems" }
] as const;
export type StateFilter = typeof STATE_FILTERS[number]["value"];

export const RISK_FILTERS = [
    { value: "any", label: "Any risk" },
    { value: "medium", label: "Medium risk or higher" },
    { value: "high", label: `${HIGH_RISK_LABEL} only` }
] as const;
export type RiskFilter = typeof RISK_FILTERS[number]["value"];

export interface PluginsFilter {
    search: string;
    state: StateFilter;
    /** An origin such as "amiricord", or "" for every origin. */
    origin: string;
    risk: RiskFilter;
    /** A tag, or "" for every tag. */
    tag: string;
    /** The name of an author, or "" for every author. */
    author: string;
}

export const DEFAULT_FILTER: PluginsFilter = { search: "", state: "all", origin: "", risk: "any", tag: "", author: "" };

export const ORIGIN_LABELS: Record<Origin, string> = {
    amiricord: "Amiricord", vencord: "Vencord", equicord: "Equicord", testcord: "TestCord", betterdiscord: "BetterDiscord"
};

export const originLabel = (origin: string): string => (ORIGIN_LABELS as Record<string, string>)[origin] ?? origin;

/** What the plugin will do from now on: its switch shows this. */
export const isOn = (card: PluginCard): boolean => card.state.wanted;

/** An error while starting, or a reason it could not run although it was wanted. */
export const hasProblem = (card: PluginCard): boolean => card.state.error !== null || card.state.skipped !== undefined;

export function isFilterActive(filter: PluginsFilter): boolean {
    return filter.search.trim() !== "" || filter.state !== "all" || filter.origin !== "" || filter.risk !== "any" || filter.tag !== "" || filter.author !== "";
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/** The capital letters of a name, in lower case: "BetterFolders" is found by "bf". */
const acronym = (name: string) => (name.match(/[A-Z]/g) ?? []).join("").toLowerCase();

/** The cards the Plugins tab draws for this person: the ones of `hidden` plugins are left out unless the person is one of `owners` (Discord ids). The list given is not changed. */
export function cardsForPerson(cards: readonly PluginCard[], hidden: readonly string[], owners: readonly string[], personId: string | undefined): PluginCard[] {
    const isOwner = personId !== undefined && owners.includes(personId);
    return cards.filter(card => isOwner || !hidden.includes(card.id));
}

/** Whether the search words are in the name, the id, the acronym of the name, the description, the authors, the tags or the origin. */
export function matchesSearch(card: PluginCard, search: string): boolean {
    const query = search.trim().toLowerCase();
    if (query === "") return true;
    const squeezed = normalize(query);
    const haystack = [card.name, card.id, card.description, originLabel(card.origin), ...card.authors.map(a => a.name), ...card.tags].map(text => text.toLowerCase());
    return haystack.some(text => text.includes(query))
        || normalize(card.name).includes(squeezed)
        || acronym(card.name).includes(query);
}

const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

function passes(card: PluginCard, filter: PluginsFilter): boolean {
    switch (filter.state) {
        case "on": if (!isOn(card)) return false; break;
        case "off": if (isOn(card)) return false; break;
        case "restart": if (!card.state.restartNeeded) return false; break;
        case "problems": if (!hasProblem(card)) return false; break;
        case "all": break;
    }
    if (filter.origin !== "" && card.origin !== filter.origin) return false;
    if (filter.tag !== "" && !card.tags.some(tag => tag === filter.tag)) return false;
    if (filter.author !== "" && !card.authors.some(author => author.name === filter.author)) return false;
    if (filter.risk !== "any" && RISK_RANK[card.risk.level] < RISK_RANK[filter.risk]) return false;
    return matchesSearch(card, filter.search);
}

const byName = (a: PluginCard, b: PluginCard) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface PluginLists {
    /** Plugins that can be turned on and off. */
    plugins: PluginCard[];
    /** Core plugins: always on, their switch is locked. */
    core: PluginCard[];
}

/** The cards that pass the search and the filters, by name, with the core plugins apart. The list given is not changed. */
export function applyFilter(cards: readonly PluginCard[], filter: PluginsFilter): PluginLists {
    const shown = cards.filter(card => passes(card, filter)).sort(byName);
    return { plugins: shown.filter(card => !card.core), core: shown.filter(card => card.core) };
}

/** The order the origins are listed in when the list is grouped by origin: the plugins we made, then the projects they come from. An unknown origin goes last. */
export const ORIGIN_ORDER: readonly string[] = ["vencord", "equicord", "testcord", "amiricord", "betterdiscord"];

export interface SortOptions {
    /** The plugins that will be on come before the ones that will be off. */
    onFirst: boolean;
    /** The plugins are grouped by where they come from, in `ORIGIN_ORDER`. */
    byOrigin: boolean;
}

const originRank = (origin: string): number => {
    const at = ORIGIN_ORDER.indexOf(origin);
    return at === -1 ? ORIGIN_ORDER.length : at;
};

/**
 * Reorders a list that is already by name. With `byOrigin` the origin comes first and, inside each origin, with `onFirst` the plugins that are on come
 * before the ones that are off; whatever is equal keeps the order it came in (by name). Returns a new list.
 */
export function sortPlugins<T extends PluginCard>(cards: readonly T[], options: SortOptions): T[] {
    return [...cards].sort((a, b) => {
        if (options.byOrigin) {
            const byOrigin = originRank(a.origin) - originRank(b.origin);
            if (byOrigin !== 0) return byOrigin;
        }
        return options.onFirst ? Number(!isOn(a)) - Number(!isOn(b)) : 0;
    });
}

export interface PluginCounts {
    /** Plugins that can be turned off. */
    plugins: number;
    /** Of those, how many will be on. */
    pluginsOn: number;
    core: number;
    problems: number;
}

export function countCards(cards: readonly PluginCard[]): PluginCounts {
    const others = cards.filter(card => !card.core);
    return { plugins: others.length, pluginsOn: others.filter(isOn).length, core: cards.length - others.length, problems: cards.filter(hasProblem).length };
}

/** Names of the plugins whose state only changes after a restart, by name. */
export function waitingForRestart(cards: readonly PluginCard[]): string[] {
    return cards.filter(card => card.state.restartNeeded).sort(byName).map(card => card.name);
}

/** The values the filters can offer, from what the cards really contain, in a stable order. */
export function filterOptions(cards: readonly PluginCard[]): { origins: string[]; tags: string[]; authors: string[]; } {
    const origins = [...new Set(cards.map(card => card.origin as string))].sort((a, b) => originLabel(a).localeCompare(originLabel(b), "en"));
    const tags = [...new Set(cards.flatMap(card => card.tags as string[]))].sort();
    const authors = [...new Set(cards.flatMap(card => card.authors.map(author => author.name)))].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0));
    return { origins, tags, authors };
}

/** What to say where the list of plugins would be, when it is empty. */
export function emptyText(all: PluginCounts, shown: number, filter: PluginsFilter): string {
    if (shown > 0) return "";
    if (all.plugins === 0) return "No plugins are installed yet. The ones you add will show up here, each with its switch.";
    return isFilterActive(filter) ? "No plugin matches the search and the filters." : "No plugins to show.";
}

// --- Words for one card ---------------------------------------------------------------------------------------------------------------------

export function reasonText(card: PluginCard): string {
    switch (card.state.reason) {
        case "core": return "Core plugin: always on";
        case "chosen": return "On because you turned it on";
        case "default": return "On by default";
        case "dependency": return card.state.neededBy.length ? `Running because ${card.state.neededBy.join(", ")} ${card.state.neededBy.length === 1 ? "needs" : "need"} it` : "Running because another plugin needs it";
        case undefined: return "";
    }
}

/** One line for where the plugin stands right now. A problem is said first and plainly. */
export function statusText(card: PluginCard): string {
    const s = card.state;
    if (s.error !== null) return `Failed to start: ${s.error}`;
    if (s.skipped) return s.skipped.message;
    if (s.restartNeeded) return s.wanted ? "Will turn on after a restart" : "Will turn off after a restart";
    if (s.running) return reasonText(card);
    return s.wanted ? "On, but not started" : "Off";
}

export function compatibilityNote(card: PluginCard): string | undefined {
    if (card.compatibility === "discord-too-old") return "Needs a newer Discord than this one";
    if (card.compatibility === "discord-too-new") return "Written for an older Discord than this one";
    return undefined;
}

export interface Badge {
    text: string;
    tone: "neutral" | "info" | "warn" | "danger";
}

/** The small marks of a card, in order: origin, risk, experimental, legacy, restart, tags. */
export function cardBadges(card: PluginCard): Badge[] {
    const badges: Badge[] = [{ text: originLabel(card.origin), tone: "neutral" }];
    if (card.risk.level === "high") badges.push({ text: card.risk.label ?? HIGH_RISK_LABEL, tone: "danger" });
    else if (card.risk.level === "medium") badges.push({ text: "Medium risk", tone: "warn" });
    if (card.experimental) badges.push({ text: "Experimental", tone: "warn" });
    if (card.legacy) badges.push({ text: "Legacy", tone: "warn" });
    if (card.restartToToggle && !card.core) badges.push({ text: "Restart to change", tone: "info" });
    for (const tag of card.tags) badges.push({ text: tag, tone: "neutral" });
    return badges;
}

/** Turning on an experimental or a legacy plugin asks first. Experimental is the stronger warning. */
export function warningBeforeEnabling(card: PluginCard): "experimental" | "legacy" | undefined {
    if (card.experimental) return "experimental";
    if (card.legacy) return "legacy";
    return undefined;
}

export function warningText(card: PluginCard, kind: "experimental" | "legacy"): string {
    if (kind === "experimental") return `${card.name} is experimental. It can misbehave or break things in Discord. Turn it on anyway?`;
    const instead = card.replacedBy ? ` ${card.replacedBy} replaces it.` : "";
    return `${card.name} is a legacy plugin and may not work with today's Discord.${instead} Turn it on anyway?`;
}

export interface Outcome {
    text: string;
    tone: "ok" | "info" | "bad";
}

/** The words for what the switch answered. `enabled` is what was asked. */
export function outcomeOf(result: ToggleResult, card: PluginCard, enabled: boolean): Outcome {
    switch (result.status) {
        case "applied": return { text: `${card.name} is now ${enabled ? "on" : "off"}.`, tone: "ok" };
        case "restart-needed": return { text: "Saved. It changes after Discord restarts.", tone: "info" };
        case "unchanged": return { text: `Nothing changed: it was already ${enabled ? "on" : "off"}.`, tone: "info" };
        case "refused": return { text: `Not changed: ${result.reason}.`, tone: "bad" };
        case "failed": return { text: enabled ? `Saved, but it did not start: ${result.error}` : `Turned off, but it stopped with errors: ${result.error}`, tone: "bad" };
    }
}

/**
 * The line a card shows under its description, or null when the switch already says it (plainly on or off, a core plugin, on by default or because
 * you turned it on). A problem, a restart that is waiting, a plugin kept running by another one, and a plugin that is wanted but not started are said.
 */
export function cardStatus(card: PluginCard): string | null {
    const s = card.state;
    if (s.error !== null || s.skipped || s.restartNeeded) return statusText(card);
    if (s.running) return s.reason === "dependency" ? reasonText(card) : null;
    return s.wanted ? statusText(card) : null;
}

/** How many tags the footer of a card shows before it says "+N". */
export const FOOTER_TAGS = 2;

export interface CardFooter {
    /** Where the plugin comes from, for the left of the footer. */
    source: string;
    /** The marks that matter before turning it on: risk, experimental, legacy, restart to change. Never the origin or the tags. */
    marks: Badge[];
    /** The first tags. */
    tags: string[];
    /** The tags that did not fit, for the "+N" and its hover text. */
    moreTags: string[];
}

export function cardFooter(card: PluginCard): CardFooter {
    return {
        source: originLabel(card.origin),
        marks: cardBadges(card).slice(1).filter(badge => badge.tone !== "neutral"),
        tags: card.tags.slice(0, FOOTER_TAGS),
        moreTags: card.tags.slice(FOOTER_TAGS)
    };
}
