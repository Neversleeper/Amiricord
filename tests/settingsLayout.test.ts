/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EntryRegistry, SIDEBAR_ORDER } from "../src/plugins/Settings/entries";
import {
    ANCHOR_KEY, buildLayoutWithSection, FALLBACK_INDEX, FALLBACK_TYPES, insertSection, LayoutNode, LayoutTypes, makeEntryNode, makeSectionNode,
    readTypes, ROOT_KEY, SECTION_KEY, SECTION_TITLE, SectionDeps, SettingsEntry
} from "../src/plugins/Settings/layout";

const entry = (key: string, extra: Partial<SettingsEntry> = {}): SettingsEntry => ({ key, title: `Title ${key}`, Component: () => null, ...extra });
const sections = (...keys: string[]): LayoutNode[] => keys.map(key => ({ key, type: 1 }));
const keysOf = (layout: unknown) => (layout as LayoutNode[]).map(node => node.key);

describe("readTypes", () => {
    it("reads the five numbers from Discord's table, ignoring the rest of it", () => {
        const table = { ROOT: 0, SECTION: 11, SIDEBAR_ITEM: 12, PANEL: 13, CATEGORY: 15, CUSTOM: 29, TOGGLE: 14, 0: "ROOT" };
        assert.deepEqual(readTypes(table), { SECTION: 11, SIDEBAR_ITEM: 12, PANEL: 13, CATEGORY: 15, CUSTOM: 29 });
    });

    it("gives nothing when any number is missing or is not a whole number, or the value is not an object", () => {
        for (const bad of [undefined, null, 5, "x", {}, { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5 }, { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: "19" }, { SECTION: 1.5, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19 }]) {
            assert.equal(readTypes(bad), undefined, JSON.stringify(bad));
        }
    });

    it("survives a table that throws when read", () => {
        const hostile = new Proxy({}, { get() { throw new Error("no"); } });
        assert.equal(readTypes(hostile), undefined);
    });

    it("has fallback numbers that are the ones seen on Canary", () => {
        assert.deepEqual(FALLBACK_TYPES, { SECTION: 1, SIDEBAR_ITEM: 2, PANEL: 3, CATEGORY: 5, CUSTOM: 19 });
    });
});

describe("the nodes", () => {
    const types: LayoutTypes = { SECTION: 11, SIDEBAR_ITEM: 12, PANEL: 13, CATEGORY: 15, CUSTOM: 29 };

    it("makes a sidebar item that holds a panel, a category and a custom node that draws the component", () => {
        const Component = () => null;
        const icon = () => "icon";
        const node = makeEntryNode(types, entry("tab", { title: "Tab", panelTitle: "Tab panel", Component, icon }));
        assert.deepEqual([node.key, node.type, node.useTitle?.(), node.icon], ["tab", 12, "Tab", icon]);
        const [panel] = node.buildLayout!() as LayoutNode[];
        assert.deepEqual([panel.key, panel.type, panel.useTitle?.()], ["tab_panel", 13, "Tab panel"]);
        const [category] = panel.buildLayout!() as LayoutNode[];
        assert.deepEqual([category.key, category.type], ["tab_category", 15]);
        const [custom] = category.buildLayout!() as LayoutNode[];
        assert.deepEqual([custom.key, custom.type, custom.Component], ["tab_custom", 29, Component]);
        assert.deepEqual((custom.useSearchTerms as () => string[])(), ["Tab"]);
    });

    it("uses the sidebar text for the panel title when none is given, and leaves the icon out when there is none", () => {
        const node = makeEntryNode(types, entry("plain"));
        assert.ok(!("icon" in node));
        const [panel] = node.buildLayout!() as LayoutNode[];
        assert.equal(panel.useTitle?.(), "Title plain");
    });

    it("makes the section with the marker key, the title and one item per entry in the order given", () => {
        const section = makeSectionNode(types, [entry("a"), entry("b")]);
        assert.deepEqual([section.key, section.type, section.useTitle?.()], [SECTION_KEY, 11, SECTION_TITLE]);
        assert.deepEqual(keysOf(section.buildLayout!()), ["a", "b"]);
    });
});

describe("insertSection", () => {
    const section: LayoutNode = { key: SECTION_KEY, type: 1 };

    it("puts the section just above the billing section, without changing the list it was given", () => {
        const original = sections("profile_section", "user_section", ANCHOR_KEY, "app_section");
        const result = insertSection(original, section);
        assert.deepEqual(keysOf(result), ["profile_section", "user_section", SECTION_KEY, ANCHOR_KEY, "app_section"]);
        assert.deepEqual(keysOf(original), ["profile_section", "user_section", ANCHOR_KEY, "app_section"]);
        assert.notEqual(result, original);
    });

    it("goes to the third place when the anchor is missing, or to the end of a shorter list", () => {
        assert.deepEqual(keysOf(insertSection(sections("a", "b", "c", "d"), section)), ["a", "b", SECTION_KEY, "c", "d"]);
        assert.equal(FALLBACK_INDEX, 2);
        assert.deepEqual(keysOf(insertSection(sections("a"), section)), ["a", SECTION_KEY]);
        assert.deepEqual(keysOf(insertSection([], section)), [SECTION_KEY]);
    });

    it("steps over entries of the list that are not objects", () => {
        const result = insertSection([null, "text", 5, { key: ANCHOR_KEY }], section);
        assert.equal((result[3] as LayoutNode).key, SECTION_KEY);
    });
});

describe("buildLayoutWithSection: what the patch calls", () => {
    function setup(options: { entries?: SettingsEntry[]; typesThrow?: boolean; onErrorThrows?: boolean; } = {}) {
        const errors: unknown[] = [];
        let builds = 0;
        const deps: SectionDeps = {
            types: () => { if (options.typesThrow) throw new Error("no types"); return FALLBACK_TYPES; },
            entries: () => options.entries ?? [entry("amiricord")],
            onError: error => { errors.push(error); if (options.onErrorThrows) throw new Error("report failed"); }
        };
        const builder = (key: unknown, layout: unknown) => ({ key, buildLayout: () => { builds++; return layout; } });
        return { deps, errors, builder, builds: () => builds };
    }

    it("adds the section to the root list", () => {
        const t = setup();
        const result = buildLayoutWithSection(t.builder(ROOT_KEY, sections("user_section", ANCHOR_KEY)), t.deps);
        assert.deepEqual(keysOf(result), ["user_section", SECTION_KEY, ANCHOR_KEY]);
        assert.deepEqual(t.errors, []);
    });

    it("leaves every other builder's list exactly as Discord made it (the same object)", () => {
        const t = setup();
        const list = sections("a", "b");
        assert.equal(buildLayoutWithSection(t.builder("something_else", list), t.deps), list);
        assert.equal(buildLayoutWithSection(t.builder(undefined, list), t.deps), list);
    });

    it("leaves a root that is not a list as it is", () => {
        const t = setup();
        const odd = { not: "a list" };
        assert.equal(buildLayoutWithSection(t.builder(ROOT_KEY, odd), t.deps), odd);
        assert.equal(buildLayoutWithSection(t.builder(ROOT_KEY, undefined), t.deps), undefined);
    });

    it("does not add the section twice, even if Discord calls again with a list that already has it", () => {
        const t = setup();
        const once = buildLayoutWithSection(t.builder(ROOT_KEY, sections("user_section", ANCHOR_KEY)), t.deps);
        const again = buildLayoutWithSection(t.builder(ROOT_KEY, once), t.deps);
        assert.equal(again, once);
        assert.equal((again as LayoutNode[]).filter(node => node.key === SECTION_KEY).length, 1);
    });

    it("adds nothing when there are no tabs yet", () => {
        const t = setup({ entries: [] });
        const list = sections("a", "b", "c");
        assert.equal(buildLayoutWithSection(t.builder(ROOT_KEY, list), t.deps), list);
    });

    it("gives Discord its own list and reports the problem when anything of ours throws, and survives a report that throws too", () => {
        for (const onErrorThrows of [false, true]) {
            const t = setup({ typesThrow: true, onErrorThrows });
            const list = sections("a", "b", "c");
            assert.equal(buildLayoutWithSection(t.builder(ROOT_KEY, list), t.deps), list);
            assert.equal(t.errors.length, 1);
        }
    });

    it("calls Discord's own builder exactly once, and lets its errors go on as they would have", () => {
        const t = setup();
        buildLayoutWithSection(t.builder(ROOT_KEY, sections("a")), t.deps);
        assert.equal(t.builds(), 1);
        const failing = { key: ROOT_KEY, buildLayout: () => { throw new Error("Discord's own error"); } };
        assert.throws(() => buildLayoutWithSection(failing, t.deps), /Discord's own error/);
        assert.deepEqual(t.errors, []);
    });
});

describe("EntryRegistry", () => {
    it("lists the tabs in the sidebar order of TestCord, whatever order they were added in", () => {
        const registry = new EntryRegistry();
        for (const key of ["backup", "amiricord", "plugins", "health", "privacy"]) registry.register(entry(key));
        assert.deepEqual(registry.list().map(e => e.key), ["amiricord", "privacy", "plugins", "health", "backup"]);
    });

    it("has the whole order the owner chose, with the main tab first", () => {
        assert.deepEqual([...SIDEBAR_ORDER], ["amiricord", "privacy", "plugins", "themes", "updater", "changelog", "stats", "health", "presets", "cloud", "backup", "patchHelper"]);
    });

    it("puts tabs it does not know after the known ones, in the order they were added", () => {
        const registry = new EntryRegistry();
        for (const key of ["zzz", "plugins", "aaa", "amiricord"]) registry.register(entry(key));
        assert.deepEqual(registry.list().map(e => e.key), ["amiricord", "plugins", "zzz", "aaa"]);
    });

    it("refuses a second tab with the same key, and the function it gives back takes only its own tab out", () => {
        const registry = new EntryRegistry();
        const first = entry("amiricord");
        const remove = registry.register(first);
        assert.throws(() => registry.register(entry("amiricord")), /already/);
        remove();
        assert.deepEqual(registry.list(), []);
        const second = entry("amiricord");
        registry.register(second);
        remove();
        assert.deepEqual(registry.list(), [second], "an old remover cannot take out a newer tab");
    });

    it("can be emptied", () => {
        const registry = new EntryRegistry();
        registry.register(entry("a"));
        registry.clear();
        assert.deepEqual(registry.list(), []);
    });
});
