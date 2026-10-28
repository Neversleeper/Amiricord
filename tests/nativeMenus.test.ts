/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createNativeMenuHub, MAX_NATIVE_MENU_CALLBACKS_PER_PLUGIN, nativeMenus } from "../src/api/nativeMenus";

const quiet = () => undefined;

describe("adding entries to a native menu", () => {
    it("gives each callback the children (a copy) and the props of the code that made the menu, and draws the list they leave", () => {
        const hub = createNativeMenuHub();
        const quest = { id: "q1" };
        const original = ["a", "b"];
        const seen: unknown[] = [];
        hub.add("P", "quests-entry", (children, props) => { seen.push(props); children.unshift("first"); children.push("last"); }, quiet);
        const props = { navId: "quests-entry", children: original, onClose: quiet, contextMenuAPIArguments: [{ quest }] };
        const result = hub.patchProps(props) as typeof props;
        assert.deepEqual(result.children, ["first", "a", "b", "last"]);
        assert.deepEqual(original, ["a", "b"], "Discord's own list is never changed");
        assert.deepEqual(seen, [{ quest }]);
        assert.equal(result.onClose, quiet, "the other props go on");
        assert.notEqual(result, props);
    });

    it("does not add the entry twice when the same menu is drawn again with the same list", () => {
        const hub = createNativeMenuHub();
        hub.add("P", "m", children => { children.unshift("x"); }, quiet);
        const props = { navId: "m", children: ["a"] };
        assert.deepEqual((hub.patchProps(props) as typeof props).children, ["x", "a"]);
        assert.deepEqual((hub.patchProps(props) as typeof props).children, ["x", "a"]);
    });

    it("runs the callbacks of a plugin in the order they were added, and each plugin's own", () => {
        const hub = createNativeMenuHub();
        const order: string[] = [];
        hub.add("A", "m", () => { order.push("A1"); }, quiet);
        hub.add("B", "m", () => { order.push("B"); }, quiet);
        hub.add("A", "m", () => { order.push("A2"); }, quiet);
        hub.patchProps({ navId: "m", children: [] });
        assert.deepEqual(order, ["A1", "B", "A2"]);
    });

    it("hands the menu's own props when the code that made it gave nothing", () => {
        const hub = createNativeMenuHub();
        const seen: unknown[] = [];
        hub.add("P", "m", (_c, props) => { seen.push(props); }, quiet);
        const props = { navId: "m", children: [] };
        hub.patchProps(props);
        hub.patchProps({ ...props, contextMenuAPIArguments: [] });
        hub.patchProps({ ...props, contextMenuAPIArguments: "text" });
        assert.equal(seen[0], props);
        assert.deepEqual(Object.keys(seen[1] as object), ["navId", "children", "contextMenuAPIArguments"]);
        assert.deepEqual(Object.keys(seen[2] as object), ["navId", "children", "contextMenuAPIArguments"]);
    });

    it("does not take an object whose length is not a number for the arguments", () => {
        const hub = createNativeMenuHub();
        let got: unknown;
        hub.add("P", "m", (_c, props) => { got = props; }, quiet);
        const props = { navId: "m", children: [], contextMenuAPIArguments: { 0: "first", length: "2" } };
        hub.patchProps(props);
        assert.equal(got, props);
    });

    it("takes an array-like of arguments and uses its first", () => {
        const hub = createNativeMenuHub();
        let got: unknown;
        hub.add("P", "m", (_c, props) => { got = props; }, quiet);
        const args = { 0: "first", 1: "second", length: 2 };
        hub.patchProps({ navId: "m", children: [], contextMenuAPIArguments: args });
        assert.equal(got, "first");
    });

    it("turns a single child or no child into a list", () => {
        const hub = createNativeMenuHub();
        hub.add("P", "m", children => { children.push("added"); }, quiet);
        assert.deepEqual((hub.patchProps({ navId: "m", children: "one" }) as { children: unknown[]; }).children, ["one", "added"]);
        assert.deepEqual((hub.patchProps({ navId: "m", children: undefined }) as { children: unknown[]; }).children, ["added"]);
        assert.deepEqual((hub.patchProps({ navId: "m", children: null }) as { children: unknown[]; }).children, ["added"]);
        assert.deepEqual((hub.patchProps({ navId: "m" }) as { children: unknown[]; }).children, ["added"]);
    });

    it("returns the very same props when nothing is registered for that menu, or the props are not a menu's", () => {
        const hub = createNativeMenuHub();
        hub.add("P", "other", children => { children.push("x"); }, quiet);
        const props = { navId: "m", children: ["a"] };
        assert.equal(hub.patchProps(props), props);
        for (const value of [undefined, null, 5, "text", [], { children: [] }, { navId: 5, children: [] }]) assert.equal(hub.patchProps(value), value);
    });
});

describe("a callback that fails", () => {
    it("is reported, the others still run, and the menu is drawn with what the others did", () => {
        const hub = createNativeMenuHub();
        const errors: string[] = [];
        hub.add("Bad", "m", children => { children.push("half"); throw new Error("boom"); }, error => { errors.push(String(error)); });
        hub.add("Good", "m", children => { children.push("good"); }, quiet);
        const result = hub.patchProps({ navId: "m", children: [] }) as { children: unknown[]; };
        assert.deepEqual(errors, ["Error: boom"]);
        assert.deepEqual(result.children, ["half", "good"]);
    });

    it("is not allowed to break the menu by throwing from the error report", () => {
        const hub = createNativeMenuHub();
        hub.add("Bad", "m", () => { throw new Error("one"); }, () => { throw new Error("two"); });
        assert.doesNotThrow(() => hub.patchProps({ navId: "m", children: [] }));
    });
});

describe("registering and removing", () => {
    it("refuses a navId that is not plain text, and a callback that is not a function", () => {
        const hub = createNativeMenuHub();
        for (const navId of ["", "a b", "a/b", "x".repeat(81), 5, undefined, null, "<script>"]) assert.equal(hub.add("P", navId as string, quiet, quiet), false, String(navId));
        assert.equal(hub.add("P", "m", "no" as never, quiet), false);
        assert.equal(hub.add("P", "ok_nav-1", quiet, quiet), true);
        assert.equal(hub.add("P", "x".repeat(80), quiet, quiet), true);
    });

    it("limits the callbacks of one plugin, counted over every menu, and not those of the others", () => {
        const hub = createNativeMenuHub();
        for (let i = 0; i < MAX_NATIVE_MENU_CALLBACKS_PER_PLUGIN; i++) assert.equal(hub.add("P", `m${i % 3}`, quiet, quiet), true);
        assert.equal(hub.add("P", "m0", quiet, quiet), false);
        assert.equal(hub.add("Q", "m0", quiet, quiet), true);
    });

    it("stops one callback, and only that one", () => {
        const hub = createNativeMenuHub();
        const a = (children: unknown[]) => { children.push("a"); };
        const b = (children: unknown[]) => { children.push("b"); };
        hub.add("P", "m", a, quiet);
        hub.add("P", "m", b, quiet);
        hub.remove("P", "m", b);
        assert.deepEqual((hub.patchProps({ navId: "m", children: [] }) as { children: unknown[]; }).children, ["a"], "the second one was the one stopped");
        hub.remove("P", "m", a);
        const props = { navId: "m", children: [] };
        assert.equal(hub.patchProps(props), props, "nothing is left for that menu");
        assert.doesNotThrow(() => { hub.remove("P", "nope", a); });
    });

    it("does not stop another plugin's callback that is the same function", () => {
        const hub = createNativeMenuHub();
        const shared = (children: unknown[]) => { children.push("x"); };
        const other = (children: unknown[]) => { children.push("q-only"); };
        hub.add("Q", "m", shared, quiet);
        hub.add("P", "m", other, quiet);
        hub.add("P", "m", shared, quiet);
        hub.remove("P", "m", shared);
        assert.deepEqual((hub.patchProps({ navId: "m", children: [] }) as { children: unknown[]; }).children, ["x", "q-only"], "Q's shared callback and P's other one stay");
    });

    it("stops everything a plugin added, over every menu, and nothing of the others", () => {
        const hub = createNativeMenuHub();
        hub.add("P", "m1", children => { children.push("p1"); }, quiet);
        hub.add("P", "m2", children => { children.push("p2"); }, quiet);
        hub.add("Q", "m1", children => { children.push("q1"); }, quiet);
        hub.removeAll("P");
        assert.deepEqual((hub.patchProps({ navId: "m1", children: [] }) as { children: unknown[]; }).children, ["q1"]);
        const other = { navId: "m2", children: [] };
        assert.equal(hub.patchProps(other), other);
    });

    it("lets a callback remove itself while it runs", () => {
        const hub = createNativeMenuHub();
        const order: string[] = [];
        const once = () => { order.push("once"); hub.remove("P", "m", once); };
        hub.add("P", "m", once, quiet);
        hub.add("P", "m", () => { order.push("other"); }, quiet);
        hub.patchProps({ navId: "m", children: [] });
        hub.patchProps({ navId: "m", children: [] });
        assert.deepEqual(order, ["once", "other", "other"]);
    });
});

describe("the one hub of the page", () => {
    it("exists and starts empty", () => {
        const props = { navId: "never-used-nav", children: [] };
        assert.equal(nativeMenus.patchProps(props), props);
    });
});
