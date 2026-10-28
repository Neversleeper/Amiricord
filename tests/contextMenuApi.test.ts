/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { nativeMenus } from "../src/api/nativeMenus";
import plugin from "../src/plugins/ContextMenuApi/index";
import { compileModule } from "../src/webpack/compileModule";

const [argumentsPatch, menuPatch] = plugin.patches!;
const registered = (patch: typeof argumentsPatch) => ({ ...patch, plugin: "ContextMenuApi" });
const OPTIONS = { selfExpression: () => "SELF" };

/** Compile `source` with a patch and run the module's factory with a fake `SELF`. */
function load(source: string, patch: typeof argumentsPatch, self: Record<string, unknown> = {}) {
    const result = compileModule("1", source, [registered(patch)], OPTIONS);
    // eslint-disable-next-line no-new-func -- the tests build module factories from text, as Discord's are
    const factory = new Function("SELF", `return (${result.code})`)(self) as (module: unknown, exports: Record<string, unknown>, require: (id: number) => unknown) => void;
    const exports: Record<string, unknown> = {};
    factory({ exports }, exports, () => ({}));
    return { result, exports };
}

describe("the patch that hands over what the menu's code was given", () => {
    // A component that builds the props of a menu with a navId written as text, like the one of a Quest tile.
    const MENU_MAKER = "function(e,t,n){t.make=function(props){return {variant:\"fixed\",navId:\"quests-entry\",\"aria-label\":\"x\",quest:props.quest,children:[1]}}}";

    it("adds the arguments of the enclosing function to the object that has a navId written as text, so the first one is the component's props", () => {
        const { result, exports } = load(MENU_MAKER, argumentsPatch);
        assert.equal(result.outcomes[0].status, "applied");
        const made = (exports.make as (props: unknown) => { contextMenuAPIArguments: ArrayLike<unknown>; navId: string; quest: unknown; })({ quest: 7 });
        assert.equal(made.navId, "quests-entry");
        assert.deepEqual((made.contextMenuAPIArguments[0] as { quest: number; }).quest, 7);
        assert.equal(made.quest, 7, "what was there stays");
    });

    it("changes every such navId in the module and keeps the text that follows", () => {
        const two = "function(e,t,n){t.a=function(p){return {navId:\"one\",x:1}};t.b=function(p){return {navId:\"two\",y:2}}}";
        const { result, exports } = load(two, argumentsPatch);
        assert.equal(result.code.split("contextMenuAPIArguments").length - 1, 2);
        assert.equal((exports.a as (p: unknown) => { navId: string; })(1).navId, "one");
        assert.equal((exports.b as (p: unknown) => { navId: string; })(1).navId, "two");
    });

    it("leaves alone a navId that is not written as text (a destructuring, a variable)", () => {
        const pattern = "function(e,t,n){t.f=function(e){let{navId:t,variant:n=\"flexible\"}=e;return [t,n]};t.g=function(v){return {navId:v}}}";
        const result = compileModule("1", pattern, [registered(argumentsPatch)], OPTIONS);
        assert.equal(result.changed, false);
        assert.equal(result.code.includes("contextMenuAPIArguments"), false);
    });

    it("changes only the navId written as text in a module that also destructures a navId", () => {
        const both = "function(e,t,n){t.f=function(e){let{navId:t}=e;return t};t.g=function(){return {navId:\"m\"}}}";
        const { result, exports } = load(both, argumentsPatch);
        assert.equal(result.outcomes[0].status, "applied");
        assert.equal(result.code.split("contextMenuAPIArguments").length - 1, 1);
        assert.equal((exports.f as (e: unknown) => unknown)({ navId: "x" }), "x");
        assert.equal((exports.g as () => { navId: string; })().navId, "m");
    });

    it("does not touch a module that has no navId text, and applies to every module that has it", () => {
        assert.equal(compileModule("1", "function(){var a=1}", [registered(argumentsPatch)], OPTIONS).changed, false);
        assert.equal(argumentsPatch.all, true);
    });
});

// Our own shape of the Menu's module, with the words the patch looks at.
const MENU_MODULE = "function(e,t,n){var L=n(5);function eA(e){let{navId:t,variant:n=\"flexible\",hideScroller:i=!1,children:o}=e;return [t,n,i,o]}t.W=eA}";

describe("the patch on Discord's Menu component", () => {
    it("hands the props to patchMenu first, and the Menu then uses what it gave back", () => {
        const calls: unknown[] = [];
        const self = { patchMenu: (props: unknown) => { calls.push(props); return { navId: "patched", variant: "v", hideScroller: 1, children: ["c"] }; } };
        const { result, exports } = load(MENU_MODULE, menuPatch, self);
        assert.equal(result.outcomes[0].status, "applied");
        const given = { navId: "quests-entry", children: ["a"] };
        assert.deepEqual((exports.W as (props: unknown) => unknown)(given), ["patched", "v", 1, ["c"]]);
        assert.deepEqual(calls, [given]);
    });

    it("is not applied to a module that lacks the shape (another word for the variant, no hideScroller)", () => {
        for (const other of [MENU_MODULE.replace("\"flexible\"", "\"fixed\""), MENU_MODULE.replace("hideScroller", "hideScrollbar"), MENU_MODULE.replace("{navId:t,", "{id:t,")]) {
            const result = compileModule("1", other, [registered(menuPatch)], OPTIONS);
            assert.equal(result.changed, false);
        }
    });

    it("both patches are optional and lazy, so a Discord that moved the text only means no entry is added", () => {
        for (const patch of [argumentsPatch, menuPatch]) {
            assert.equal(patch.required, false);
            assert.equal(patch.lazy, true);
        }
    });
});

describe("the real code of Discord's Menu module and of the Quest tile menu (only when probe dumps are on this machine)", () => {
    const menu = "probe/module-source-980707.json";
    const quest = "probe/module-source-270045.json";

    it("takes the Menu patch and still parses", { skip: !existsSync(menu) }, () => {
        const calls: unknown[] = [];
        const result = compileModule("980707", readFileSync(menu, "utf8"), [registered(menuPatch)], OPTIONS);
        assert.equal(result.outcomes[0].status, "applied");
        assert.match(result.code, /function \w+\((\w+)\)\{\1=SELF\.patchMenu\(\1\);let\{navId:/);
        assert.deepEqual(calls, []);
    });

    it("takes the arguments patch in the Quest tile menu and still parses", { skip: !existsSync(quest) }, () => {
        const result = compileModule("270045", readFileSync(quest, "utf8"), [registered(argumentsPatch)], OPTIONS);
        assert.equal(result.outcomes[0].status, "applied");
        assert.match(result.code, /contextMenuAPIArguments:typeof arguments!="undefined"\?arguments:\[\],navId:"quests-entry"/);
    });
});

describe("patchMenu", () => {
    it("asks the hub, so what a plugin added shows, and gives the props back untouched when nothing is registered", () => {
        const callback = (children: unknown[]) => { children.unshift("mine"); };
        nativeMenus.add("TestPlugin", "context-menu-api-test", callback, () => undefined);
        try {
            const props = { navId: "context-menu-api-test", children: ["a"] };
            assert.deepEqual((plugin.patchMenu(props) as typeof props).children, ["mine", "a"]);
            const other = { navId: "another-menu", children: ["a"] };
            assert.equal(plugin.patchMenu(other), other);
        } finally {
            nativeMenus.removeAll("TestPlugin");
        }
    });

    it("never throws, whatever it is given", () => {
        for (const value of [undefined, null, 1, "text", [], {}, { navId: {} }]) assert.doesNotThrow(() => plugin.patchMenu(value));
    });
});
