/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createContextMenuLayer } from "../src/api/contextMenu";
import type { MenuParts } from "../src/api/menuParts";
import { createNativeMenuHub } from "../src/api/nativeMenus";

function setup(over: { hub?: boolean; parts?: () => MenuParts | undefined; } = {}) {
    const hub = createNativeMenuHub();
    const layer = createContextMenuLayer({
        addStyle: () => undefined,
        ...(over.hub === false ? {} : { native: hub }),
        ...(over.parts ? { menuParts: over.parts } : {})
    });
    const disposers: Array<() => void> = [];
    const errors: Array<[string, unknown]> = [];
    const forPlugin = (id: string) => layer.forPlugin(id, undo => { disposers.push(undo); }, (source, error) => { errors.push([source, error]); });
    const draw = (navId: string, children: unknown[] = []) => (hub.patchProps({ navId, children }) as { children: unknown[]; }).children;
    return { hub, disposers, errors, forPlugin, draw };
}

describe("ctx.contextMenu.addNative", () => {
    it("adds an entry to the native menu with that navId, and gives back a function that stops it", () => {
        const t = setup();
        const menu = t.forPlugin("P");
        const stop = menu.addNative("quests-entry", children => { children.unshift("mine"); });
        assert.deepEqual(t.draw("quests-entry", ["theirs"]), ["mine", "theirs"]);
        assert.deepEqual(t.draw("other-menu", ["theirs"]), ["theirs"]);
        stop();
        assert.deepEqual(t.draw("quests-entry", ["theirs"]), ["theirs"]);
        assert.doesNotThrow(stop);
    });

    it("stops every callback of the plugin, and only those, when the plugin stops, with one cleanup however many it added", () => {
        const t = setup();
        const a = t.forPlugin("A");
        const b = t.forPlugin("B");
        a.addNative("m", children => { children.push("a1"); });
        a.addNative("n", children => { children.push("a2"); });
        b.addNative("m", children => { children.push("b"); });
        assert.equal(t.disposers.length, 2, "one cleanup per plugin");
        t.disposers[0]();
        assert.deepEqual(t.draw("m"), ["b"]);
        assert.deepEqual(t.draw("n"), []);
    });

    it("reports a callback that throws, naming the menu, and the menu still gets the others", () => {
        const t = setup();
        const menu = t.forPlugin("P");
        menu.addNative("quests-entry", () => { throw new Error("boom"); });
        menu.addNative("quests-entry", children => { children.push("ok"); });
        assert.deepEqual(t.draw("quests-entry"), ["ok"]);
        assert.equal(t.errors.length, 1);
        assert.equal(t.errors[0][0], "native menu quests-entry");
    });

    it("hands the props of the code that made the menu to the callback", () => {
        const t = setup();
        let got: unknown;
        t.forPlugin("P").addNative("quests-entry", (_children, props) => { got = props; });
        const quest = { id: "q" };
        t.hub.patchProps({ navId: "quests-entry", children: [], contextMenuAPIArguments: [{ quest }] });
        assert.deepEqual(got, { quest });
    });

    it("does nothing, and gives back a function that does nothing, for a callback that is not a function or a navId that is not plain text", () => {
        const t = setup();
        const menu = t.forPlugin("P");
        for (const stop of [menu.addNative("m", "no" as never), menu.addNative("bad id", () => undefined), menu.addNative(5 as never, () => undefined)]) {
            assert.equal(typeof stop, "function");
            assert.doesNotThrow(stop);
        }
        assert.deepEqual(t.draw("m"), []);
        assert.equal(t.disposers.length, 0, "a refused entry leaves no cleanup");
    });

    it("does nothing when the page has no place to keep entries", () => {
        const t = setup({ hub: false });
        const stop = t.forPlugin("P").addNative("m", children => { children.push("x"); });
        assert.equal(typeof stop, "function");
        assert.doesNotThrow(stop);
        assert.deepEqual(t.draw("m"), [], "nothing was registered");
        assert.equal(t.disposers.length, 0);
    });

    it("keeps the limit of callbacks per plugin, and the others still stop with the plugin", () => {
        const t = setup();
        const menu = t.forPlugin("P");
        let added = 0;
        for (let i = 0; i < 30; i++) menu.addNative("m", () => { added++; });
        t.draw("m");
        assert.equal(added, 20);
    });
});

describe("ctx.contextMenu.parts", () => {
    const parts: MenuParts = { Menu: () => null, MenuGroup: () => null, MenuItem: () => null, MenuSeparator: () => null, MenuCheckboxItem: () => null };

    it("gives Discord's pieces when they were found, asking each time", () => {
        const state: { found?: MenuParts; } = {};
        const menu = setup({ parts: () => state.found }).forPlugin("P");
        assert.equal(menu.parts(), undefined);
        state.found = parts;
        assert.equal(menu.parts(), parts);
    });

    it("answers undefined when the engine has no way to look, and when looking fails", () => {
        assert.equal(setup().forPlugin("P").parts(), undefined);
        const failing = setup({ parts: () => { throw new Error("no"); } }).forPlugin("P");
        assert.doesNotThrow(() => failing.parts());
        assert.equal(failing.parts(), undefined);
    });
});
