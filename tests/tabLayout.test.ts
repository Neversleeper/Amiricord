/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    allShown, defaultLayout, isHidden, isPinned, LAYOUT_MAX_CHARS, MAIN_KEY, moveTab, orderTabs, parseLayout, restoreLayout,
    serializeLayout, setAllHidden, toggleHidden, togglePinned, visibleTabs
} from "../src/plugins/Settings/tabLayout";

const keys = [MAIN_KEY, "privacy", "plugins", "themes", "updater"];
const entries = keys.map(key => ({ key }));
const names = (list: Array<{ key: string; }>) => list.map(entry => entry.key);
const layout = (part: Partial<ReturnType<typeof defaultLayout>> = {}) => ({ ...defaultLayout(), ...part });

describe("reading the saved layout", () => {
    it("gives the default layout for anything that is not a layout, and never throws", () => {
        for (const bad of [undefined, null, 5, "", "not json", "[]", "null", "\"text\"", "{", "x".repeat(LAYOUT_MAX_CHARS + 1)]) {
            assert.deepEqual(parseLayout(bad), defaultLayout(), String(bad).slice(0, 20));
        }
    });

    it("keeps only short, distinct text keys and never the main tab in the lists", () => {
        const text = JSON.stringify({ hidden: ["a", "a", 7, "", null, MAIN_KEY, "b", "x".repeat(65)], order: "nope", pinned: [MAIN_KEY, "c"] });
        assert.deepEqual(parseLayout(text), { hidden: ["a", "b"], order: [], pinned: ["c"] });
    });

    it("keeps at most 64 keys per list", () => {
        const many = Array.from({ length: 200 }, (_, index) => `k${index}`);
        assert.equal(parseLayout(JSON.stringify({ hidden: many })).hidden.length, 64);
    });

    it("saves and reads back the same layout, and the text always fits the limit", () => {
        const value = layout({ hidden: ["themes"], order: ["updater", "privacy"], pinned: ["plugins"] });
        assert.deepEqual(parseLayout(serializeLayout(value)), value);
        const huge = layout({ hidden: Array.from({ length: 64 }, (_, i) => `h${i}`.padEnd(64, "x")), order: Array.from({ length: 64 }, (_, i) => `o${i}`.padEnd(64, "x")) });
        assert.ok(serializeLayout(huge).length <= LAYOUT_MAX_CHARS);
    });

    it("does not change what it was given", () => {
        const value = layout({ hidden: [MAIN_KEY, "a", "a"] });
        serializeLayout(value);
        assert.deepEqual(value.hidden, [MAIN_KEY, "a", "a"]);
    });
});

describe("the order of the tabs", () => {
    it("is the original one when nothing was chosen", () => {
        assert.deepEqual(names(orderTabs(entries, defaultLayout())), keys);
    });

    it("puts the main tab first and the pinned ones right after it, whatever else is saved", () => {
        const value = layout({ order: ["updater", MAIN_KEY, "themes"], pinned: ["themes", "updater"] });
        assert.deepEqual(names(orderTabs(entries, value)), [MAIN_KEY, "updater", "themes", "privacy", "plugins"]);
    });

    it("keeps tabs the saved order does not know at the end, in their original order", () => {
        assert.deepEqual(names(orderTabs(entries, layout({ order: ["themes"] }))), [MAIN_KEY, "themes", "privacy", "plugins", "updater"]);
    });

    it("ignores saved keys of tabs that do not exist", () => {
        assert.deepEqual(names(orderTabs(entries, layout({ order: ["gone", "plugins"], pinned: ["gone2"] }))), [MAIN_KEY, "plugins", "privacy", "themes", "updater"]);
    });

    it("does not change the list given", () => {
        const copy = [...entries];
        orderTabs(entries, layout({ order: ["updater"] }));
        assert.deepEqual(entries, copy);
    });
});

describe("what the sidebar shows", () => {
    it("leaves out the hidden tabs and shows a tab added later", () => {
        const value = layout({ hidden: ["privacy", "themes"] });
        assert.deepEqual(names(visibleTabs(entries, value)), [MAIN_KEY, "plugins", "updater"]);
        assert.deepEqual(names(visibleTabs([...entries, { key: "stats" }], value)), [MAIN_KEY, "plugins", "updater", "stats"]);
    });

    it("always shows the main tab, even if a damaged layout hides it", () => {
        const value = { ...defaultLayout(), hidden: [MAIN_KEY] };
        assert.ok(names(visibleTabs(entries, value)).includes(MAIN_KEY));
        assert.equal(isHidden(value, MAIN_KEY), false);
    });
});

describe("the editor's actions", () => {
    it("hides and shows one tab, and cannot hide or pin the main one", () => {
        const hidden = toggleHidden(defaultLayout(), "themes");
        assert.deepEqual(hidden.hidden, ["themes"]);
        assert.equal(isHidden(hidden, "themes"), true);
        assert.deepEqual(toggleHidden(hidden, "themes").hidden, []);
        assert.deepEqual(toggleHidden(defaultLayout(), MAIN_KEY), defaultLayout());
        assert.deepEqual(togglePinned(defaultLayout(), MAIN_KEY), defaultLayout());
    });

    it("pins and unpins", () => {
        const pinned = togglePinned(defaultLayout(), "updater");
        assert.equal(isPinned(pinned, "updater"), true);
        assert.equal(isPinned(togglePinned(pinned, "updater"), "updater"), false);
    });

    it("turns all tabs off except the main one, and all on again", () => {
        const off = setAllHidden(defaultLayout(), keys, true);
        assert.deepEqual(off.hidden, ["privacy", "plugins", "themes", "updater"]);
        assert.equal(allShown(off, keys), false);
        const on = setAllHidden(off, keys, false);
        assert.deepEqual(on.hidden, []);
        assert.equal(allShown(on, keys), true);
    });

    it("moves a tab to the place of the one it is dropped on", () => {
        const moved = moveTab(defaultLayout(), keys, "updater", "privacy");
        assert.deepEqual(names(orderTabs(entries, moved)), [MAIN_KEY, "updater", "privacy", "plugins", "themes"]);
        const back = moveTab(moved, keys, "privacy", "themes");
        assert.deepEqual(names(orderTabs(entries, back)), [MAIN_KEY, "updater", "plugins", "privacy", "themes"]);
    });

    it("does not move the main tab, nothing onto the main tab, a tab onto itself or an unknown tab", () => {
        const start = defaultLayout();
        assert.equal(moveTab(start, keys, MAIN_KEY, "privacy"), start);
        assert.equal(moveTab(start, keys, "privacy", MAIN_KEY), start);
        assert.equal(moveTab(start, keys, "privacy", "privacy"), start);
        assert.equal(moveTab(start, keys, "ghost", "privacy"), start);
        assert.equal(moveTab(start, keys, "privacy", "ghost"), start);
    });

    it("restores the original layout", () => {
        assert.deepEqual(restoreLayout(), defaultLayout());
        assert.notEqual(restoreLayout(), restoreLayout(), "each call gives a new object");
    });
});
