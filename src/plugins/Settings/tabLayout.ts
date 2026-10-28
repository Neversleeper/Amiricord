/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the owner chose in Editor Mode: which tabs of the Amiricord section are hidden, in which order they go and which ones are
// pinned to the top. Pure functions, no React and no Discord. The layout is saved as one JSON text; anything wrong in it gives the
// default layout or is dropped, and nothing here throws (docs/design-04-editor-mode.md). The idea and the controls come from the
// Editor Mode of TestCord; this is written from scratch with a smaller storage (one list of hidden tabs instead of four lists).

/** The first tab. It cannot be hidden, pinned or moved. */
export const MAIN_KEY = "amiricord";

export interface TabLayout {
    /** Keys of the tabs the owner turned off. A tab that is not here is shown, so a tab added later shows by itself. */
    hidden: string[];
    /** The order the owner dragged the tabs into. Tabs missing from it follow in their original order. */
    order: string[];
    /** Keys of the tabs placed right after the main one. */
    pinned: string[];
}

export const LAYOUT_MAX_CHARS = 4000;
const MAX_KEYS = 64;
const MAX_KEY_LENGTH = 64;

export const defaultLayout = (): TabLayout => ({ hidden: [], order: [], pinned: [] });

/** A list of distinct short strings, without the main tab and without more than the limit; anything else in it is ignored. */
function keyList(value: unknown, allowMain: boolean): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string" || item.length === 0 || item.length > MAX_KEY_LENGTH) continue;
        if (!allowMain && item === MAIN_KEY) continue;
        seen.add(item);
        if (seen.size >= MAX_KEYS) break;
    }
    return [...seen];
}

/** The layout in a saved text. Never throws: text that is not a layout gives the default one. */
export function parseLayout(text: unknown): TabLayout {
    if (typeof text !== "string" || text.length === 0 || text.length > LAYOUT_MAX_CHARS) return defaultLayout();
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return defaultLayout();
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) return defaultLayout();
    const record = data as Record<string, unknown>;
    return { hidden: keyList(record.hidden, false), order: keyList(record.order, false), pinned: keyList(record.pinned, false) };
}

/** The text to save. It always fits the limit: the longest lists are cut until it does (this cannot happen with real tabs). */
export function serializeLayout(layout: TabLayout): string {
    const clean: TabLayout = { hidden: keyList(layout.hidden, false), order: keyList(layout.order, false), pinned: keyList(layout.pinned, false) };
    let text = JSON.stringify(clean);
    while (text.length > LAYOUT_MAX_CHARS) {
        const longest = (["order", "hidden", "pinned"] as const).reduce((a, b) => (clean[b].length > clean[a].length ? b : a));
        clean[longest].pop();
        text = JSON.stringify(clean);
    }
    return text;
}

/**
 * The tabs in the order they are shown in the sidebar and in the editor: the main one first, then the pinned ones, then the others.
 * Inside each group the dragged order counts; tabs the order does not know keep the position they came in. `entries` come in the
 * original order and the list given is not changed.
 */
export function orderTabs<T extends { key: string; }>(entries: readonly T[], layout: TabLayout): T[] {
    const rank = new Map(layout.order.map((key, index) => [key, index]));
    const pinned = new Set(layout.pinned);
    const position = new Map(entries.map((entry, index) => [entry.key, index]));
    const group = (key: string) => (key === MAIN_KEY ? 0 : pinned.has(key) ? 1 : 2);
    const sortKey = (key: string) => rank.get(key) ?? layout.order.length + (position.get(key) ?? 0);
    return [...entries].sort((a, b) => group(a.key) - group(b.key) || sortKey(a.key) - sortKey(b.key));
}

/** The tabs the sidebar shows: ordered, without the hidden ones. The main tab is always there. */
export function visibleTabs<T extends { key: string; }>(entries: readonly T[], layout: TabLayout): T[] {
    const hidden = new Set(layout.hidden);
    return orderTabs(entries, layout).filter(entry => entry.key === MAIN_KEY || !hidden.has(entry.key));
}

export const isHidden = (layout: TabLayout, key: string) => key !== MAIN_KEY && layout.hidden.includes(key);
export const isPinned = (layout: TabLayout, key: string) => key !== MAIN_KEY && layout.pinned.includes(key);

/** Turn one tab off or on. The main tab does not change. */
export function toggleHidden(layout: TabLayout, key: string): TabLayout {
    if (key === MAIN_KEY) return layout;
    return { ...layout, hidden: layout.hidden.includes(key) ? layout.hidden.filter(k => k !== key) : [...layout.hidden, key] };
}

/** Pin or unpin one tab. The main tab does not change. */
export function togglePinned(layout: TabLayout, key: string): TabLayout {
    if (key === MAIN_KEY) return layout;
    return { ...layout, pinned: layout.pinned.includes(key) ? layout.pinned.filter(k => k !== key) : [...layout.pinned, key] };
}

/** Turn every tab except the main one off (`hide` true) or on. */
export function setAllHidden(layout: TabLayout, keys: readonly string[], hide: boolean): TabLayout {
    return { ...layout, hidden: hide ? keys.filter(key => key !== MAIN_KEY) : [] };
}

/** Whether every editable tab is shown. */
export function allShown(layout: TabLayout, keys: readonly string[]): boolean {
    return keys.every(key => key === MAIN_KEY || !layout.hidden.includes(key));
}

/**
 * Drag `dragged` onto `target`: it takes the place of the target, which moves one place down. Nothing changes when either is the main tab
 * or unknown, or when they are the same tab. `keys` are all the tabs in their original order.
 */
export function moveTab(layout: TabLayout, keys: readonly string[], dragged: string, target: string): TabLayout {
    if (dragged === target || dragged === MAIN_KEY || target === MAIN_KEY) return layout;
    if (!keys.includes(dragged) || !keys.includes(target)) return layout;
    const current = orderTabs(keys.map(key => ({ key })), layout).map(entry => entry.key).filter(key => key !== MAIN_KEY && key !== dragged);
    current.splice(current.indexOf(target), 0, dragged);
    return { ...layout, order: current };
}

/** The layout of a fresh install: everything shown, in the original order, nothing pinned. */
export function restoreLayout(): TabLayout {
    return defaultLayout();
}
