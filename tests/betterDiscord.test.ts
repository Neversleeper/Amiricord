/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the fakes stand in for a page and for plugins of any shape */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { bundledBdPluginsSource } from "../scripts/build/generate";
import { createBdData } from "../src/plugins/BetterDiscord/bdData";
import { createBdWebpack } from "../src/plugins/BetterDiscord/bdWebpack";
import { createBdLayer, type LayerContext } from "../src/plugins/BetterDiscord/layer";
import { idOf, parseBdMeta } from "../src/plugins/BetterDiscord/meta";
import { createPatcher } from "../src/plugins/BetterDiscord/patcher";
import { runPluginSource } from "../src/plugins/BetterDiscord/runner";
import { buildSettingsPanel } from "../src/plugins/BetterDiscord/settingsBuilder";
import { WreqView } from "../src/renderer/wreqView";

describe("parseBdMeta", () => {
    it("reads the fields of the header comment, a field may go on over several lines", () => {
        const meta = parseBdMeta(`/**\n * @name My Plugin\n * @author A, B\n * @version 1.2.3\n * @description First line\n *   second line\n * @source https://example.com/src\n */\nmodule.exports = {};`, "x.plugin.js");
        assert.equal(meta.name, "My Plugin");
        assert.equal(meta.author, "A, B");
        assert.equal(meta.version, "1.2.3");
        assert.equal(meta.description, "First line second line");
        assert.equal(meta.source, "https://example.com/src");
        assert.equal(idOf(meta.name), "My_Plugin");
    });

    it("skips a licence comment without fields, ignores a byte order mark, and keeps the first of a repeated field", () => {
        const meta = parseBdMeta(`﻿/**\n * Licence text\n */\n/**\n * @name Real\n * @name Other\n */`, "Real.plugin.js");
        assert.equal(meta.name, "Real");
    });

    it("falls back to the old //META format, and to the file name when there is no header", () => {
        assert.equal(parseBdMeta("//META{\"name\":\"Old\",\"version\":\"0.1\"}*//\nclass Old {}", "Old.plugin.js").version, "0.1");
        const none = parseBdMeta("module.exports = {};", "Plain.plugin.js");
        assert.deepEqual([none.name, none.version, none.author], ["Plain", "unknown", "unknown"]);
    });
});

describe("the patcher", () => {
    const make = () => {
        const errors: string[] = [];
        return { patcher: createPatcher((caller, where, error) => errors.push(`${caller}|${where}|${(error as Error).message}`)), errors };
    };

    it("runs before (which may change the arguments), after (which may change the result) and instead", () => {
        const { patcher } = make();
        const target = { add: (a: number, b: number) => a + b };
        patcher.before("P", target, "add", (_t, args) => { args[0] = 10; });
        patcher.after("P", target, "add", (_t, _args, result) => (result as number) * 2);
        assert.equal(target.add(1, 2), 24);
        patcher.instead("P", target, "add", (_t, args, original) => (original as (...a: unknown[]) => number)(...args) + 100);
        assert.equal(target.add(1, 2), 224);
    });

    it("puts the original function back when the last patch goes, and unpatchAll takes only one caller's patches", () => {
        const { patcher } = make();
        const original = () => "a";
        const target = { f: original };
        const undoOne = patcher.after("One", target, "f", () => "b");
        patcher.after("Two", target, "f", (_t, _a, r) => `${String(r)}!`);
        assert.notEqual(target.f, original);
        patcher.unpatchAll("One");
        assert.equal(target.f(), "a!");
        undoOne();
        patcher.unpatchAll("Two");
        assert.equal(target.f, original);
        assert.equal(patcher.countOf("Two"), 0);
    });

    it("reports a callback that throws and goes on: the call still happens", () => {
        const { patcher, errors } = make();
        const target = { f: () => "value" };
        patcher.before("P", target, "f", () => { throw new Error("boom"); });
        patcher.instead("P", target, "f", () => { throw new Error("bang"); });
        assert.equal(target.f(), "value");
        assert.deepEqual(errors, ["P|before patch of f|boom", "P|instead patch of f|bang"]);
    });

    it("a patch with once undoes itself after the first call; a missing function needs forcePatch", () => {
        const { patcher } = make();
        const target: Record<string, any> = { f: () => 1 };
        let calls = 0;
        patcher.after("P", target, "f", () => { calls++; }, { once: true });
        target.f(); target.f();
        assert.equal(calls, 1);
        assert.throws(() => patcher.after("P", target, "missing", () => undefined), /not a function/);
        patcher.after("P", target, "missing", () => "x", { forcePatch: true });
        assert.equal(target.missing(), "x");
        assert.throws(() => patcher.after("P", 5 as unknown as object, "f", () => undefined), /object or a function/);
    });

    it("keeps `this` and does not put back a function somebody else replaced in the meantime", () => {
        const { patcher } = make();
        const target = { n: 7, get() { return this.n; } };
        const undo = patcher.after("P", target, "get", (self, _a, r) => (self as typeof target).n + (r as number));
        assert.equal(target.get(), 14);
        const other = () => 0;
        target.get = other as typeof target.get;
        undo();
        assert.equal(target.get, other);
    });
});

describe("BdApi.Webpack", () => {
    const modules: Array<{ id: string; exports: unknown; }> = [
        { id: "1", exports: { foo: () => 1, bar: 2 } },
        { id: "2", exports: { default: { baz: () => 3 }, __esModule: true } },
        { id: "3", exports: { A: { getName: () => "ThingStore" }, other: 1 } },
        { id: "4", exports: { getToken: () => "secret", sneaky: true } },
        { id: "5", exports: { Comp: function Comp() { return "needle in code"; } } }
    ];
    const web = (list = modules) => createBdWebpack({ loaded: () => list, sourceOf: id => (id === "5" ? "function(){ /* special marker */ }" : undefined) }, { timeoutMs: 80, pollMs: 5 });

    it("finds by keys, by props, inside default exports and by store name", () => {
        const w = web();
        assert.equal(w.getByKeys("foo", "bar").bar, 2);
        assert.equal(typeof w.getByProps("baz").baz, "function");
        assert.equal(w.getByProps("baz", { defaultExport: false }).default.baz instanceof Function, true);
        assert.equal(w.getStore("ThingStore").getName(), "ThingStore");
        assert.equal(w.getByKeys("nothing"), undefined);
    });

    it("never offers a module that gives out the token, whatever the filter", () => {
        const w = web();
        assert.equal(w.getByKeys("getToken"), undefined);
        assert.equal(w.getModule(() => true, { first: false }).some((m: any) => "getToken" in m), false);
    });

    it("searchExports looks at each property; first:false gives every match; raw gives the record", () => {
        const w = web();
        assert.equal(w.getModule((e: any) => typeof e === "function" && /needle/.test(String(e)), { searchExports: true }).name, "Comp");
        assert.equal(w.getModules((e: any) => e && typeof e.foo === "function").length, 1);
        assert.equal(w.getModule((e: any) => e && e.bar === 2, { raw: true }).id, "1");
    });

    it("byStrings and bySource read function text and module source", () => {
        const w = web();
        assert.equal(w.getByStrings("needle in code").name, "Comp");
        assert.equal(w.getBySource("special marker").Comp.name, "Comp");
    });

    it("a filter that throws just does not match; waitForModule waits for a later module and gives up", async () => {
        const list = [...modules];
        const w = web(list);
        assert.equal(w.getModule(() => { throw new Error("x"); }), undefined);
        const later = w.waitForModule((e: any) => e && e.late === true);
        setTimeout(() => list.push({ id: "9", exports: { late: true } }), 15);
        assert.equal((await later).late, true);
        await assert.rejects(w.waitForModule((e: any) => e && e.never === true), /no module matched within 80 ms/);
        const controller = new AbortController();
        const cancelled = w.getLazy(() => false, { signal: controller.signal, timeout: 1000 });
        controller.abort();
        await assert.rejects(cancelled, /cancelled/);
    });

    it("Bulk answers one result per query", () => {
        const w = web();
        const [a, b] = w.Bulk(w.Filters.byKeys("foo"), { filter: w.Filters.byKeys("bar"), first: false });
        assert.equal(typeof a.foo, "function");
        assert.equal(Array.isArray(b), true);
    });
});

describe("BdApi.Data", () => {
    it("is synchronous once preloaded, copies values, and writes the change back later", async () => {
        const written: Array<[string, Record<string, unknown>]> = [];
        let scheduled: (() => void) | undefined;
        const data = createBdData(
            { read: async plugin => (plugin === "P" ? { old: 1 } : undefined), write: async (plugin, value) => { written.push([plugin, value]); } },
            { setTimeout: run => { scheduled = run; return 0; } }
        );
        await data.preload("P");
        assert.equal(data.load("P", "old"), 1);
        const list = [1, 2];
        data.save("P", "list", list);
        list.push(3);
        assert.deepEqual(data.load("P", "list"), [1, 2]);
        data.delete("P", "old");
        assert.equal(data.load("P", "old"), undefined);
        assert.equal(written.length, 0);
        scheduled?.();
        await data.flush();
        assert.deepEqual(written, [["P", { list: [1, 2] }]]);
    });

    it("tells the owner when a write fails but never throws into the plugin", async () => {
        const failures: string[] = [];
        const data = createBdData({ read: async () => undefined, write: async () => { throw new Error("too big"); }, onError: (plugin, error) => failures.push(`${plugin}:${(error as Error).message}`) }, { delayMs: 0 });
        data.save("P", "k", 1);
        await data.flush();
        assert.deepEqual(failures, ["P:too big"]);
    });
});

describe("runPluginSource", () => {
    const meta = parseBdMeta("/** @name T */", "T.plugin.js");
    const run = (source: string) => runPluginSource({ source, fileName: "T.plugin.js", meta, bdApi: { marker: "api" }, page: {} });

    it("accepts a class, an object and a function that makes the plugin, and hands the plugin its meta and BdApi", () => {
        assert.equal(run("module.exports = class { start() {} };").start instanceof Function, true);
        assert.equal(run("module.exports = { start() { return BdApi.marker; } };").start(), "api");
        assert.equal(run("module.exports = meta => ({ name: meta.name, start() {} });").name, "T");
        assert.equal(run("module.exports = class { constructor(meta) { this.n = meta.name; } start() {} };").n, "T");
    });

    it("explains a syntax error, a file that exports nothing and a plugin without start", () => {
        assert.throws(() => run("module.exports = {"), /T: the file has a syntax error/);
        assert.throws(() => run("// nothing"), /does not export a plugin|no start/);
        assert.throws(() => run("module.exports = { stop() {} };"), /no start\(\) function/);
    });

    it("gives `events` and refuses the Node modules that Discord's page does not have, with a clear message", () => {
        assert.equal(run("const { EventEmitter } = require('events'); module.exports = { start() {}, e: new EventEmitter() };").e.emit("x"), false);
        assert.throws(() => run("require('fs'); module.exports = { start() {} };"), /asked for the Node module "fs"/);
    });
});

/** Just enough of a page for the layer: styles in a head, ids, an observer. */
function fakePage() {
    const byId = new Map<string, any>();
    const element = (tag: string): any => ({
        tag, id: "", textContent: "", style: {}, children: [] as any[], listeners: {} as Record<string, Array<() => void>>,
        append(...nodes: any[]) { this.children.push(...nodes); },
        appendChild(node: any) { this.children.push(node); if (node.id) byId.set(node.id, node); },
        remove() { if (this.id) byId.delete(this.id); },
        addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); },
        removeEventListener() { /* not needed */ },
        setAttribute() { /* not needed */ }
    });
    const observers: Array<{ disconnected: boolean; callback: (m: any[]) => void; }> = [];
    class FakeObserver {
        record = { disconnected: false, callback: undefined as unknown as (m: any[]) => void };
        constructor(callback: (m: any[]) => void) { this.record.callback = callback; observers.push(this.record); }
        observe() { /* nothing */ }
        disconnect() { this.record.disconnected = true; }
    }
    const document = { head: element("head"), body: { querySelector: () => null, ...element("body") }, documentElement: { clientWidth: 800, clientHeight: 600 }, getElementById: (id: string) => byId.get(id) ?? null, createElement: element, defaultView: undefined };
    const page = { document, innerWidth: 800, innerHeight: 600, MutationObserver: FakeObserver, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined, performance: { now: () => 0 } };
    return { page, byId, observers };
}

function fakeLayer(files: Array<{ file: string; code: string; }>, extra: Partial<LayerContext> = {}) {
    const state = { storage: new Map<string, any>(), toasts: [] as string[], errors: [] as string[], list: [{ id: "1", exports: { chat: true } }] as any[] };
    const { page, byId, observers } = fakePage();
    const ctx: LayerContext = {
        modules: { loaded: () => state.list, sourceOf: () => undefined },
        storage: { get: async key => state.storage.get(key), set: async (key, value) => { state.storage.set(key, JSON.parse(JSON.stringify(value))); } },
        toasts: { show: message => state.toasts.push(message) },
        modals: { open: () => undefined, close: () => undefined },
        react: () => undefined,
        reportError: (source, error) => state.errors.push(`${source}|${(error as Error).message}`),
        page: page as any,
        pageGlobal: { marker: "page" },
        ...extra
    };
    const layer = createBdLayer(ctx, files);
    return { layer, state, byId, observers };
}

const PLUGIN_A = `/** @name Alpha\n * @author Me\n * @version 1\n */\nmodule.exports = class Alpha { constructor() { this.api = new BdApi("Alpha"); this.log = []; } start() { this.log.push("start"); this.api.DOM.addStyle("alpha", "a{}"); this.api.Data.save("n", (this.api.Data.load("n") || 0) + 1); this.api.UI.showToast("hello", { type: "success" }); globalThis.__alphaTarget = { f() { return 1; } }; this.api.Patcher.after(globalThis.__alphaTarget, "f", () => 2); } stop() { this.log.push("stop"); } };`;
const PLUGIN_BAD = `/** @name Broken */\nmodule.exports = class Broken { start() { BdApi.DOM.addStyle("broken", "b{}"); throw new Error("cannot start"); } };`;

describe("the BetterDiscord layer", () => {
    it("lists the bundled plugins from their headers without running any of them", () => {
        const { layer, byId } = fakeLayer([{ file: "Alpha.plugin.js", code: PLUGIN_A }, { file: "Broken.plugin.js", code: PLUGIN_BAD }]);
        assert.deepEqual(layer.manager.list().map(p => [p.id, p.name, p.state]), [["Alpha", "Alpha", "off"], ["Broken", "Broken", "off"]]);
        assert.equal(byId.size, 0);
    });

    it("switching a plugin on runs it with its own BdApi; switching it off stops it and takes back its style and patch", async () => {
        const { layer, state, byId } = fakeLayer([{ file: "Alpha.plugin.js", code: PLUGIN_A }]);
        assert.equal(await layer.manager.enable("Alpha"), true);
        assert.equal(layer.manager.list()[0].state, "on");
        assert.equal(byId.has("bd-alpha"), true);
        assert.deepEqual(state.toasts, ["hello"]);
        assert.equal((globalThis as any).__alphaTarget.f(), 2);
        await layer.manager.disable("Alpha");
        assert.equal(layer.manager.list()[0].state, "off");
        assert.equal(byId.has("bd-alpha"), false);
        assert.equal((globalThis as any).__alphaTarget.f(), 1);
        assert.deepEqual(state.storage.get("enabled"), []);
        delete (globalThis as any).__alphaTarget;
    });

    it("keeps what a plugin saved between runs, and the list of plugins that were on", async () => {
        const first = fakeLayer([{ file: "Alpha.plugin.js", code: PLUGIN_A }]);
        await first.layer.manager.enable("Alpha");
        first.layer.dispose();
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepEqual(first.state.storage.get("enabled"), ["Alpha"]);
        assert.equal(first.state.storage.get("data-Alpha").n, 1);

        const second = fakeLayer([{ file: "Alpha.plugin.js", code: PLUGIN_A }]);
        second.state.storage = first.state.storage;
        await second.layer.manager.startSaved();
        assert.equal(second.layer.manager.list()[0].state, "on");
        assert.equal((await second.state.storage.get("data-Alpha")).n, 1);
        second.layer.dispose();
        delete (globalThis as any).__alphaTarget;
    });

    it("a plugin that fails to start is marked failed with the reason, what it added is removed, and the others go on", async () => {
        const { layer, state, byId } = fakeLayer([{ file: "Broken.plugin.js", code: PLUGIN_BAD }, { file: "Alpha.plugin.js", code: PLUGIN_A }]);
        assert.equal(await layer.manager.enable("Broken"), false);
        const broken = layer.manager.list().find(p => p.id === "Broken")!;
        assert.deepEqual([broken.state, broken.error], ["failed", "cannot start"]);
        assert.equal(byId.has("bd-broken"), false);
        assert.ok(state.errors.some(e => e.includes("Broken: start")));
        assert.equal(await layer.manager.enable("Alpha"), true);
        layer.dispose();
        delete (globalThis as any).__alphaTarget;
    });

    it("lists a second file with the same name as failed instead of running it", () => {
        const { layer } = fakeLayer([{ file: "A1.plugin.js", code: PLUGIN_A }, { file: "A2.plugin.js", code: PLUGIN_A }]);
        const states = layer.manager.list().map(p => p.state).sort();
        assert.deepEqual(states, ["failed", "off"]);
    });

    it("BdApi.Webpack sees the modules the engine lists", async () => {
        const code = `/** @name Finder */\nmodule.exports = { start() { this.found = BdApi.Webpack.getByKeys("chat"); }, stop() {} };`;
        const { layer } = fakeLayer([{ file: "Finder.plugin.js", code }]);
        await layer.manager.enable("Finder");
        const entry = layer.manager.instances()[0].instance as { found: any; };
        assert.equal(entry.found.chat, true);
    });

    it("the observer of a plugin gets the page's mutations while it is on and is disconnected when it is off", async () => {
        const code = `/** @name Watcher */\nmodule.exports = { seen: 0, start() {}, stop() {}, observer(m) { this.seen += m.n; } };`;
        const { layer, observers } = fakeLayer([{ file: "Watcher.plugin.js", code }]);
        await layer.manager.enable("Watcher");
        observers[0].callback([{ n: 2 }, { n: 3 }]);
        assert.equal((layer.manager.instances()[0].instance as { seen: number; }).seen, 5);
        await layer.manager.disable("Watcher");
        assert.equal(observers[0].disconnected, true);
    });

    it("runs the sample plugin that ships with the build", async () => {
        const code = readFileSync(new URL("../src/betterdiscordplugins/AmiricordSample.plugin.js", import.meta.url), "utf8");
        const { layer, state } = fakeLayer([{ file: "AmiricordSample.plugin.js", code }]);
        const [info] = layer.manager.list();
        assert.equal(info.name, "Amiricord Sample");
        assert.equal(await layer.manager.enable(info.id), true);
        assert.deepEqual(state.toasts, ["Amiricord Sample is on (switched on 1 time)"]);
        await layer.manager.disable(info.id);
    });
});

describe("the settings panel builder", () => {
    class El {
        children: any[] = []; listeners: Record<string, Array<() => void>> = {}; style: Record<string, string> = {};
        className = ""; textContent = ""; value = ""; checked = false; type = ""; name = ""; selected = false; min = ""; max = ""; step = "";
        constructor(readonly tag: string) {}
        append(...nodes: any[]) { this.children.push(...nodes); }
        addEventListener(type: string, fn: () => void) { (this.listeners[type] ??= []).push(fn); }
    }
    const doc = { createElement: (tag: string) => new El(tag) } as unknown as Document;
    const find = (el: any, test: (e: any) => boolean): any => {
        if (test(el)) return el;
        for (const child of el.children ?? []) { const hit = child instanceof El ? find(child, test) : undefined; if (hit) return hit; }
        return undefined;
    };

    it("draws a switch and a category, and tells the plugin what changed with the category's id", () => {
        const changes: unknown[] = [];
        const panel = buildSettingsPanel(doc, {
            settings: [
                { type: "switch", id: "top", name: "Top", value: true },
                { type: "category", id: "cat", name: "Cat", settings: [{ type: "number", id: "n", name: "N", value: 3 }, { type: "dropdown", id: "d", name: "D", value: "b", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }] }
            ],
            onChange: (category, id, value) => changes.push([category, id, value])
        }) as unknown as El;
        const toggle = find(panel, e => e.type === "checkbox");
        toggle.checked = false;
        toggle.listeners.change[0]();
        const number = find(panel, e => e.type === "number");
        number.value = "7";
        number.listeners.input[0]();
        const select = find(panel, e => e.tag === "select");
        select.value = "a";
        select.listeners.change[0]();
        assert.deepEqual(changes, [[null, "top", false], ["cat", "n", 7], ["cat", "d", "a"]]);
    });

    it("a plugin's onChange that throws does not break the panel", () => {
        const panel = buildSettingsPanel(doc, { settings: [{ type: "switch", id: "x", name: "X", value: false }], onChange: () => { throw new Error("no"); } }) as unknown as El;
        const toggle = find(panel, e => e.type === "checkbox");
        assert.doesNotThrow(() => toggle.listeners.change[0]());
    });
});

describe("the build side", () => {
    it("writes the plugin files into a module as JSON, sorted, so nothing in a plugin can break out of the string", () => {
        const source = bundledBdPluginsSource([{ file: "b.plugin.js", code: "x\"; process.exit(); //" }, { file: "a.plugin.js", code: "`${evil}`" }]);
        assert.ok(source.indexOf("a.plugin.js") < source.indexOf("b.plugin.js"));
        assert.ok(source.includes(JSON.stringify("x\"; process.exit(); //")));
        assert.match(source, /^import type \{ BdSourceFile \} from "\.\/manager";/);
    });

    it("the engine view lists the modules that ran", () => {
        const view = new WreqView();
        view.record("12", { a: 1 });
        view.record("13", { b: 2 });
        assert.deepEqual(view.loadedModules(), [{ id: "12", exports: { a: 1 } }, { id: "13", exports: { b: 2 } }]);
    });
});
