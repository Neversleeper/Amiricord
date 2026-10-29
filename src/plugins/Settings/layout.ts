/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The part of the Settings plugin that knows the shape of Discord's settings tree. Pure functions, no React and no Discord:
// they take the tree Discord built and give back the same tree with one more section, or the original untouched when anything
// is not as expected (Discord's settings must never break because of us). The shapes and the anchor keys were read from the
// running client (docs/analysis-09-settings-core.md section 8): the root builder has the key "$Root" and its list holds sections
// such as "profile_section", "user_section", "billing_section"; a sidebar item holds panels, a panel holds categories, a category
// holds nodes, and a node of type CUSTOM draws a React component.

/** One node of Discord's settings tree. Only the fields we read or write are named. */
export interface LayoutNode {
    key?: unknown;
    type?: unknown;
    useTitle?: () => string;
    buildLayout?: () => unknown;
    [field: string]: unknown;
}

/** The numbers Discord uses for the node kinds we build. */
export interface LayoutTypes {
    SECTION: number;
    SIDEBAR_ITEM: number;
    PANEL: number;
    CATEGORY: number;
    CUSTOM: number;
}

/** Values seen on Canary (build 650101). Used only if the lookup in Discord's modules finds nothing. */
export const FALLBACK_TYPES: LayoutTypes = { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19 };

/** The properties a Discord module must have to be the node kinds table. */
export const TYPE_NAMES = ["SECTION", "SIDEBAR_ITEM", "PANEL", "CATEGORY", "CUSTOM"] as const;

/** The table from Discord's modules, or undefined if it is not what we expect (every number must be there). */
export function readTypes(found: unknown): LayoutTypes | undefined {
    if (typeof found !== "object" || found === null) return undefined;
    const types: Record<string, number> = {};
    for (const name of TYPE_NAMES) {
        let value: unknown;
        try {
            value = (found as Record<string, unknown>)[name];
        } catch {
            return undefined;
        }
        if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
        types[name] = value;
    }
    return types as unknown as LayoutTypes;
}

export const SECTION_KEY = "amiricord_section";
export const SECTION_TITLE = "Amiricord Settings";
/** The key of Discord's root builder; any other builder is left alone. */
export const ROOT_KEY = "$Root";
/** Our section goes just above this one (the billing section), where TestCord's default also puts its own. */
export const ANCHOR_KEY = "billing_section";
/** If the anchor is not there, the third place. */
export const FALLBACK_INDEX = 2;

/** What a tab needs to become a sidebar item. */
export interface SettingsEntry {
    /** Unique among entries, for example "amiricord". The nodes get keys derived from it. */
    key: string;
    /** The sidebar text. */
    title: string;
    /** The title above the panel; the sidebar text when missing. */
    panelTitle?: string;
    /** The React component that draws the tab. */
    Component: unknown;
    /** Draws the sidebar icon. */
    icon?: () => unknown;
}

/**
 * One sidebar item with its panel, one category and one custom node that draws the tab.
 * An entry without an icon gets `fallbackIcon` when one is given: Discord draws the icon of a sidebar item as a component, so an item
 * with none would make it draw `undefined` (React error 130) when the settings open.
 */
export function makeEntryNode(types: LayoutTypes, entry: SettingsEntry, fallbackIcon?: () => unknown): LayoutNode {
    const icon = entry.icon ?? fallbackIcon;
    const panel: LayoutNode = {
        key: `${entry.key}_panel`,
        type: types.PANEL,
        useTitle: () => entry.panelTitle ?? entry.title,
        buildLayout: () => [{
            key: `${entry.key}_category`,
            type: types.CATEGORY,
            buildLayout: () => [{
                key: `${entry.key}_custom`,
                type: types.CUSTOM,
                Component: entry.Component,
                useSearchTerms: () => [entry.title]
            }]
        }]
    };
    return {
        key: entry.key,
        type: types.SIDEBAR_ITEM,
        useTitle: () => entry.title,
        ...(icon ? { icon } : {}),
        buildLayout: () => [panel]
    };
}

export function makeSectionNode(types: LayoutTypes, entries: readonly SettingsEntry[], fallbackIcon?: () => unknown): LayoutNode {
    const items = entries.map(entry => makeEntryNode(types, entry, fallbackIcon));
    return { key: SECTION_KEY, type: types.SECTION, useTitle: () => SECTION_TITLE, buildLayout: () => items };
}

const isNode = (value: unknown): value is LayoutNode => typeof value === "object" && value !== null;

/** A new list with `section` placed above the anchor, or at the fallback place. The list given is not changed. */
export function insertSection(layout: readonly unknown[], section: LayoutNode): unknown[] {
    const at = layout.findIndex(node => isNode(node) && node.key === ANCHOR_KEY);
    const index = at === -1 ? Math.min(FALLBACK_INDEX, layout.length) : at;
    return [...layout.slice(0, index), section, ...layout.slice(index)];
}

export interface SectionDeps {
    /** Where the node kinds come from; called every time. */
    types(): LayoutTypes;
    /** The tabs to show, in order; called every time so tabs added later appear. */
    entries(): readonly SettingsEntry[];
    /** The icon of a tab that brings none (a tab added by a plugin may have no icon). */
    fallbackIcon?: () => unknown;
    /** Told about anything that went wrong in our part (never thrown into Discord's code). */
    onError(error: unknown): void;
}

/**
 * What the patch calls instead of `builder.buildLayout()`. Always gives back what Discord would have: the original list, or the same
 * list with our section. If Discord's own builder throws, that error is Discord's and goes on as it would have.
 */
export function buildLayoutWithSection(builder: { key?: unknown; buildLayout(): unknown; }, deps: SectionDeps): unknown {
    const layout = builder.buildLayout();
    try {
        if (builder.key !== ROOT_KEY) return layout;
        if (!Array.isArray(layout)) return layout;
        if (layout.some(node => isNode(node) && node.key === SECTION_KEY)) return layout;
        const entries = deps.entries();
        if (entries.length === 0) return layout;
        return insertSection(layout, makeSectionNode(deps.types(), entries, deps.fallbackIcon));
    } catch (error) {
        try {
            deps.onError(error);
        } catch {
            // Reporting must never break the settings.
        }
        return layout;
    }
}
