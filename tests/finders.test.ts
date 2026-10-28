/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FinderEngine, FinderError, FinderMiss, isBlacklisted, matches, ModuleView } from "../src/webpack/finders";
import { fingerprint, ResolutionCache } from "../src/webpack/resolutionCache";

/** A fake module list. `loaded` holds modules that already ran; `lazy` ones run when asked to load. */
class FakeView implements ModuleView {
    loaded = new Map<string, unknown>();
    lazy = new Map<string, () => unknown>();
    sources = new Map<string, string>();
    runs: string[] = [];

    ids() { return [...this.sources.keys()]; }
    sourceOf(id: string) { return this.sources.get(id); }
    exportsOf(id: string, load: boolean) {
        if (!this.loaded.has(id) && load && this.lazy.has(id)) {
            this.runs.push(id);
            this.loaded.set(id, this.lazy.get(id)!());
        }
        return this.loaded.get(id);
    }
}

function setup(extra: { cache?: ResolutionCache; timeoutMs?: number; } = {}) {
    const view = new FakeView();
    const misses: FinderMiss[] = [];
    const engine = new FinderEngine({ view, onMiss: m => misses.push(m), ...extra });
    return { view, misses, engine };
}

describe("finder matching", () => {
    it("matches by props, store name, code and component", () => {
        assert.equal(matches({ kind: "props", args: ["a", "b"] }, { a: 1, b: 2 }), true);
        assert.equal(matches({ kind: "props", args: ["a", "z"] }, { a: 1 }), false);
        assert.equal(matches({ kind: "props", args: ["a", "!Request"] }, { a: 1 }), true, "a name with ! must be absent");
        assert.equal(matches({ kind: "props", args: ["a", "!Request"] }, { a: 1, Request: 2 }), false);
        assert.equal(matches({ kind: "store", args: ["UserStore"] }, { getName: () => "UserStore" }), true);
        assert.equal(matches({ kind: "store", args: ["UserStore"] }, { getName: () => "Other" }), false);
        assert.equal(matches({ kind: "code", args: ["hello", "world"] }, function () { return "hello world"; }), true);
        assert.equal(matches({ kind: "code", args: ["hello"] }, { not: "a function" }), false);
        assert.equal(matches({ kind: "component", args: ["marker"] }, { $$typeof: Symbol.for("react.memo"), type: function () { return "marker"; } }), true);
    });

    it("does not trip over getters that throw", () => {
        const hostile = { get a(): number { throw new Error("no"); } };
        assert.equal(matches({ kind: "props", args: ["a"] }, hostile), false);
        assert.equal(matches({ kind: "store", args: ["X"] }, { getName() { throw new Error("no"); } }), false);
    });

    it("blacklists globals, buffers, primitives and proxies that answer every key", () => {
        assert.equal(isBlacklisted(globalThis), true);
        assert.equal(isBlacklisted(new Uint8Array(2)), true);
        assert.equal(isBlacklisted(new ArrayBuffer(2)), true);
        assert.equal(isBlacklisted("text"), true);
        assert.equal(isBlacklisted(null), true);
        assert.equal(isBlacklisted(new Proxy({}, { has: () => true, get: () => 1 })), true);
        assert.equal(isBlacklisted({ a: 1 }), false);
        assert.equal(matches({ kind: "props", args: ["anything"] }, new Proxy({}, { has: () => true, get: () => 1 })), false);
    });
});

describe("finding by search", () => {
    it("finds by props in the exports and in a property of them", () => {
        const { view, engine } = setup();
        view.sources.set("1", "src1");
        view.sources.set("2", "src2");
        view.loaded.set("1", { x: 1 });
        view.loaded.set("2", { default: { send: () => 1, edit: () => 2 } });
        const finder = engine.forPlugin("P").byProps<{ send: unknown; }>("send", "edit");
        assert.equal(typeof finder.get()?.send, "function");
    });

    it("finds by code only in modules whose source can match, and runs only those", () => {
        const { view, engine } = setup();
        view.sources.set("1", "function(){unrelated}");
        view.sources.set("2", "function(){needle()}");
        view.lazy.set("1", () => ({ never: true }));
        view.lazy.set("2", () => ({ run: function () { return "needle"; } }));
        const found = engine.forPlugin("P").byCode<() => string>("needle").get();
        assert.equal(found?.(), "needle");
        assert.deepEqual(view.runs, ["2"]);
    });

    it("does not run modules for props finders", () => {
        const { view, engine } = setup();
        view.sources.set("1", "src");
        view.lazy.set("1", () => ({ a: 1 }));
        assert.equal(engine.forPlugin("P").byProps("a").get(), undefined);
        assert.deepEqual(view.runs, []);
    });
});

describe("misses", () => {
    it("records a miss against the plugin, once per finder", () => {
        const { engine, misses } = setup();
        const finder = engine.forPlugin("Alpha").byProps("nothing");
        assert.equal(finder.get(), undefined);
        assert.equal(finder.get(), undefined);
        assert.deepEqual(misses, [{ plugin: "Alpha", description: "props(\"nothing\")", required: false }]);
        engine.forPlugin("Beta").byProps("nothing").get();
        assert.equal(misses.length, 2);
        assert.equal(misses[1].plugin, "Beta");
    });

    it("require throws an error that names the plugin and the finder", () => {
        const { engine } = setup();
        assert.throws(() => engine.forPlugin("Alpha").byStore("Gone").require(), (error: unknown) =>
            error instanceof FinderError && error.plugin === "Alpha" && error.description === "store(\"Gone\")");
    });

    it("marks a miss as required when the plugin asked with require(), and reports it separately from an optional one", () => {
        const { engine, misses } = setup();
        const finder = engine.forPlugin("Alpha").byProps("nothing");
        finder.get();
        assert.throws(() => finder.require(), FinderError);
        assert.deepEqual(misses.map(m => m.required), [false, true]);
    });

    it("keeps working when the miss listener throws", () => {
        const view = new FakeView();
        const engine = new FinderEngine({ view, onMiss: () => { throw new Error("listener"); } });
        assert.equal(engine.forPlugin("P").byProps("x").get(), undefined);
    });
});

describe("ready", () => {
    it("resolves at once when the thing is already there", async () => {
        const { view, engine } = setup();
        view.sources.set("1", "s");
        view.loaded.set("1", { a: 1 });
        assert.deepEqual(await engine.forPlugin("P").byProps("a").ready(), { a: 1 });
    });

    it("resolves when a matching module loads later", async () => {
        const { view, engine, misses } = setup();
        const pending = engine.forPlugin("P").byProps<{ a: number; }>("a").ready();
        view.sources.set("9", "s");
        view.loaded.set("9", { a: 5 });
        engine.notifyLoaded("9");
        assert.equal((await pending).a, 5);
        assert.deepEqual(misses, []);
    });

    it("ignores modules that do not match and gives up after the timeout, recording the miss", async () => {
        const { view, engine, misses } = setup({ timeoutMs: 20 });
        const pending = engine.forPlugin("P").byProps("a").ready();
        view.sources.set("9", "s");
        view.loaded.set("9", { b: 1 });
        engine.notifyLoaded("9");
        await assert.rejects(pending, FinderError);
        assert.equal(misses.length, 1);
    });
});

describe("resolution cache", () => {
    const source = "function(){needle()}";

    function withModule(cache: ResolutionCache) {
        const ctx = setup({ cache });
        ctx.view.sources.set("5", source);
        ctx.view.lazy.set("5", () => ({ run: function () { return "needle"; } }));
        return ctx;
    }

    it("remembers a successful search", () => {
        const cache = new ResolutionCache(1);
        const { engine } = withModule(cache);
        engine.forPlugin("P").byCode("needle").get();
        assert.deepEqual(cache.get("code:[\"needle\"]"), { moduleId: "5", path: "run", fingerprint: fingerprint(source) });
        assert.equal(cache.dirty, true);
    });

    it("goes straight to the remembered module without searching the others", () => {
        const cache = new ResolutionCache(1);
        cache.set("code:[\"needle\"]", { moduleId: "5", path: "run", fingerprint: fingerprint(source) });
        const { view, engine } = withModule(cache);
        view.sources.set("1", "function(){needle()}");
        view.lazy.set("1", () => ({ other: function () { return "needle"; } }));
        const found = engine.forPlugin("P").byCode<() => string>("needle").get();
        assert.equal(found?.(), "needle");
        assert.deepEqual(view.runs, ["5"]);
    });

    it("does not trust an entry whose module source changed, searches again and replaces it", () => {
        const cache = new ResolutionCache(1);
        cache.set("code:[\"needle\"]", { moduleId: "5", path: "run", fingerprint: "old-1" });
        const { view, engine } = withModule(cache);
        view.sources.set("8", "function(){thing()}");
        view.sources.set("5", "function(){changed}");
        view.lazy.set("8", () => ({ run: function () { return "thing"; } }));
        const found = engine.forPlugin("P").byCode<() => string>("thing").get();
        assert.equal(found?.(), "thing");
        // The entry for "needle" is for another key: look it up too, it must be dropped, not trusted.
        assert.equal(engine.forPlugin("P").byCode("needle").get(), undefined);
        assert.equal(cache.get("code:[\"needle\"]"), undefined);
    });

    it("does not trust an entry whose module no longer matches", () => {
        const cache = new ResolutionCache(1);
        cache.set("props:[\"a\"]", { moduleId: "5", path: null, fingerprint: fingerprint(source) });
        const { view, engine } = withModule(cache);
        view.loaded.set("5", { renamed: 1 });
        assert.equal(engine.forPlugin("P").byProps("a").get(), undefined);
        assert.equal(cache.get("props:[\"a\"]"), undefined);
    });
});

describe("things a finder must never return", () => {
    it("ignores a proxy that answers every key through get only, which has and in cannot reveal", () => {
        const catchAll = new Proxy({}, { get: () => 1 });
        assert.equal(isBlacklisted(catchAll), true);
        assert.equal(matches({ kind: "props", args: ["ROOT", "SECTION"] }, catchAll), false);
    });

    it("ignores thenables, because awaiting them would never come back with the object", () => {
        const thenable = { ROOT: 0, SECTION: 1, then() { return undefined; } };
        assert.equal(isBlacklisted(thenable), true);
        assert.equal(isBlacklisted(Promise.resolve(1)), true);
        assert.equal(isBlacklisted({ ROOT: 0, SECTION: 1 }), false);
    });

    it("a finder waiting with ready() is not answered by a thenable that looks right", async () => {
        const { view, engine } = setup({ timeoutMs: 50 });
        const pending = engine.forPlugin("P").byProps("ROOT", "SECTION").ready();
        view.sources.set("1", "s");
        view.loaded.set("1", { Bad: { ROOT: 0, SECTION: 1, then() { return undefined; } } });
        engine.notifyLoaded("1");
        view.sources.set("2", "s");
        view.loaded.set("2", { Z6: { ROOT: 0, SECTION: 1 } });
        engine.notifyLoaded("2");
        assert.deepEqual(await pending, { ROOT: 0, SECTION: 1 });
    });
});

describe("peek", () => {
    it("asks without leaving a miss, and finds the thing once it is there", () => {
        const { view, misses, engine } = setup();
        const finder = engine.forPlugin("P").byProps("answer");
        assert.equal(finder.peek(), undefined);
        assert.equal(finder.peek(), undefined);
        assert.deepEqual(misses, [], "peek never records a miss");

        view.sources.set("1", "x");
        view.loaded.set("1", { answer: 42 });
        assert.deepEqual(finder.peek(), { answer: 42 });
        assert.deepEqual(finder.get(), { answer: 42 });
        assert.deepEqual(misses, []);
    });

    it("leaves get and require recording their misses as before", () => {
        const { misses, engine } = setup();
        const finder = engine.forPlugin("P").byProps("nothing");
        finder.peek();
        finder.get();
        assert.equal(misses.length, 1);
        assert.equal(misses[0].required, false);
    });
});
