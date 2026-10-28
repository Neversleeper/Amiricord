/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The words and the arithmetic of the "Recent blocks" list of the Privacy & Security tab (design 05 piece P7c, docs/analysis-24-recent-blocks.md): the title, the tags and the
// badge of each kind, how long ago in plain words, the lines for what NoTrack stopped inside Discord (kept apart from the network ones, never added to them), the search and the pages.
// Pure code, so it is tested without a page.

import type { StoppedKind } from "../../renderer/engine";
import type { BlockGroup } from "../../shared/blocks";
import type { NetworkKind } from "../../shared/shields";

export const BLOCKS_PER_PAGE = 8;

export interface BlockItem {
    key: string;
    title: string;
    count: number;
    /** The host and path shape, or empty for what was stopped inside Discord. */
    where: string;
    /** The kind in a word or two, for the small tag. */
    tag: string;
    source: "NETWORK" | "INSIDE DISCORD";
    /** `BLOCKED` for a cancelled request or a stopped event, `STRIPPED` for a request that went on without the token. */
    badge: "BLOCKED" | "STRIPPED";
    agoMs: number;
}

const NETWORK_WORDS: Record<NetworkKind, { title: string; tag: string; }> = {
    "usage-reports": { title: "Usage report blocked", tag: "USAGE" },
    metrics: { title: "Metrics report blocked", tag: "METRICS" },
    "crash-reports": { title: "Crash report blocked", tag: "CRASH" },
    "telemetry-host": { title: "Telemetry ping blocked", tag: "PING" },
    "host-rules": { title: "Blocked by your rules", tag: "YOUR RULE" },
    "token-stripped": { title: "Token removed from a request", tag: "TOKEN" }
};

const INSIDE_WORDS: Record<StoppedKind, { title: string; tag: string; }> = {
    analytics: { title: "Usage events stopped inside Discord", tag: "USAGE" },
    metrics: { title: "Metrics stopped inside Discord", tag: "METRICS" },
    "crash-reports": { title: "Crash report hooks stopped inside Discord", tag: "CRASH" }
};

/** "just now", "7s ago", "3m ago", "2h ago", "5d ago". A negative or odd number counts as just now. */
export function ageText(ms: number): string {
    if (!Number.isFinite(ms) || ms < 1000) return "just now";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/** The lines of the list: the network groups and, apart, one line per kind that NoTrack stopped inside Discord. Newest first. */
export function blockItems(groups: readonly BlockGroup[], stopped: Readonly<Record<StoppedKind, number>>, stoppedAt: Readonly<Record<StoppedKind, number | null>>, now: number): BlockItem[] {
    const items: BlockItem[] = groups.map((group, index) => ({
        key: `n${index}-${group.kind}-${group.method}-${group.host}-${group.path}`,
        title: NETWORK_WORDS[group.kind].title,
        count: group.count,
        where: `${group.method} ${group.host}${group.path === "/" ? "" : group.path}`,
        tag: NETWORK_WORDS[group.kind].tag,
        source: "NETWORK",
        badge: group.kind === "token-stripped" ? "STRIPPED" : "BLOCKED",
        agoMs: group.agoMs
    }));
    for (const kind of Object.keys(INSIDE_WORDS) as StoppedKind[]) {
        if (stopped[kind] < 1) continue;
        const at = stoppedAt[kind];
        items.push({
            key: `i-${kind}`, title: INSIDE_WORDS[kind].title, count: stopped[kind], where: "", tag: INSIDE_WORDS[kind].tag,
            source: "INSIDE DISCORD", badge: "BLOCKED", agoMs: at === null ? 0 : Math.max(0, now - at)
        });
    }
    // Stable: lines with the same age keep the order above, so the network lines stay before the inside ones.
    return items.map((item, index) => ({ item, index })).sort((a, b) => a.item.agoMs - b.item.agoMs || a.index - b.index).map(entry => entry.item);
}

/** The lines that contain every word of the search, in the title, the place, the tag or the source. An empty search keeps all. */
export function filterBlocks(items: readonly BlockItem[], query: string): BlockItem[] {
    const words = query.toLowerCase().split(/\s+/).filter(word => word !== "");
    if (words.length === 0) return [...items];
    return items.filter(item => {
        const text = `${item.title} ${item.where} ${item.tag} ${item.source} ${item.badge}`.toLowerCase();
        return words.every(word => text.includes(word));
    });
}

export interface BlockPage {
    items: BlockItem[];
    /** Zero-based, kept inside the range. */
    index: number;
    pages: number;
}

/** One page of the lines. A page number outside the range is moved into it. */
export function pageOfBlocks(items: readonly BlockItem[], requested: number, size = BLOCKS_PER_PAGE): BlockPage {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const index = Math.min(Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0), pages - 1);
    return { items: items.slice(index * size, index * size + size), index, pages };
}
