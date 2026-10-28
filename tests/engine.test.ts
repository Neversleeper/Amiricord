/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { definePluginSettings } from "../src/api/pluginSettings";
import { Bridge, EngineOptions, EnginePluginContext, PluginCode, startEngine } from "../src/renderer/engine";
import { HealthEvent } from "../src/shared/health";
import { BootInfo } from "../src/shared/ipc";
import { Stage } from "../src/shared/manifest";
import { PROJECT_VERSION } from "../src/shared/project";

const STACK = "Error\n at https://canary.discord.com/assets/web.abc123.js:1:1";

const plugin = (id: string, extra: Partial<{ startAt: Stage; core: boolean; enabledByDefault: boolean; dependencies: string[]; hasPatches: boolean; }> = {}) =>
    ({ id, core: false, enabledByDefault: true, dependencies: [], startAt: "webpackReady" as Stage, deferrable: false, ...extra });

const quiet: BootInfo = { safeMode: false, safeModeReason: null, quarantine: [], enteredSafeMode: false, problems: [], devMode: false, settings: { schema: 1, plugins: {} } };

/** A function standing for `__webpack_require__` with the text the main-instance signals look for. */
function makeWreq(target: object, modules: Record<string, unknown>, exposeCache = true) {
    // Discord's bundler keeps its module cache private; with `exposeCache` false so does this imitation.
    const cache: Record<string, { exports: unknown; tag?: string; }> = {};
    const wreq = function (id: string) {
        const hit = cache[id];
        if (hit) return hit.exports;
        const module = (cache[id] = { exports: {}, tag: "exports:{}" });
        (wreq.m[id] as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, wreq);
        return module.exports;
    } as unknown as ((id: string) => unknown) & { m: Record<string, unknown>; c?: Record<string, { exports: unknown; tag?: string; }>; u: unknown; p: unknown; };
    Object.setPrototypeOf(wreq, target);
    if (exposeCache) wreq.c = cache;
    wreq.m = modules;
    wreq.u = (e: string) => "" + e + ".js";
    wreq.p = "/assets/";
    return wreq;
}

// eslint-disable-next-line no-new-func -- the tests build module factories from text, as Discord's are
const factory = (body: string) => new Function("e", "t", "r", body);

function setup(plugins: ReturnType<typeof plugin>[], codes: Record<string, PluginCode | Error>, extra: Partial<EngineOptions> & { boot?: Partial<BootInfo>; firewall?: () => Promise<unknown>; native?: (message: unknown) => Promise<unknown>; secret?: (message: unknown) => Promise<unknown>; privacy?: () => Promise<unknown>; testProvider?: (id: string) => Promise<unknown>; changePrivacy?: (change: unknown) => Promise<unknown>; blockLog?: () => Promise<unknown>; } = {}) {
    const events: HealthEvent[] = [];
    let cleanBoots = 0;
    const dumps: Array<{ name: string; text: string; }> = [];
    const changes: unknown[] = [];
    let restarts = 0;
    let folderOpens = 0;
    const bridge: Bridge = {
        bootInfo: { ...quiet, ...extra.boot },
        sendHealth: e => { events.push(e); },
        cleanBoot: () => { cleanBoots++; },
        changeSetting: change => { changes.push(change); },
        devDump: (name, text) => { dumps.push({ name, text }); },
        restart: () => { restarts++; },
        openDataFolder: () => { folderOpens++; },
        ...(extra.firewall ? { firewallStatus: extra.firewall } : {}),
        ...(extra.native ? { native: extra.native } : {}),
        ...(extra.secret ? { secret: extra.secret } : {}),
        ...(extra.privacy ? { privacyStatus: extra.privacy } : {}),
        ...(extra.testProvider ? { testProvider: extra.testProvider } : {}),
        ...(extra.changePrivacy ? { changePrivacy: extra.changePrivacy } : {}),
        ...(extra.blockLog ? { blockLog: extra.blockLog } : {})
    };
    const loaded: string[] = [];
    const hookTarget = Object.create(Function.prototype) as object;
    const globalObject = {};
    let domGo: () => void = () => { throw new Error("whenDomReady was not asked"); };
    const delayed: Array<() => void> = [];

    const engine = startEngine({
        bridge,
        registry: { plugins, startOrder: plugins.map(p => p.id) },
        choices: {},
        loadPlugin: id => {
            loaded.push(id);
            const code = codes[id] ?? {};
            if (code instanceof Error) throw code;
            return code;
        },
        hookTarget,
        getStack: () => STACK,
        globalObject,
        whenDomReady: cb => { domGo = cb; },
        later: work => { delayed.push(work); },
        lifecycle: { yieldToEventLoop: async () => { /* no waiting in tests */ } },
        ...extra
    });

    return {
        engine, events, loaded, hookTarget, globalObject, delayed, dumps, changes,
        cleanBoots: () => cleanBoots,
        restarts: () => restarts,
        folderOpens: () => folderOpens,
        boot: (modules: Record<string, unknown> = {}, exposeCache = true) => makeWreq(hookTarget, modules, exposeCache),
        dom: () => domGo()
    };
}

const typesOf = (events: HealthEvent[], type: HealthEvent["type"]) => events.filter(e => e.type === type);

describe("which plugins run", () => {
    it("loads and registers only the plugins that run, and says which they are", () => {
        const { engine, loaded, events } = setup(
            [plugin("A"), plugin("B"), plugin("Q"), plugin("Off", { enabledByDefault: false })],
            {},
            { boot: { quarantine: ["Q"] } }
        );
        assert.deepEqual(engine.enabled, ["A", "B"]);
        assert.deepEqual(loaded, ["A", "B"]);
        assert.deepEqual(typesOf(events, "enabled"), [{ type: "enabled", plugins: ["A", "B"] }]);
    });

    it("keeps the patches of a quarantined plugin out of the registry", () => {
        const patch = { find: "marker", replacements: [{ match: "marker", replace: "x" }] };
        const { engine } = setup([plugin("Q")], { Q: { patches: [patch] } }, { boot: { quarantine: ["Q"] } });
        assert.equal(engine.patches.hasPending(), false);
    });

    it("runs only core plugins in safe mode", () => {
        const { engine } = setup([plugin("A"), plugin("Core", { core: true })], {}, { boot: { safeMode: true } });
        assert.deepEqual(engine.enabled, ["Core"]);
    });
});

describe("starting in stages", () => {
    it("starts each plugin at its own stage, in order, waiting for Webpack and the DOM", async () => {
        const log: string[] = [];
        const mark = (name: string): PluginCode => ({ start() { log.push(name); } });
        const t = setup(
            [plugin("I", { startAt: "init" }), plugin("W"), plugin("D", { startAt: "domReady" })],
            { I: mark("I"), W: mark("W"), D: mark("D") }
        );
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepEqual(log, ["I"]);

        t.boot();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.deepEqual(log, ["I", "W"]);

        t.dom();
        await t.engine.done;
        assert.deepEqual(log, ["I", "W", "D"]);
        assert.deepEqual(typesOf(t.events, "started").map(e => (e as { plugin: string; }).plugin), ["I", "W", "D"]);
    });

    it("reports a plugin whose start throws and goes on with the others", async () => {
        const log: string[] = [];
        const t = setup([plugin("Bad"), plugin("Good")], {
            Bad: { start() { throw new Error("boom"); } },
            Good: { start() { log.push("Good"); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(log, ["Good"]);
        assert.deepEqual(typesOf(t.events, "start-failed"), [{ type: "start-failed", plugin: "Bad", error: "Error: boom" }]);
    });

    it("counts a plugin whose code cannot be loaded as a start failure", async () => {
        const t = setup([plugin("Lost"), plugin("Good")], { Lost: new Error("no code") });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(typesOf(t.events, "start-failed"), [{ type: "start-failed", plugin: "Lost", error: "Error: no code" }]);
        assert.equal(t.engine.lifecycle.stateOf("Good"), "started");
    });

    it("does not break when the bridge throws", async () => {
        const t = setup([plugin("A")], {}, {
            bridge: { bootInfo: quiet, sendHealth: () => { throw new Error("bridge down"); }, cleanBoot: () => { /* nothing */ }, changeSetting: () => { /* nothing */ }, restart: () => { /* nothing */ }, openDataFolder: () => { /* nothing */ } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(t.engine.lifecycle.stateOf("A"), "started");
    });
});

describe("patches through Webpack", () => {
    const patch = { find: "t.value=1", replacements: [{ match: "t.value=1", replace: "t.value=2" }] };

    it("patches a module that loads after the hook and reports the outcome", async () => {
        const t = setup([plugin("P")], { P: { patches: [patch] } });
        const wreq = t.boot({ 1: factory("t.value=1") });
        t.dom();
        await t.engine.done;

        assert.equal((wreq(("1")) as { value: number; }).value, 2);
        const patchEvents = typesOf(t.events, "patch") as Array<Extract<HealthEvent, { type: "patch"; }>>;
        assert.equal(patchEvents.length, 1);
        assert.equal(patchEvents[0].plugin, "P");
        assert.equal(patchEvents[0].status, "applied");
    });

    it("reports a plugin whose patched module throws, and the page still works", async () => {
        const bad = { find: "t.value=1", replacements: [{ match: "t.value=1", replace: "t.value=1;throw new Error('late')" }] };
        const t = setup([plugin("P")], { P: { patches: [bad] } });
        const wreq = t.boot({ 1: factory("t.value=1") });
        assert.throws(() => wreq("1"), /late/);
        const errors = typesOf(t.events, "runtime-error") as Array<Extract<HealthEvent, { type: "runtime-error"; }>>;
        assert.equal(errors[0].plugin, "P");
        assert.match(errors[0].source, /module 1/);
    });

    it("reports patches that found no module, then a clean boot, after the delay", async () => {
        const never = { find: "never present", replacements: [{ match: "x", replace: "y" }] };
        const t = setup([plugin("P")], { P: { patches: [never] } });
        t.boot({ 1: factory("t.value=1") });
        t.dom();
        await t.engine.done;
        assert.equal(t.cleanBoots(), 0, "not clean before the delay");
        assert.equal(t.delayed.length, 1);
        t.delayed[0]();
        assert.deepEqual(typesOf(t.events, "patch-no-module"), [{ type: "patch-no-module", plugin: "P", find: "never present", required: true }]);
        assert.equal(t.cleanBoots(), 1);
    });

    it("does not call a lazy patch missing at start, since its module loads only when a screen opens, and still applies it when the module comes", async () => {
        const lazy = { find: "opens later", lazy: true, replacements: [{ match: "value=1", replace: "value=2" }] };
        const never = { find: "never present", replacements: [{ match: "x", replace: "y" }] };
        const t = setup([plugin("P")], { P: { patches: [lazy, never] } });
        const wreq = t.boot({ 1: factory("t.value=1"), 2: factory("/*opens later*/t.value=1") });
        t.dom();
        await t.engine.done;
        t.delayed[0]();
        // Only the ordinary patch is called missing.
        assert.deepEqual(typesOf(t.events, "patch-no-module").map(e => (e as { find: string; }).find), ["never present"]);
        // The module appears later, as Discord's settings code does: the patch applies.
        const exports = wreq("2") as { value?: number; };
        assert.equal(exports.value, 2);
        assert.equal(typesOf(t.events, "patch").some(e => (e as { find: string; status: string; }).find === "opens later" && (e as { status: string; }).status === "applied"), true);
    });

    it("leaves bundles that are not the web app alone", async () => {
        const t = setup([plugin("P")], { P: { patches: [patch] } }, { getStack: () => "Error\n at https://canary.discord.com/assets/sentry.abc.js:1:1" });
        const modules = { 1: factory("t.value=1") };
        const wreq = t.boot(modules);
        assert.equal(wreq.m, modules);
        assert.equal(typesOf(t.events, "patch").length, 0);
    });
});

describe("finders and the global entry", () => {
    it("gives each plugin finders that report misses against that plugin", async () => {
        const t = setup([plugin("Looker")], {
            Looker: { start(ctx) { ctx.finders.byProps("nothingHere").get(); ctx.finders.byStore("Gone").ready().catch(() => { /* gave up */ }); } }
        }, { });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(typesOf(t.events, "finder-miss"), [{ type: "finder-miss", plugin: "Looker", finder: "props(\"nothingHere\")", required: false }]);
    });

    it("gives each plugin Discord's stores by name through ctx.common, and records a miss against that plugin", async () => {
        let user: unknown;
        const t = setup([plugin("Named")], {
            Named: { start(ctx) { user = ctx.common.UserStore.get()?.getCurrentUser(); ctx.common.GuildStore.get(); } }
        });
        const wreq = t.boot({ 1: factory("t.getName=function(){return 'UserStore'};t.getCurrentUser=function(){return {id:'7'}}") });
        wreq("1");
        t.dom();
        await t.engine.done;
        assert.deepEqual(user, { id: "7" });
        assert.deepEqual(typesOf(t.events, "finder-miss"), [{ type: "finder-miss", plugin: "Named", finder: "store(\"GuildStore\")", required: false }]);
    });

    it("gives each plugin ctx.native, which sends its own id, the function and the arguments to the main process and hands back the value", async () => {
        const sent: unknown[] = [];
        const answers: unknown[] = [];
        const t = setup([plugin("Caller"), plugin("Other")], {
            Caller: { async start(ctx) { answers.push(await ctx.native.call("search", "cats", 2)); } },
            Other: { async start(ctx) { answers.push(await ctx.native.call("ping")); } }
        }, { native: async message => { sent.push(message); return { ok: true, value: "answer" }; } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(sent, [{ plugin: "Caller", fn: "search", args: ["cats", 2] }, { plugin: "Other", fn: "ping", args: [] }]);
        assert.deepEqual(answers, ["answer", "answer"]);
    });

    it("fails a native call, and only that call, when the main process says no or the bridge has no native channel", async () => {
        const failures: string[] = [];
        const t = setup([plugin("Refused"), plugin("Lonely")], {
            Refused: { async start(ctx) { await ctx.native.call("x").catch(error => failures.push(String(error.message))); } },
            Lonely: { async start(ctx) { await ctx.native.call("x").catch(error => failures.push(String(error.message))); } }
        }, { native: async message => ((message as { plugin: string; }).plugin === "Refused" ? { ok: false, error: "Refused: no native code is running for this plugin." } : { ok: true, value: 1 }) });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(failures, ["Refused: no native code is running for this plugin."]);

        const bare = setup([plugin("Bare")], { Bare: { async start(ctx) { await ctx.native.call("x").catch(error => failures.push(String(error.message))); } } });
        bare.boot();
        bare.dom();
        await bare.engine.done;
        assert.match(failures[1], /Bare: the main process is not reachable/);
        assert.equal(typesOf(bare.events, "start-failed").length, 0, "the plugin handled it");
    });

    it("gives each plugin ctx.secrets that sends its own id and can never read a value back", async () => {
        const sent: unknown[] = [];
        const results: unknown[] = [];
        const t = setup([plugin("Keeper"), plugin("Other")], {
            Keeper: { async start(ctx) { await ctx.secrets.set("cookie", "sess=1"); results.push(await ctx.secrets.has("cookie")); await ctx.secrets.clear("cookie"); } },
            Other: { async start(ctx) { results.push(await ctx.secrets.has("cookie").catch(() => "refused")); } }
        }, { secret: async message => { sent.push(message); return (message as { plugin: string; }).plugin === "Other" ? { ok: false, error: "no" } : { ok: true, value: true }; } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(sent, [
            { action: "set", plugin: "Keeper", name: "cookie", value: "sess=1" },
            { action: "has", plugin: "Keeper", name: "cookie" },
            { action: "clear", plugin: "Keeper", name: "cookie" },
            { action: "has", plugin: "Other", name: "cookie" }
        ]);
        assert.deepEqual(results, [true, "refused"]);
    });

    it("fails a secret call, and only that call, when the bridge has no secret channel", async () => {
        const failures: string[] = [];
        const t = setup([plugin("Bare")], { Bare: { async start(ctx) { await ctx.secrets.has("cookie").catch(error => failures.push(String(error.message))); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.match(failures[0], /Bare: the main process is not reachable/);
        assert.equal(typesOf(t.events, "start-failed").length, 0);
    });

    it("gives plugins ctx.menuItems and ctx.toasts that do nothing, and do not fail, when there is no page", async () => {
        const seen: string[] = [];
        const t = setup([plugin("Menu")], {
            Menu: {
                start(ctx) {
                    ctx.menuItems.add("x", () => null);
                    ctx.toasts.show("hello");
                    seen.push(typeof ctx.menuItems.add, typeof ctx.toasts.show);
                }
            }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(seen, ["function", "function"]);
        assert.equal(typesOf(t.events, "start-failed").length, 0);
    });

    it("gives each plugin ctx.storage under its own name, and a clear error when the page has no database", async () => {
        const data = new Map<string, string>();
        const backend = {
            get: async (key: string) => data.get(key),
            set: async (key: string, text: string) => { data.set(key, text); },
            delete: async (key: string) => { data.delete(key); },
            keys: async () => [...data.keys()]
        };
        const seen: unknown[] = [];
        const t = setup([plugin("One"), plugin("Two")], {
            One: { async start(ctx) { await ctx.storage.set("list", [1, 2]); seen.push(await ctx.storage.keys()); } },
            Two: { async start(ctx) { seen.push(await ctx.storage.get("list")); } }
        }, { storage: backend });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual([...data.keys()], ["One/list"]);
        assert.deepEqual(seen, [["list"], undefined]);

        const failures: string[] = [];
        const bare = setup([plugin("NoDb")], { NoDb: { async start(ctx) { await ctx.storage.get("x").catch(error => failures.push(String(error.message))); } } });
        bare.boot();
        bare.dom();
        await bare.engine.done;
        assert.deepEqual(failures, ["NoDb: storage is not available in this page"]);
    });

    it("lets plugins find what Discord has already loaded", async () => {
        let found: unknown;
        const t = setup([plugin("Looker")], { Looker: { start(ctx) { found = ctx.finders.byProps<{ send: unknown; }>("send").get()?.send; } } });
        const wreq = t.boot({ 1: factory("t.send=1") });
        wreq("1");
        t.dom();
        await t.engine.done;
        assert.equal(found, 1);
    });

    it("defines one hidden global entry that only looks a plugin up", () => {
        const code: PluginCode = {};
        const t = setup([plugin("A")], { A: code });
        const descriptor = Object.getOwnPropertyDescriptor(t.globalObject, "Amiricord");
        assert.equal(descriptor?.enumerable, false);
        assert.equal(descriptor?.writable, false);
        assert.equal(descriptor?.configurable, false);
        const entry = (t.globalObject as { Amiricord: { plugin(id: string): unknown; }; }).Amiricord;
        assert.equal(entry.plugin("A"), code);
        assert.equal(entry.plugin("Unknown"), undefined);
        assert.deepEqual(Object.keys(entry), ["plugin"]);
        assert.ok(Object.isFrozen(entry));
    });

    it("reports a problem, not an exception, when the global entry already exists", () => {
        const globalObject = {};
        setup([plugin("A")], {}, { globalObject });
        const second = setup([plugin("A")], {}, { globalObject });
        assert.ok(second.engine.problems.some(p => p.includes("global entry")));
    });
});

describe("the settings probe", () => {
    it("does not run, and writes nothing, when dev mode is off", async () => {
        const t = setup([plugin("A")], {}, { probeWaitMs: 20 });
        t.boot();
        t.dom();
        await t.engine.done;
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.deepEqual(t.dumps, []);
    });

    it("starts in dev mode and says what it could not find when Discord has no settings code", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot();
        t.dom();
        await t.engine.done;
        await new Promise(resolve => setTimeout(resolve, 80));
        const reports = t.dumps.filter(d => d.name === "settings-probe");
        assert.equal(reports.length, 1);
        assert.equal(JSON.parse(reports[0].text).status, "enum-not-found");
        assert.ok(t.dumps.some(d => d.name.startsWith("settings-probe-step")));
    });
});

describe("a bundler that hides its module cache (as Discord's does)", () => {
    it("lets plugins find what already ran, and waits for what runs later", async () => {
        let early: unknown;
        let late: unknown;
        const t = setup([plugin("Looker")], {
            Looker: {
                start(ctx) {
                    early = ctx.finders.byProps<{ send: unknown; }>("send").get()?.send;
                    void ctx.finders.byProps<{ later: unknown; }>("later").ready().then(value => { late = value.later; });
                }
            }
        });
        const wreq = t.boot({ 1: factory("t.send=1"), 2: factory("t.later=2") }, false);
        assert.equal("c" in wreq, false, "the cache is really hidden");
        wreq("1");
        t.dom();
        await t.engine.done;
        assert.equal(early, 1);
        wreq("2");
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(late, 2);
    });
});

describe("waiting before Webpack exists", () => {
    it("answers a finder that started waiting at the very beginning when its module loads later", async () => {
        let found: unknown;
        const t = setup([plugin("Early", { startAt: "init" })], {
            Early: { start(ctx) { void ctx.finders.byProps<{ enumValue: unknown; }>("enumValue").ready().then(value => { found = value.enumValue; }); } }
        });
        await new Promise(resolve => setTimeout(resolve, 5));
        const wreq = t.boot({ 1: factory("t.enumValue=7") });
        wreq("1");
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(found, 7);
    });
});

describe("the dev-mode source search", () => {
    it("finds a text in the source of a module factory and writes where, with a little code around it", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot({ 7: factory("var marker='billing_section'; t.x=1") });
        t.dom();
        await t.engine.done;
        // The debug rounds run after a short delay; the test's `later` keeps them until asked.
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search");
        assert.ok(search, "a module-search dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits.billing_section.length, 1);
        assert.equal(hits.billing_section[0].id, "7");
        assert.match(hits.billing_section[0].snippet, /billing_section/);
        assert.deepEqual(hits["[SettingsDirectory]"], []);
    });

    it("also looks for where Discord builds its analytics, metrics and mod detection, in a file of its own", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot({
            8: factory("var a='analyticsTrackingStoreMaker'; t.x=1"),
            9: factory("var m=x.METRICS_V2; this._intervalId=setInterval(f,1); var user='someone@example.com'")
        });
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search-notrack");
        assert.ok(search, "a module-search-notrack dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits.analyticsTrackingStoreMaker[0].id, "8");
        assert.equal(hits[".METRICS_V2"][0].id, "9");
        assert.deepEqual(hits.has_client_mods, []);
        assert.ok(!search.text.includes("someone@example.com"), "what is written is redacted");
        assert.equal(t.dumps.some(d => d.name === "module-search"), false, "the settings search has its own file and found nothing here");
    });

    it("also looks for where Discord opens and closes its modals, in a file of its own", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot({
            5: factory("function o(e,t){return {modalKey:t.modalKey,onCloseRequest:null!=t.onCloseRequest?1:2}}; var token='a@b.example'"),
            6: factory("function c(k){var m=get(k);m.onCloseCallback&&m.onCloseCallback()}")
        });
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search-modals");
        assert.ok(search, "a module-search-modals dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits["modalKey:"][0].id, "5");
        assert.equal(hits["onCloseRequest:null!="][0].id, "5");
        assert.equal(hits["onCloseCallback&&"][0].id, "6");
        assert.equal(hits[".onCloseCallback()"][0].id, "6");
        assert.deepEqual(hits.MODAL_PUSH, []);
        assert.ok(!search.text.includes("a@b.example"), "what is written is redacted");
    });

    it("also looks for where Discord keeps the names and files of its sounds, in a file of its own", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot({
            3: factory("var s={discodo:'discodo.mp3',message1:'message1.mp3'}; var user='a@b.example'"),
            4: factory("var b='bop_message1'; var f='x.mp3'")
        });
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search-sounds");
        assert.ok(search, "a module-search-sounds dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits.discodo[0].id, "3");
        assert.equal(hits.message1[0].id, "3");
        assert.equal(hits.bop_message1[0].id, "4");
        assert.equal(hits[".mp3"].length, 2);
        assert.ok(!search.text.includes("a@b.example"), "what is written is redacted");
    });

    it("also looks for Discord's window piece and its focus lock, in a file of its own", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot({
            3: factory('var r={role:"dialog","aria-modal":true,returnFocus:1}; var user="a@b.example"'),
            4: factory("var l='FocusLock'; document.addEventListener('focusin',f)")
        });
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search-modal-parts");
        assert.ok(search, "a module-search-modal-parts dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits['"aria-modal":'][0].id, "3");
        assert.equal(hits.returnFocus[0].id, "3");
        assert.equal(hits.FocusLock[0].id, "4");
        assert.equal(hits.focusin[0].id, "4");
        assert.deepEqual(hits.tabbable, []);
        assert.ok(!search.text.includes("a@b.example"), "what is written is redacted");
    });

    it("also writes the whole source of small modules that carry Discord's dialog box, in a file of its own", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        t.boot({ 3: factory('t.d={A:1}; var x={"data-dialog":"modal"}; var user="a@b.example"; var tail="THE-END"') });
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search-dialog");
        assert.ok(search, "a module-search-dialog dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits['"data-dialog":"modal"'][0].id, "3");
        assert.ok(hits['"data-dialog":"modal"'][0].snippet.includes("THE-END"), "a long context reaches the end of a small module");
        assert.ok(!search.text.includes("a@b.example"), "what is written is redacted");
    });

    it("looks for the Quests strings, says for each hit whether its module has already run, and writes the file even when nothing is found", async () => {
        const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        const wreq = t.boot({
            3: factory('var x="QUEST_HOME)},[]),"; var user="a@b.example"'),
            4: factory('var y=".ALL)}):("; var z="questNameHeadingId"')
        });
        wreq("3");
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        const search = t.dumps.find(d => d.name === "module-search-quests");
        assert.ok(search, "a module-search-quests dump was written");
        const hits = JSON.parse(search.text).hits;
        assert.equal(hits["QUEST_HOME)},[]),"][0].id, "3");
        assert.equal(hits["QUEST_HOME)},[]),"][0].loaded, true, "module 3 ran");
        assert.equal(hits[".ALL)}):("][0].id, "4");
        assert.equal(hits[".ALL)}):("][0].loaded, false, "module 4 is registered but has not run");
        assert.equal(hits.questNameHeadingId[0].loaded, false);
        assert.ok(!search.text.includes("a@b.example"), "what is written is redacted");

        const empty = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
        empty.boot({ 1: factory("t.value=1") });
        empty.dom();
        await empty.engine.done;
        empty.delayed.splice(0).forEach(work => work());
        const none = empty.dumps.find(d => d.name === "module-search-quests");
        assert.ok(none, "written with no hit too, so that absence can be read");
        assert.deepEqual(JSON.parse(none.text).hits, { "QUEST_HOME)},[]),": [], ".ALL)}):(": [], questNameHeadingId: [] });
    });

    it("writes nothing when dev mode is off", async () => {
        const t = setup([plugin("A")], {}, { probeWaitMs: 20 });
        t.boot({ 7: factory("var marker='billing_section'; var a='analyticsTrackingStoreMaker'") });
        t.dom();
        await t.engine.done;
        t.delayed.splice(0).forEach(work => work());
        assert.equal(t.dumps.some(d => d.name === "module-search"), false);
        assert.equal(t.dumps.some(d => d.name === "module-search-notrack"), false);
        assert.equal(t.dumps.some(d => d.name === "module-search-modals"), false);
        assert.equal(t.dumps.some(d => d.name === "module-search-sounds"), false);
        assert.equal(t.dumps.some(d => d.name === "module-search-modal-parts"), false);
        assert.equal(t.dumps.some(d => d.name === "module-search-dialog"), false);
        assert.equal(t.dumps.some(d => d.name === "module-search-quests"), false);
    });
});

describe("the Discord build number", () => {
    const patch = (discord: { minBuild?: number; maxBuild?: number; }) => ({ find: "t.value=1", replacements: [{ match: "t.value=1", replace: "t.value=2" }], discord });
    const builds = (events: HealthEvent[]) => events.filter(e => e.type === "discord-build").map(e => (e as { build: number | null; }).build);

    it("is read from the page when Webpack is found, and told to the health report", () => {
        const t = setup([plugin("P")], {}, { clientGlobal: { GLOBAL_ENV: { BUILD_NUMBER: "650101" } } });
        assert.deepEqual(builds(t.events), [null]);
        t.boot();
        assert.deepEqual(builds(t.events), [null, 650101]);
    });

    it("decides which patches apply: a range that contains the build is used, one that does not is skipped", () => {
        const inRange = setup([plugin("P")], { P: { patches: [patch({ minBuild: 650000, maxBuild: 651000 })] } }, { clientGlobal: { GLOBAL_ENV: { BUILD_NUMBER: "650101" } } });
        assert.equal((inRange.boot({ 1: factory("t.value=1") })("1") as { value: number; }).value, 2);

        const outOfRange = setup([plugin("P")], { P: { patches: [patch({ minBuild: 700000 })] } }, { clientGlobal: { GLOBAL_ENV: { BUILD_NUMBER: "650101" } } });
        assert.equal((outOfRange.boot({ 1: factory("t.value=1") })("1") as { value: number; }).value, 1);
    });

    it("an unknown build ignores ranges (the patch is tried), and a build given by the caller wins over the page", () => {
        const unknown = setup([plugin("P")], { P: { patches: [patch({ minBuild: 700000 })] } }, { clientGlobal: {} });
        assert.equal((unknown.boot({ 1: factory("t.value=1") })("1") as { value: number; }).value, 2);
        assert.deepEqual(builds(unknown.events), [null]);

        const given = setup([plugin("P")], {}, { build: 123, clientGlobal: { GLOBAL_ENV: { BUILD_NUMBER: "650101" } } });
        given.boot();
        assert.deepEqual(builds(given.events), [123]);
    });
});

describe("plugin settings in the engine", () => {
    const declare = () => definePluginSettings({ size: { type: "number", default: 5, min: 1, max: 10, description: "A size" } });

    it("attaches the declared settings to the plugin before it starts, with the owner's saved values", async () => {
        const settings = declare();
        let seen: number | undefined;
        const t = setup([plugin("P")], { P: { settings, start() { seen = settings.store.size; } } }, {
            boot: { settings: { schema: 1, plugins: { P: { values: { size: 8 } } } } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(settings.pluginId, "P");
        assert.equal(seen, 8);
    });

    it("sends a change made by the plugin to the main process, as the checked change", async () => {
        const settings = declare();
        const t = setup([plugin("P")], { P: { settings, start() { settings.store.size = 2; } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(t.changes, [{ type: "plugin-setting", plugin: "P", key: "size", value: 2 }]);
    });

    it("lets only core plugins see every plugin's settings", async () => {
        const seen: Record<string, boolean> = {};
        const t = setup([plugin("Plain"), plugin("Core", { core: true })], {
            Plain: { start(ctx) { seen.Plain = ctx.settingsAdmin !== undefined; } },
            Core: { start(ctx) { seen.Core = ctx.settingsAdmin !== undefined; } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(seen, { Plain: false, Core: true });
    });

    it("counts a plugin whose settings cannot be attached as a start failure and goes on with the others", async () => {
        const shared = declare();
        const t = setup([plugin("First"), plugin("Second"), plugin("Third")], { First: { settings: shared }, Second: { settings: shared }, Third: {} });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(t.engine.lifecycle.stateOf("First"), "started");
        assert.equal(t.engine.lifecycle.stateOf("Second"), "failed");
        assert.equal(t.engine.lifecycle.stateOf("Third"), "started");
        assert.match((typesOf(t.events, "start-failed")[0] as { error: string; }).error, /already attached/);
    });

    it("counts a plugin whose declaration is wrong as a start failure", async () => {
        const t = setup([plugin("Bad")], { Bad: new Error("size: the default must be at most 10") });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(t.engine.lifecycle.stateOf("Bad"), "failed");
    });
});

describe("the components probe in the engine", () => {
    /** Run `work` with a fake page document in place, and take it away afterwards. */
    async function withDocument(document: unknown, work: () => Promise<void>) {
        const holder = globalThis as { document?: unknown; };
        const before = holder.document;
        holder.document = document;
        try {
            await work();
        } finally {
            if (before === undefined) delete holder.document; else holder.document = before;
        }
    }

    const page = (switches: number) => ({
        querySelectorAll: (selector: string) => {
            if (selector === "[data-settings-sidebar-item]") return [{ getAttribute: () => "account_panel" }];
            if (selector === "[role=\"switch\"]") return Array.from({ length: switches }, () => ({ tagName: "DIV", className: "toggle", getAttribute: () => "switch" }));
            return [];
        },
        styleSheets: []
    });

    it("writes the building blocks on screen once Settings is open, and keeps the fullest picture", async () => {
        await withDocument(page(3), async () => {
            const t = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
            t.boot();
            t.dom();
            await t.engine.done;
            t.delayed.splice(0).forEach(work => work());
            const first = t.dumps.filter(d => d.name === "components");
            assert.equal(first.length, 1);
            assert.equal(JSON.parse(first[0].text).dom.switch.count, 3);

            // A later, emptier screen must not replace the fuller one.
            (globalThis as { document?: unknown; }).document = page(1);
            t.delayed.splice(0).forEach(work => work());
            assert.equal(t.dumps.filter(d => d.name === "components").length, 1);
        });
    });

    it("writes nothing when Settings is not open, or when dev mode is off", async () => {
        await withDocument({ querySelectorAll: () => [], styleSheets: [] }, async () => {
            const closed = setup([plugin("A")], {}, { boot: { devMode: true }, probeWaitMs: 20 });
            closed.boot();
            closed.dom();
            await closed.engine.done;
            closed.delayed.splice(0).forEach(work => work());
            assert.equal(closed.dumps.some(d => d.name === "components"), false);
        });
        await withDocument(page(2), async () => {
            const off = setup([plugin("A")], {}, { probeWaitMs: 20 });
            off.boot();
            off.dom();
            await off.engine.done;
            off.delayed.splice(0).forEach(work => work());
            assert.equal(off.dumps.some(d => d.name === "components"), false);
        });
    });
});

describe("styles and JSX for plugins in the engine", () => {
    /** A style host that is a list of live elements. */
    function fakeHost() {
        const live: Array<{ id: string; textContent: string | null; remove(): void; }> = [];
        let created = 0;
        return {
            live,
            created: () => created,
            host: {
                create: () => { created++; const e = { id: "", textContent: null as string | null, remove: () => { live.splice(live.indexOf(e), 1); } }; return e; },
                attach: (e: (typeof live)[number]) => { live.push(e); }
            }
        };
    }

    it("gives each plugin an addStyle whose styles are removed when the plugin stops", async () => {
        const page = fakeHost();
        const t = setup([plugin("P"), plugin("Q")], {
            P: { start(ctx) { ctx.addStyle(".p{color:red}", "main"); } },
            Q: { start(ctx) { ctx.addStyle(".q{color:blue}"); } }
        }, { styleHost: page.host });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(page.live.length, 2);
        assert.equal(await t.engine.lifecycle.stopPlugin("P"), true);
        assert.deepEqual(page.live.map(e => e.textContent), [".q{color:blue}"]);
    });

    /** A module with what the finder for React looks for. */
    const reactModule = factory("t.useState=function(){};t.useEffect=function(){};t.createElement=function(type,props){return {type:type,props:props}};t.useSyncExternalStore=function(){}");

    it("gives plugins ctx.components: ours when Discord's was not found, the CSS added once and only when one is asked for, and the miss told once", async () => {
        const page = fakeHost();
        const seen: unknown[] = [];
        const t = setup([plugin("Ui"), plugin("Idle")], {
            Ui: { start(ctx) { seen.push(typeof ctx.components.ModalRoot.get(), ctx.components.ModalRoot.usingFallback(), typeof ctx.components.ModalFooter.get(), typeof ctx.components.Button.get()); ctx.components.ModalRoot.get(); } },
            Idle: { start(ctx) { void ctx.id; } }
        }, { styleHost: page.host });
        t.boot({ 1: reactModule })("1");
        assert.equal(page.live.length, 0, "nothing is added before a component is asked for");
        t.dom();
        await t.engine.done;
        assert.deepEqual(seen, ["function", true, "function", "function"]);
        assert.equal(page.live.length, 1, "the fallbacks' CSS went in once");
        assert.equal(page.created(), 1, "and was built once, however many components were asked for");
        assert.match(page.live[0].textContent ?? "", /.amiricord-modal-backdrop/);
        const misses = (typesOf(t.events, "finder-miss") as Array<{ plugin: string; finder: string; required: boolean; }>).filter(miss => miss.plugin === "common");
        assert.deepEqual(misses.filter(miss => miss.finder === "component ModalRoot"), [{ type: "finder-miss", plugin: "common", finder: "component ModalRoot", required: false }]);
    });

    it("adds no CSS at all when no plugin asks for a component", async () => {
        const page = fakeHost();
        const t = setup([plugin("Idle")], { Idle: { start() { /* nothing */ } } }, { styleHost: page.host });
        t.boot({ 1: reactModule })("1");
        t.dom();
        await t.engine.done;
        assert.equal(page.live.length, 0);
    });

    it("gives no component yet, and adds the CSS only once, when React has not shown up", async () => {
        const page = fakeHost();
        const seen: unknown[] = [];
        const t = setup([plugin("Early")], { Early: { start(ctx) { seen.push(ctx.components.ModalRoot.get(), ctx.components.react.get(), ctx.components.Button.get()); } } }, { styleHost: page.host });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(seen, [undefined, undefined, undefined]);
        assert.equal(page.live.length, 1);
    });

    it("removes the styles of a plugin whose start failed after adding one", async () => {
        const page = fakeHost();
        const t = setup([plugin("P")], { P: { start(ctx) { ctx.addStyle("a{}"); throw new Error("boom"); } } }, { styleHost: page.host });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(page.live.length, 0);
        assert.equal(typesOf(t.events, "start-failed").length, 1);
    });

    it("refuses CSS that reaches for a web address, and that failure is the plugin's start failure", async () => {
        const page = fakeHost();
        const t = setup([plugin("P")], { P: { start(ctx) { ctx.addStyle("a{background:url(https://example.com/x.png)}"); } } }, { styleHost: page.host });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(page.live.length, 0);
        assert.match(String((typesOf(t.events, "start-failed")[0] as { error: string; }).error), /refused/);
    });

    it("lets JSX draw with the React found among Discord's modules, once Discord has loaded it", async () => {
        const { jsx } = await import("../src/api/jsxRuntime");
        const t = setup([plugin("P")], {});
        const wreq = t.boot({ 7: factory("t.useState=()=>0;t.useEffect=()=>0;t.useSyncExternalStore=()=>0;t.Fragment=1;t.createElement=(x)=>({made:x})") });
        assert.throws(() => jsx("div", {}), /React was not found yet/);
        wreq("7");
        assert.deepEqual(jsx("div", {}), { made: "div" });
    });
});

describe("plugin cards in the engine", () => {
    it("gives only core plugins the cards, with the state right now and the choice as it is now", async () => {
        const seen: { cards?: Array<{ id: string; running: boolean; chosen: boolean | undefined; restartNeeded: boolean; }>; plain?: boolean; } = {};
        const t = setup([plugin("Plain", { hasPatches: true }), plugin("Core", { core: true })], {
            Plain: { start(ctx) { seen.plain = ctx.plugins !== undefined; } },
            Core: {
                async start(ctx) {
                    ctx.settingsAdmin!.setEnabled("Plain", false);
                    seen.cards = ctx.plugins!.cards().map(c => ({ id: c.id, running: c.state.running, chosen: c.state.chosen, restartNeeded: c.state.restartNeeded }));
                    assert.equal(ctx.plugins!.card("Nope"), undefined);
                    assert.equal(ctx.plugins!.card("Core")?.id, "Core");
                }
            }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(seen.plain, false);
        // Plugins start in order, Plain first (it is running), then the Core plugin asks.
        assert.deepEqual(seen.cards, [
            { id: "Core", running: false, chosen: undefined, restartNeeded: false },
            { id: "Plain", running: true, chosen: false, restartNeeded: true }
        ]);
    });

    it("knows Discord's build number once it is read from the page", async () => {
        let compatibility: string | undefined;
        const t = setup([plugin("Core", { core: true, discord: { minBuild: 700000, maxBuild: null } } as never)], {
            Core: { start(ctx) { compatibility = ctx.plugins!.card("Core")?.compatibility; } }
        }, { build: 650101 });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(compatibility, "discord-too-old");
    });
});

describe("turning plugins on and off while Discord runs", () => {
    const hot = (id: string, extra: Record<string, unknown> = {}) => ({ ...plugin(id, { enabledByDefault: false }), ...extra });

    /** A core plugin that keeps the `plugins` object it is given, so the test drives the toggles itself. */
    function withCore(others: Array<ReturnType<typeof plugin>>, codes: Record<string, PluginCode | Error>, extra: Parameters<typeof setup>[2] = {}) {
        let toggle!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
        const t = setup([plugin("Core", { core: true }), ...others], { ...codes, Core: { start(ctx) { toggle = ctx.plugins!; } } }, extra);
        return { t, api: () => toggle };
    }

    it("closes the modals a plugin left open when it is switched off", async () => {
        const closed: string[] = [];
        const opener = (_m: unknown, exports: Record<string, unknown>) => { exports.open = (_render: unknown, opts: unknown) => { void opts; return "stackNextByDefault:dismissable:onCloseCallback:k1"; }; };
        const closer = (_m: unknown, exports: Record<string, unknown>) => { exports.close = (key: string) => { closed.push(key, ".onCloseCallback()"); }; };
        let key: string | undefined;
        const { t, api } = withCore([hot("Dialog")], { Dialog: { start(ctx) { key = ctx.modals.open(() => null); } } });
        t.boot({ 1: opener, 2: closer })("1");
        t.dom();
        await t.engine.done;
        assert.deepEqual(await api().toggle("Dialog", true), { status: "applied" });
        assert.equal(key, "stackNextByDefault:dismissable:onCloseCallback:k1");
        assert.deepEqual(closed, []);
        assert.deepEqual(await api().toggle("Dialog", false), { status: "applied" });
        assert.deepEqual(closed, ["stackNextByDefault:dismissable:onCloseCallback:k1", ".onCloseCallback()"], "closed with the key it was given");
    });

    it("starts a plugin without patches on the spot, with its own settings attached, and stops it again", async () => {
        const settings = definePluginSettings({ size: { type: "number", default: 5, min: 1, max: 10, description: "A size" } });
        const log: string[] = [];
        const { t, api } = withCore([hot("Hot")], { Hot: { settings, start() { log.push(`start ${settings.store.size}`); }, stop() { log.push("stop"); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(t.loaded, ["Core"], "its code is not even loaded before it is switched on");

        assert.deepEqual(await api().toggle("Hot", true), { status: "applied" });
        assert.deepEqual(log, ["start 5"]);
        assert.equal(api().card("Hot")?.state.running, true);
        assert.equal(api().card("Hot")?.state.chosen, true);
        assert.equal(api().card("Hot")?.state.restartNeeded, false);
        assert.deepEqual(t.changes, [{ type: "plugin-enabled", plugin: "Hot", enabled: true }]);

        assert.deepEqual(await api().toggle("Hot", false), { status: "applied" });
        assert.deepEqual(log, ["start 5", "stop"]);
        assert.equal(api().card("Hot")?.state.running, false);
        assert.equal(settings.pluginId, null, "the settings are let go after it stopped");

        assert.deepEqual(await api().toggle("Hot", true), { status: "applied" });
        assert.deepEqual(log, ["start 5", "stop", "start 5"]);
        assert.equal(settings.pluginId, "Hot", "and attached again when it comes back");
        assert.deepEqual(typesOf(t.events, "started").map(e => (e as { plugin: string; }).plugin), ["Core", "Hot", "Hot"]);
    });

    /** A module exporting what the finder for Discord's dispatcher looks for, keeping its subscribers where the test can see them. */
    function dispatcherModule() {
        const subscribers: Array<{ type: string; callback: (event: unknown) => void; }> = [];
        const module = (_m: unknown, exports: Record<string, unknown>) => {
            exports.dispatch = () => undefined;
            exports.subscribe = (type: string, callback: (event: unknown) => void) => { subscribers.push({ type, callback }); };
            exports.unsubscribe = (type: string, callback: (event: unknown) => void) => { const i = subscribers.findIndex(s => s.type === type && s.callback === callback); if (i >= 0) subscribers.splice(i, 1); };
        };
        return { module, subscribers };
    }

    it("subscribes the flux handlers of a plugin once it started, and takes them back when it is switched off", async () => {
        const seen: unknown[] = [];
        const dispatcher = dispatcherModule();
        const { t, api } = withCore([hot("Flux")], { Flux: { flux: { PING(event: { n: number; }) { seen.push(event.n); } } } });
        t.boot({ 1: dispatcher.module })("1");
        t.dom();
        await t.engine.done;
        assert.equal(dispatcher.subscribers.length, 0, "nothing is subscribed while the plugin is off");

        assert.deepEqual(await api().toggle("Flux", true), { status: "applied" });
        assert.deepEqual(dispatcher.subscribers.map(s => s.type), ["PING"]);
        dispatcher.subscribers[0].callback({ n: 7 });
        assert.deepEqual(seen, [7]);

        assert.deepEqual(await api().toggle("Flux", false), { status: "applied" });
        assert.deepEqual(dispatcher.subscribers, []);
    });

    it("subscribes after start() has run, and not at all when start() fails", async () => {
        const log: string[] = [];
        const dispatcher = dispatcherModule();
        const { t, api } = withCore([hot("Ok"), hot("Bad")], {
            Ok: {
                async start() {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    log.push(`start with ${dispatcher.subscribers.length} subscribed`);
                },
                flux: { PING() { /* nothing */ } }
            },
            Bad: { start() { throw new Error("no start"); }, flux: { PING() { /* nothing */ } } }
        });
        t.boot({ 1: dispatcher.module })("1");
        t.dom();
        await t.engine.done;

        await api().toggle("Ok", true);
        assert.deepEqual(log, ["start with 0 subscribed"]);
        assert.equal(dispatcher.subscribers.length, 1);
        await api().toggle("Bad", true);
        assert.equal(dispatcher.subscribers.length, 1, "the plugin that failed to start subscribed nothing");
    });

    it("reports a flux handler that throws against its plugin and keeps Discord's dispatch safe", async () => {
        const dispatcher = dispatcherModule();
        const { t, api } = withCore([hot("Flux")], { Flux: { flux: { PING() { throw new Error("handler broke"); } } } });
        t.boot({ 1: dispatcher.module })("1");
        t.dom();
        await t.engine.done;
        await api().toggle("Flux", true);
        assert.doesNotThrow(() => dispatcher.subscribers[0].callback({}));
        const errors = typesOf(t.events, "runtime-error") as Array<{ plugin: string; source: string; error: string; }>;
        assert.deepEqual(errors.map(e => [e.plugin, e.source, e.error]), [["Flux", "flux PING", "Error: handler broke"]]);
    });

    it("removes the styles of a plugin that is switched off", async () => {
        const live: Array<{ id: string; textContent: string | null; remove(): void; }> = [];
        const styleHost = { create: () => { const e = { id: "", textContent: null as string | null, remove: () => { live.splice(live.indexOf(e), 1); } }; return e; }, attach: (e: (typeof live)[number]) => { live.push(e); } };
        const { t, api } = withCore([hot("Hot")], { Hot: { start(ctx) { ctx.addStyle(".a{}"); } } }, { styleHost });
        t.boot();
        t.dom();
        await t.engine.done;
        await api().toggle("Hot", true);
        assert.equal(live.length, 1);
        await api().toggle("Hot", false);
        assert.equal(live.length, 0);
    });

    it("saves the choice and asks for a restart for a plugin with patches, without loading or starting it", async () => {
        const { t, api } = withCore([hot("Patched", { hasPatches: true })], { Patched: { start() { throw new Error("must not start"); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(await api().toggle("Patched", true), { status: "restart-needed" });
        assert.deepEqual(t.loaded, ["Core"]);
        assert.equal(api().card("Patched")?.state.restartNeeded, true);
        assert.deepEqual(t.changes, [{ type: "plugin-enabled", plugin: "Patched", enabled: true }]);
    });

    it("asks for a restart when the code has patches that the build did not see, and leaves nothing half done", async () => {
        const settings = definePluginSettings({});
        const { t, api } = withCore([hot("Sneaky")], { Sneaky: { settings, patches: [{ find: "x", replacement: [] } as never], start() { throw new Error("must not start"); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(await api().toggle("Sneaky", true), { status: "restart-needed" });
        assert.equal(settings.pluginId, null);
        assert.equal(api().card("Sneaky")?.state.running, false);
    });

    it("shows a plugin whose code cannot be loaded as failed, and says why", async () => {
        const { t, api } = withCore([hot("Broken")], { Broken: new Error("cannot load it") });
        t.boot();
        t.dom();
        await t.engine.done;
        const result = await api().toggle("Broken", true);
        assert.deepEqual(result, { status: "failed", error: "Error: cannot load it" });
        assert.equal(api().card("Broken")?.state.lifecycle, "failed");
        assert.equal(api().card("Broken")?.state.error, "Error: cannot load it");
    });

    it("starts what a plugin needs first, and will not stop a plugin that a running one needs", async () => {
        const order: string[] = [];
        const { t, api } = withCore([hot("User", { dependencies: ["Base"] }), hot("Base")], {
            User: { start() { order.push("User"); } },
            Base: { start() { order.push("Base"); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(await api().toggle("User", true), { status: "applied" });
        assert.deepEqual(order, ["Base", "User"]);
        assert.deepEqual(await api().toggle("Base", false), { status: "refused", reason: "User needs it and is running" });
        assert.equal(api().card("Base")?.state.running, true);
        assert.deepEqual(await api().toggle("User", false), { status: "applied" });
        assert.deepEqual(await api().toggle("Base", false), { status: "applied" });
    });

    it("refuses in safe mode, and for plugins in quarantine, and never turns a core plugin off", async () => {
        const safe = withCore([hot("Hot")], {}, { boot: { safeMode: true, safeModeReason: "test" } });
        safe.t.boot();
        safe.t.dom();
        await safe.t.engine.done;
        assert.deepEqual(await safe.api().toggle("Hot", true), { status: "refused", reason: "safe mode is on, so only core plugins run" });
        assert.deepEqual(await safe.api().toggle("Core", false), { status: "refused", reason: "core plugins cannot be turned off" });

        const quarantined = withCore([hot("Hot")], {}, { boot: { quarantine: ["Hot"] } });
        quarantined.t.boot();
        quarantined.t.dom();
        await quarantined.t.engine.done;
        assert.deepEqual(await quarantined.api().toggle("Hot", true), { status: "refused", reason: "it is in quarantine" });
        assert.deepEqual(quarantined.t.changes, []);
    });

    it("lets a plugin that runs from the start be turned off on the spot", async () => {
        const log: string[] = [];
        const { t, api } = withCore([plugin("Runs")], { Runs: { start() { log.push("start"); }, stop() { log.push("stop"); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(await api().toggle("Runs", false), { status: "applied" });
        assert.deepEqual(log, ["start", "stop"]);
        assert.equal(api().card("Runs")?.state.chosen, false);
        assert.equal(api().card("Runs")?.state.restartNeeded, false);
    });
});

describe("restarting Discord from the page", () => {
    it("lets only core plugins ask, and passes the request to the main process", async () => {
        let plainCan: boolean | undefined;
        const t = setup([plugin("Plain"), plugin("Core", { core: true })], {
            Plain: { start(ctx) { plainCan = ctx.plugins !== undefined; } },
            Core: { start(ctx) { ctx.plugins!.restart(); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(plainCan, false);
        assert.equal(t.restarts(), 1);
    });
});

describe("what the engine offers to plugins besides the cards", () => {
    it("gives only core plugins the engine's status and actions", async () => {
        let plainCan: boolean | undefined;
        const t = setup([plugin("Plain"), plugin("Core", { core: true })], {
            Plain: { start(ctx) { plainCan = ctx.engine !== undefined; } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(plainCan, false);
    });

    it("tells core plugins the version, the build and what the boot decided", async () => {
        let status: unknown;
        const t = setup([plugin("Core", { core: true })], {
            Core: { start(ctx) { status = ctx.engine!.status(); } }
        }, {
            build: 650101,
            boot: { safeMode: true, safeModeReason: "two failed starts", enteredSafeMode: true, quarantine: ["Bad"], devMode: false, problems: ["something odd"] }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(status, {
            version: PROJECT_VERSION, discordBuild: 650101, safeMode: true, safeModeReason: "two failed starts", enteredSafeMode: true,
            quarantine: ["Bad"], devMode: false, problems: ["something odd", "the quarantine list names the unknown plugin \"Bad\""], selfTests: [],
            stopped: { analytics: 0, metrics: 0, "crash-reports": 0 },
            stoppedAt: { analytics: null, metrics: null, "crash-reports": null },
            network: { "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 },
            dns: ""
        });
    });

    it("gives a copy of the lists, so a plugin cannot change what the boot decided", async () => {
        const t = setup([plugin("Core", { core: true })], {
            Core: { start(ctx) { const s = ctx.engine!.status(); s.quarantine.push("Hacked"); s.problems.push("Hacked"); } }
        }, { boot: { quarantine: ["Bad"] } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(t.engine.lifecycle.stateOf("Core"), "started");
        // A second look finds the original lists.
        let again: string[] = [];
        const t2 = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctx.engine!.status().quarantine.push("x"); again = ctx.engine!.status().quarantine; } } }, { boot: { quarantine: ["Bad"] } });
        t2.boot();
        t2.dom();
        await t2.engine.done;
        assert.deepEqual(again, ["Bad"]);
    });

    it("passes the request to open the data folder to the main process, only for core plugins", async () => {
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctx.engine!.openDataFolder(); ctx.engine!.openDataFolder(); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(t.folderOpens(), 2);
    });

    it("lets any plugin report an error of its own, attributed to it, with the source named", async () => {
        const t = setup([plugin("Any"), plugin("Other")], {
            Any: { start(ctx) { ctx.reportError("main tab", new Error("could not draw")); ctx.reportError("plain text", "just text"); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        const errors = typesOf(t.events, "runtime-error");
        assert.deepEqual(errors, [
            { type: "runtime-error", plugin: "Any", source: "main tab", error: "Error: could not draw" },
            { type: "runtime-error", plugin: "Any", source: "plain text", error: "just text" }
        ]);
    });
});

describe("the privacy self-test in the engine", () => {
    const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
    const socketClass = () => {
        class Socket { send(_data: unknown) { return "sent"; } }
        return Socket;
    };

    it("does not start unless it is asked to: no events, no watcher, an empty result in the status", async () => {
        let status: (() => { selfTests: unknown[]; }) | undefined;
        const Socket = socketClass();
        const before = Socket.prototype.send;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { status = () => ctx.engine!.status(); } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(typesOf(t.events, "self-test").length, 0);
        assert.equal(Socket.prototype.send, before);
        assert.deepEqual(status!().selfTests, []);
    });

    it("watches the gateway from the start, reads Discord's properties when their module appears, and reports both to the bridge and the status", async () => {
        const Socket = socketClass();
        let ctxStatus: (() => { selfTests: Array<{ name: string; status: string; }>; }) | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxStatus = () => ctx.engine!.status(); } } }, {
            selfTest: { webSocket: Socket as unknown as NonNullable<EngineOptions["selfTest"]>["webSocket"] }
        });
        assert.notEqual(Socket.prototype.send, undefined);

        // The gateway: Discord's first send, before Webpack even exists.
        new Socket().send('{"op":2,"d":{"properties":{"has_client_mods":false}}}');
        assert.deepEqual(typesOf(t.events, "self-test").map(e => e.type === "self-test" && `${e.name}:${e.status}`), ["first-gateway-message:pass"]);

        // The properties: Discord's module loads later; the engine finds it and reads it.
        const wreq = t.boot({ "70": factory(`e.exports = { getSuperPropertiesBase64: () => "${b64('{"os":"Windows","has_client_mods":false}')}" };`) });
        wreq("70");
        for (const work of t.delayed.splice(0)) work();
        t.dom();
        await t.engine.done;
        const names = typesOf(t.events, "self-test").map(e => e.type === "self-test" && `${e.name}:${e.status}`);
        assert.deepEqual(names, ["first-gateway-message:pass", "super-properties:pass"]);
        assert.deepEqual(ctxStatus!().selfTests.map(r => `${r.name}:${r.status}`), names);
        assert.equal(typesOf(t.events, "finder-miss").length, 0, "waiting for Discord's module is not a miss");
    });

    it("reports a failure of the properties as a failure, and never as a pass", async () => {
        const Socket = socketClass();
        const t = setup([plugin("Core", { core: true })], {}, { selfTest: { webSocket: Socket as unknown as NonNullable<EngineOptions["selfTest"]>["webSocket"] } });
        const wreq = t.boot({ "71": factory(`e.exports = { getSuperPropertiesBase64: () => "${b64('{"has_client_mods":true}')}" };`) });
        wreq("71");
        for (const work of t.delayed.splice(0)) work();
        const properties = typesOf(t.events, "self-test").find(e => e.type === "self-test" && e.name === "super-properties");
        assert.ok(properties && properties.type === "self-test" && properties.status === "fail");
    });
});

describe("what privacy plugins stopped inside Discord", () => {
    it("is counted by core plugins through the context and shown in the engine status, and non-core plugins get no way to count", async () => {
        let status: (() => { stopped: Record<string, number>; }) | undefined;
        let coreHas: boolean | undefined;
        let otherHas: boolean | undefined;
        const t = setup([plugin("Core", { core: true }), plugin("Other")], {
            Core: { start(ctx) { status = () => ctx.engine!.status(); coreHas = ctx.privacy !== undefined; ctx.privacy!.stopped("analytics"); ctx.privacy!.stopped("analytics"); ctx.privacy!.stopped("metrics"); ctx.privacy!.stopped("crash-reports"); } },
            Other: { start(ctx) { otherHas = ctx.privacy !== undefined; } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(coreHas, true);
        assert.equal(otherHas, false);
        assert.deepEqual(status!().stopped, { analytics: 2, metrics: 1, "crash-reports": 1 });
    });

    it("ignores a kind it does not know and gives the status a copy it cannot change the counters through", async () => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } });
        t.boot();
        t.dom();
        await t.engine.done;
        ctxRef!.privacy!.stopped("nonsense" as never);
        const status = ctxRef!.engine!.status();
        status.stopped.analytics = 999;
        assert.deepEqual(ctxRef!.engine!.status().stopped, { analytics: 0, metrics: 0, "crash-reports": 0 });
    });
});

describe("what the network firewall cancelled", () => {
    const counts = (usage: number) => ({ cancelled: { "usage-reports": usage, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 } });
    const start = async (firewall?: () => Promise<unknown>) => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } }, firewall ? { firewall } : {});
        t.boot();
        t.dom();
        await t.engine.done;
        return ctxRef!.engine!;
    };
    const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it("shows zeros when the main process cannot be asked", async () => {
        const engine = await start();
        assert.deepEqual(engine.status().network, { "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 });
    });

    it("shows the last answer of the main process, rebuilt field by field", async () => {
        const engine = await start(() => Promise.resolve(counts(7)));
        await settle();
        assert.equal(engine.status().network["usage-reports"], 7);
    });

    it("asks at most once a second, however often the status is read", async () => {
        let asks = 0;
        const engine = await start(() => { asks++; return Promise.resolve(counts(1)); });
        for (let i = 0; i < 20; i++) engine.status();
        assert.equal(asks, 1);
    });

    it("keeps the last numbers when the answer is wrong, and never throws", async () => {
        const engine = await start(() => Promise.resolve(counts(3)));
        await settle();
        assert.equal(engine.status().network["usage-reports"], 3);
        assert.doesNotThrow(() => engine.status());
    });

    it("keeps the last numbers when the ask fails or throws", async () => {
        for (const fail of [() => Promise.reject(new Error("no")), () => { throw new Error("sync"); }, () => Promise.resolve({ cancelled: { "usage-reports": -1 } })]) {
            const engine = await start(fail as () => Promise<unknown>);
            await settle();
            assert.doesNotThrow(() => engine.status());
            assert.equal(engine.status().network["usage-reports"], 0);
        }
    });

    it("keeps the last good numbers when a later answer is wrong", async () => {
        mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
        try {
            const answers: unknown[] = [counts(5), { cancelled: "broken" }];
            const engine = await start(() => Promise.resolve(answers.shift()));
            await settle();
            assert.equal(engine.status().network["usage-reports"], 5);
            mock.timers.tick(2000);
            engine.status();
            await settle();
            assert.equal(engine.status().network["usage-reports"], 5, "a wrong answer does not erase what was known");
        } finally {
            mock.timers.reset();
        }
    });

    it("shows the encrypted DNS line the main process wrote, and keeps the last one when a later answer is wrong", async () => {
        mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
        try {
            const answers: unknown[] = [{ ...counts(1), dns: "Configured: Quad9, automatic, answered in 38 ms" }, { cancelled: "broken", dns: "NOT SHOWN" }];
            const engine = await start(() => Promise.resolve(answers.shift()));
            await settle();
            assert.equal(engine.status().dns, "Configured: Quad9, automatic, answered in 38 ms");
            mock.timers.tick(2000);
            engine.status();
            await settle();
            assert.equal(engine.status().dns, "Configured: Quad9, automatic, answered in 38 ms");
        } finally {
            mock.timers.reset();
        }
    });

    it("shows no DNS line when the answer has none, and only plain text when it has", async () => {
        const plain = await start(() => Promise.resolve(counts(1)));
        await settle();
        assert.equal(plain.status().dns, "");
        const odd = await start(() => Promise.resolve({ ...counts(1), dns: "Off\u0000\u001b[31mred\n" }));
        await settle();
        assert.equal(odd.status().dns, "Off[31mred");
    });

    it("gives a copy the page cannot change the counters through", async () => {
        const engine = await start(() => Promise.resolve(counts(2)));
        await settle();
        engine.status().network.metrics = 999;
        assert.equal(engine.status().network.metrics, 0);
    });
});

describe("what the Privacy & Security tab may ask the main process", () => {
    const good = () => ({
        cancelled: { "usage-reports": 1, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 },
        dns: { line: "Off", mode: "off", provider: "", saved: { mode: "off", provider: "" }, pending: false },
        telemetry: { usage: true, crash: true },
        logVersion: 0,
        pause: null,
        rules: [],
        ruleCount: 0,
        providers: []
    });
    const startCtx = async (extra: { privacy?: () => Promise<unknown>; }) => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } }, extra);
        t.boot();
        t.dom();
        await t.engine.done;
        return ctxRef!;
    };
    const start = async (extra: { privacy?: () => Promise<unknown>; testProvider?: (id: string) => Promise<unknown>; changePrivacy?: (change: unknown) => Promise<unknown>; }) => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } }, extra);
        t.boot();
        t.dom();
        await t.engine.done;
        return ctxRef!.engine!;
    };

    it("gives the snapshot rebuilt field by field", async () => {
        const engine = await start({ privacy: () => Promise.resolve({ ...good(), extra: "dropped" }) });
        const answer = await engine.privacy();
        assert.equal(answer?.counts["usage-reports"], 1);
        assert.ok(!("extra" in answer!));
    });

    it("knows protection is paused only from what the main process answered, and only until the time it gave runs out", async () => {
        let answer: unknown = { ...good(), pause: { remainingMs: 60_000 } };
        const ctx = await startCtx({ privacy: () => Promise.resolve(answer) });
        assert.equal(ctx.privacy!.paused(), false, "not before the snapshot was read");
        assert.equal((await ctx.engine!.privacy())?.pause?.remainingMs, 60_000);
        assert.equal(ctx.privacy!.paused(), true);
        answer = { ...good(), pause: null };
        await ctx.engine!.privacy();
        assert.equal(ctx.privacy!.paused(), false, "a snapshot with no pause ends it");
    });

    it("ends the pause by its own clock when no new snapshot arrives", async () => {
        const ctx = await startCtx({ privacy: () => Promise.resolve({ ...good(), pause: { remainingMs: 20 } }) });
        await ctx.engine!.privacy();
        assert.equal(ctx.privacy!.paused(), true);
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(ctx.privacy!.paused(), false);
    });

    it("never turns a pause on from a snapshot it did not accept", async () => {
        const ctx = await startCtx({ privacy: () => Promise.resolve({ ...good(), pause: { remainingMs: 999_999_999 } }) });
        assert.equal(await ctx.engine!.privacy(), null);
        assert.equal(ctx.privacy!.paused(), false);
    });

    it("keeps the last pause when the main process does not answer", async () => {
        let fail = false;
        const ctx = await startCtx({ privacy: () => (fail ? Promise.reject(new Error("no")) : Promise.resolve({ ...good(), pause: { remainingMs: 60_000 } })) });
        await ctx.engine!.privacy();
        fail = true;
        await ctx.engine!.privacy();
        assert.equal(ctx.privacy!.paused(), true, "the page keeps counting down to the time it was given");
    });

    it("gives null when the bridge cannot be asked, fails, throws or answers in the wrong shape", async () => {
        assert.equal(await (await start({})).privacy(), null);
        assert.equal(await (await start({ privacy: () => Promise.reject(new Error("no")) })).privacy(), null);
        assert.equal(await (await start({ privacy: () => { throw new Error("sync"); } })).privacy(), null);
        assert.equal(await (await start({ privacy: () => Promise.resolve({ cancelled: "broken" }) })).privacy(), null);
        assert.equal(await (await start({ privacy: () => Promise.resolve(null) })).privacy(), null);
    });

    it("sends only the id to the main process and rebuilds the answer to Test now", async () => {
        const asked: string[] = [];
        const engine = await start({ testProvider: id => { asked.push(id); return Promise.resolve({ ok: true, reason: "", ms: 9.4, extra: 1 }); } });
        assert.deepEqual(await engine.testProvider("mullvad-base"), { ok: true, reason: "", ms: 9 });
        assert.deepEqual(asked, ["mullvad-base"]);
    });

    it("gives null for Test now when the bridge is missing, fails, throws or answers wrongly", async () => {
        assert.equal(await (await start({})).testProvider("quad9"), null);
        assert.equal(await (await start({ testProvider: () => Promise.reject(new Error("no")) })).testProvider("quad9"), null);
        assert.equal(await (await start({ testProvider: () => { throw new Error("sync"); } })).testProvider("quad9"), null);
        assert.equal(await (await start({ testProvider: () => Promise.resolve({ ok: "yes" }) })).testProvider("quad9"), null);
    });
});

describe("what the Privacy & Security tab may ask the main process to change", () => {
    const start = async (changePrivacy?: (change: unknown) => Promise<unknown>) => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } }, changePrivacy ? { changePrivacy } : {});
        t.boot();
        t.dom();
        await t.engine.done;
        return ctxRef!.engine!;
    };
    const change = { type: "telemetry", key: "disableAnalytics", value: false } as const;

    it("sends the change as it is and gives back the sentence of the main process, rebuilt", async () => {
        const sent: unknown[] = [];
        const engine = await start(value => { sent.push(value); return Promise.resolve({ status: "cancelled", message: "Nothing was changed.", extra: 1 }); });
        assert.deepEqual(await engine.changePrivacy(change), { status: "cancelled", message: "Nothing was changed." });
        assert.deepEqual(sent, [change]);
    });

    it("gives null when the bridge is missing, fails, throws or answers in the wrong shape", async () => {
        assert.equal(await (await start()).changePrivacy(change), null);
        assert.equal(await (await start(() => Promise.reject(new Error("no")))).changePrivacy(change), null);
        assert.equal(await (await start(() => { throw new Error("sync"); })).changePrivacy(change), null);
        assert.equal(await (await start(() => Promise.resolve({ status: "maybe", message: "x" }))).changePrivacy(change), null);
        assert.equal(await (await start(() => Promise.resolve(null))).changePrivacy(change), null);
    });
});

describe("what the Privacy & Security tab may ask about recent blocks", () => {
    const start = async (blockLog?: () => Promise<unknown>) => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } }, blockLog ? { blockLog } : {});
        t.boot();
        t.dom();
        await t.engine.done;
        return ctxRef!.engine!;
    };
    const stoppedStartAt = async () => {
        let ctxRef: EnginePluginContext | undefined;
        const t = setup([plugin("Core", { core: true })], { Core: { start(ctx) { ctxRef = ctx; } } });
        t.boot();
        t.dom();
        await t.engine.done;
        return ctxRef!;
    };

    const list = { version: 3, groups: [{ kind: "metrics", method: "POST", host: "discord.com", path: "/api/*/metrics", count: 2, agoMs: 10 }] };

    it("gives the list rebuilt field by field", async () => {
        const engine = await start(() => Promise.resolve({ ...list, extra: 1 }));
        assert.deepEqual(await engine.blocks(), list);
    });

    it("gives null when the bridge has no list, fails, throws or answers in the wrong shape", async () => {
        assert.equal(await (await start()).blocks(), null);
        assert.equal(await (await start(() => Promise.reject(new Error("no")))).blocks(), null);
        assert.equal(await (await start(() => { throw new Error("sync"); })).blocks(), null);
        assert.equal(await (await start(() => Promise.resolve({ version: 1, groups: [{ kind: "x" }] }))).blocks(), null);
        assert.equal(await (await start(() => Promise.resolve(null))).blocks(), null);
    });

    it("tells when the last one of each kind was stopped inside Discord, and null for a kind never stopped", async () => {
        mock.timers.enable({ apis: ["Date"], now: 5000 });
        try {
            const ctx = await stoppedStartAt();
            assert.deepEqual(ctx.engine!.status().stoppedAt, { analytics: null, metrics: null, "crash-reports": null });
            ctx.privacy!.stopped("analytics");
            mock.timers.tick(3000);
            ctx.privacy!.stopped("metrics");
            mock.timers.tick(1000);
            ctx.privacy!.stopped("analytics");
            assert.deepEqual(ctx.engine!.status().stoppedAt, { analytics: 9000, metrics: 8000, "crash-reports": null });
            assert.deepEqual(ctx.engine!.status().stopped, { analytics: 2, metrics: 1, "crash-reports": 0 });
        } finally {
            mock.timers.reset();
        }
    });

    it("gives a copy of the times, so a plugin cannot change them", async () => {
        const ctx = await stoppedStartAt();
        ctx.privacy!.stopped("metrics");
        const status = ctx.engine!.status();
        status.stoppedAt.metrics = 1;
        assert.notEqual(ctx.engine!.status().stoppedAt.metrics, 1);
    });
});

describe("the settings of plugins, for the gear of the Plugins page", () => {
    const hot = (id: string, extra: Record<string, unknown> = {}) => ({ ...plugin(id, { enabledByDefault: false }), ...extra });
    const declare = () => definePluginSettings({
        size: { type: "number", default: 5, min: 1, max: 10, integer: true, description: "A size" },
        label: { type: "string", default: "hi", maxLength: 8, description: "A label" },
        mode: { type: "select", default: "a", options: [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }], description: "A mode" },
        loud: { type: "boolean", default: false, description: "Loud", restartNeeded: true }
    });

    function withCore(others: Array<ReturnType<typeof plugin>>, codes: Record<string, PluginCode | Error>) {
        let plugins!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
        const t = setup([plugin("Core", { core: true }), ...others], { ...codes, Core: { start(ctx) { plugins = ctx.plugins!; } } });
        return { t, api: () => plugins };
    }

    async function running() {
        const settings = declare();
        const made = withCore([hot("Hot", { hasSettings: true, riskySettings: ["size"] })], { Hot: { settings } });
        made.t.boot();
        made.t.dom();
        await made.t.engine.done;
        assert.deepEqual(await made.api().toggle("Hot", true), { status: "applied" });
        return { ...made, settings };
    }

    it("gives the declared settings of a running plugin as plain data, with defaults, limits and the risky mark", async () => {
        const { api } = await running();
        const answer = api().settingsOf("Hot");
        assert.deepEqual(answer, {
            state: "ready",
            settings: [
                { key: "size", type: "number", description: "A size", default: 5, value: 5, changed: false, restartNeeded: false, risky: true, min: 1, max: 10, integer: true },
                { key: "label", type: "string", description: "A label", default: "hi", value: "hi", changed: false, restartNeeded: false, risky: false, maxLength: 8 },
                { key: "mode", type: "select", description: "A mode", default: "a", value: "a", changed: false, restartNeeded: false, risky: false, options: [{ label: "Alpha", value: "a" }, { label: "Beta", value: "b" }] },
                { key: "loud", type: "boolean", description: "Loud", default: false, value: false, changed: false, restartNeeded: true, risky: false }
            ]
        });
        assert.deepEqual(JSON.parse(JSON.stringify(answer)), answer, "nothing but plain data");
    });

    it("changes a setting through the plugin's own declaration and shows the new value", async () => {
        const { t, api, settings } = await running();
        assert.equal(api().setSetting("Hot", "size", 8), null);
        assert.equal(settings.store.size, 8);
        const size = (api().settingsOf("Hot") as { settings: Array<{ key: string; value: unknown; changed: boolean; }>; }).settings.find(s => s.key === "size");
        assert.deepEqual([size?.value, size?.changed], [8, true]);
        assert.deepEqual((t.changes as Array<{ type: string; key?: string; value?: unknown; }>).filter(c => c.type === "plugin-setting").map(c => [(c as { key: string; }).key, (c as { value?: unknown; }).value]), [["size", 8]]);
    });

    it("refuses a value of the wrong type or out of its limits, a key the plugin did not declare, and keys that could reach the prototype", async () => {
        const { t, api, settings } = await running();
        assert.match(api().setSetting("Hot", "size", "big" as never) ?? "", /must be a number/);
        assert.match(api().setSetting("Hot", "size", 99) ?? "", /must be at most 10/);
        assert.match(api().setSetting("Hot", "size", 2.5) ?? "", /must be a whole number/);
        assert.match(api().setSetting("Hot", "label", "much too long") ?? "", /at most 8 characters/);
        assert.match(api().setSetting("Hot", "mode", "c") ?? "", /one of the listed options/);
        for (const key of ["nope", "__proto__", "constructor", "toString"]) assert.match(api().setSetting("Hot", key, 1) ?? "", /is not a setting of that plugin/, key);
        assert.equal(settings.store.size, 5, "nothing was saved");
        assert.deepEqual((t.changes as Array<{ type: string; key?: string; value?: unknown; }>).filter(c => c.type === "plugin-setting"), []);
        assert.equal(({} as Record<string, unknown>).nope, undefined, "the prototype of plain objects is untouched");
    });

    it("resets only the saved values, never the on/off choice", async () => {
        const { t, api, settings } = await running();
        api().setSetting("Hot", "size", 8);
        api().setSetting("Hot", "mode", "b");
        assert.equal(api().resetSettings("Hot"), null);
        assert.deepEqual([settings.store.size, settings.store.mode], [5, "a"]);
        assert.equal(api().card("Hot")?.state.chosen, true, "the plugin stays switched on");
        assert.equal((t.changes as Array<{ type: string; }>).some(c => c.type === "plugin-reset"), false, "the whole entry is not forgotten");
        assert.equal((t.changes as Array<{ type: string; key?: string; value?: unknown; }>).filter(c => c.type === "plugin-setting").length, 2 + 4, "two changes and one removal per declared setting");
    });

    it("cannot read or change the settings of a plugin that is off, even if it declares some, and says so", async () => {
        const settings = declare();
        const { t, api } = withCore([hot("Hot", { hasSettings: true })], { Hot: { settings } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(api().settingsOf("Hot"), { state: "not-loaded" });
        assert.match(api().setSetting("Hot", "size", 8) ?? "", /no settings that can be changed now/);
        assert.match(api().resetSettings("Hot") ?? "", /no settings that can be reset now/);
        assert.deepEqual(t.loaded, ["Core"], "its code was not loaded to answer");
        await api().toggle("Hot", true);
        assert.equal(api().settingsOf("Hot").state, "ready");
        await api().toggle("Hot", false);
        assert.deepEqual(api().settingsOf("Hot"), { state: "not-loaded" }, "and again once it is off");
    });

    it("says none for a plugin without settings, a running one that declares none, and an unknown plugin", async () => {
        const { t, api } = withCore([hot("Plain"), hot("Quiet", { hasSettings: false })], { Quiet: { start() { /* nothing */ } } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(api().settingsOf("Plain"), { state: "none" });
        await api().toggle("Quiet", true);
        assert.deepEqual(api().settingsOf("Quiet"), { state: "none" });
        assert.deepEqual(api().settingsOf("Ghost"), { state: "none" });
        assert.match(api().setSetting("Ghost", "x", 1) ?? "", /no settings that can be changed now/);
    });

    it("does not trust a plugin whose settings are something else", async () => {
        const { t, api } = withCore([hot("Odd", { hasSettings: true })], { Odd: { settings: { bind() { /* nothing */ }, unbind() { /* nothing */ } } as never } });
        t.boot();
        t.dom();
        await t.engine.done;
        await api().toggle("Odd", true);
        assert.deepEqual(api().settingsOf("Odd"), { state: "none" });
    });
});

describe("a plugin with main-process code, switched from the page", () => {
    const hot = (id: string, extra: Record<string, unknown> = {}) => ({ ...plugin(id, { enabledByDefault: false }), ...extra });

    it("is not started on the spot: the choice is saved and a restart is asked, because the main process decides at start which native parts run", async () => {
        let plugins!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
        const started: string[] = [];
        const t = setup([plugin("Core", { core: true }), hot("Native", { hasNative: true }), hot("Plain")], {
            Core: { start(ctx) { plugins = ctx.plugins!; } },
            Native: { start() { started.push("Native"); } },
            Plain: { start() { started.push("Plain"); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(await plugins.toggle("Native", true), { status: "restart-needed" });
        assert.deepEqual(started, [], "nothing started on the spot");
        assert.equal(plugins.card("Native")?.restartToToggle, true);
        assert.deepEqual(await plugins.toggle("Plain", true), { status: "applied" }, "a plugin without main-process code still switches on the spot");
        assert.deepEqual(started, ["Plain"]);
    });
});

describe("a plugin's own settings component, for the window of the gear", () => {
    const hot = (id: string, extra: Record<string, unknown> = {}) => ({ ...plugin(id, { enabledByDefault: false }), ...extra });
    const Panel = () => null;

    function withCore(others: Array<ReturnType<typeof plugin>>, codes: Record<string, PluginCode | Error>) {
        let plugins!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
        const t = setup([plugin("Core", { core: true }), ...others], { ...codes, Core: { start(ctx) { plugins = ctx.plugins!; } } });
        return { t, api: () => plugins };
    }

    it("is given for a running plugin, and not before it is switched on or after it is switched off", async () => {
        const { t, api } = withCore([hot("Own", { hasSettings: true })], { Own: { settingsComponent: Panel } });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.equal(api().settingsComponentOf("Own"), undefined, "its code is not loaded yet");
        await api().toggle("Own", true);
        assert.equal(api().settingsComponentOf("Own"), Panel);
        await api().toggle("Own", false);
        assert.equal(api().settingsComponentOf("Own"), undefined, "and not any more once it is off");
    });

    it("is undefined for a plugin that gave none, for one that gave something that is not a function, and for an unknown plugin", async () => {
        const { t, api } = withCore([hot("None"), hot("Odd")], { None: { start() { /* nothing */ } }, Odd: { settingsComponent: "not a component" as never } });
        t.boot();
        t.dom();
        await t.engine.done;
        await api().toggle("None", true);
        await api().toggle("Odd", true);
        assert.equal(api().settingsComponentOf("None"), undefined);
        assert.equal(api().settingsComponentOf("Odd"), undefined);
        assert.equal(api().settingsComponentOf("Ghost"), undefined);
    });
});

describe("notifications for plugins", () => {
    interface Kid { className: string; textContent: string | null; tabIndex: number; attrs: Record<string, string>; kids: Kid[]; removed: boolean; setAttribute(name: string, value: string): void; append(...children: Kid[]): void; remove(): void; addEventListener(): void; }
    const el = (): Kid => ({
        className: "", textContent: null, tabIndex: -1, attrs: {}, kids: [], removed: false,
        setAttribute(name, value) { this.attrs[name] = value; }, append(...children) { this.kids.push(...children); }, remove() { this.removed = true; }, addEventListener() { /* not needed */ }
    });
    const styleHost = () => {
        const live: Array<{ id: string; textContent: string | null; remove(): void; }> = [];
        return { live, host: { create: () => { const e = { id: "", textContent: null as string | null, remove: () => { live.splice(live.indexOf(e), 1); } }; return e; }, attach: (e: (typeof live)[number]) => { live.push(e); } } };
    };
    const hot = (id: string) => ({ ...plugin(id, { enabledByDefault: false }) });

    it("gives every plugin its own notifications, and with no page to draw in nothing is shown and nothing breaks", async () => {
        const seen: Array<[string, string, string]> = [];
        const t = setup([plugin("A"), plugin("B")], {
            A: { start(ctx) { seen.push(["A", typeof ctx.notifications.show, typeof ctx.notifications.closeAll]); ctx.notifications.show({ title: "hello" }).close(); } },
            B: { start(ctx) { seen.push(["B", typeof ctx.notifications.show, typeof ctx.notifications.closeAll]); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(seen, [["A", "function", "function"], ["B", "function", "function"]]);
        assert.equal(typesOf(t.events, "runtime-error").length, 0);
    });

    it("draws a plugin's cards in the page with its name on them, adds the style once, and takes the cards away when the plugin is switched off", async () => {
        let plugins!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
        const body = el();
        const page = styleHost();
        const t = setup([plugin("Core", { core: true }), hot("Chatty"), hot("Quiet")], {
            Core: { start(ctx) { plugins = ctx.plugins!; } },
            Chatty: { start(ctx) { ctx.notifications.show({ title: "hi", timeoutMs: 0 }); ctx.notifications.show({ title: "again", timeoutMs: 0 }); } },
            Quiet: { start(ctx) { ctx.notifications.show({ title: "mine", timeoutMs: 0 }); } }
        }, { document: { createElement: () => el(), body } as never, styleHost: page.host });
        t.boot();
        t.dom();
        await t.engine.done;
        await plugins.toggle("Chatty", true);
        await plugins.toggle("Quiet", true);
        const cards = body.kids[0].kids;
        assert.deepEqual(cards.map(card => card.attrs["data-plugin"]), ["Chatty", "Chatty", "Quiet"]);
        assert.equal(page.live.filter(style => (style.textContent ?? "").includes("amiricord-notification")).length, 1, "the style is added once");
        await plugins.toggle("Chatty", false);
        assert.deepEqual(cards.map(card => card.removed), [true, true, false], "only the cards of the plugin that stopped went away");
        assert.equal(typesOf(t.events, "runtime-error").length, 0);
    });
});

describe("sounds for plugins", () => {
    class StubAudio {
        static made: StubAudio[] = [];
        volume = 0;
        played = 0;
        paused = 0;
        constructor(readonly src: string) { StubAudio.made.push(this); }
        play() { this.played++; return Promise.resolve(); }
        pause() { this.paused++; }
        addEventListener() { /* not needed */ }
    }
    const withAudio = async (work: () => Promise<void>) => {
        const holder = globalThis as unknown as { Audio?: unknown; };
        const before = holder.Audio;
        StubAudio.made = [];
        holder.Audio = StubAudio;
        try {
            await work();
        } finally {
            holder.Audio = before;
        }
    };
    const soundModule = factory('var f=function(k){return {"./discodo.mp3":"/assets/a.mp3","./message1.mp3":"/assets/b.mp3"}[k]};f.keys=function(){return ["./discodo.mp3","./message1.mp3"]};e.exports=f;');
    const hot = (id: string) => ({ ...plugin(id, { enabledByDefault: false }) });

    it("lists and plays Discord's sounds found in its code, and stops what a plugin started when it is switched off", async () => {
        await withAudio(async () => {
            let plugins!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
            const answers: unknown[] = [];
            const t = setup([plugin("Core", { core: true }), hot("Loud")], {
                Core: { start(ctx) { plugins = ctx.plugins!; } },
                Loud: { start(ctx) { answers.push(ctx.sounds.list(), ctx.sounds.play("discodo", 0.25), ctx.sounds.play("nope")); } }
            });
            t.boot({ 7: soundModule });
            t.dom();
            await t.engine.done;
            await plugins.toggle("Loud", true);
            assert.deepEqual(answers, [["discodo", "message1"], true, false]);
            assert.equal(StubAudio.made.length, 1);
            assert.equal(StubAudio.made[0].src, "/assets/a.mp3");
            assert.equal(StubAudio.made[0].volume, 0.25);
            assert.equal(StubAudio.made[0].played, 1);
            await plugins.toggle("Loud", false);
            assert.equal(StubAudio.made[0].paused, 1, "the sound stopped with the plugin");
            assert.equal(typesOf(t.events, "runtime-error").length, 0);
        });
    });

    it("answers an empty list and false when Discord has no such module, and nothing breaks", async () => {
        await withAudio(async () => {
            const answers: unknown[] = [];
            const t = setup([plugin("A")], { A: { start(ctx) { answers.push(ctx.sounds.list(), ctx.sounds.play("discodo")); } } });
            t.boot({ 7: factory("t.value=1") });
            t.dom();
            await t.engine.done;
            assert.deepEqual(answers, [[], false]);
            assert.equal(StubAudio.made.length, 0);
            assert.equal(typesOf(t.events, "runtime-error").length, 0);
        });
    });
});

describe("context menus for plugins", () => {
    interface Kid { className: string; textContent: string | null; tabIndex: number; style: { left: string; top: string; }; attrs: Record<string, string>; kids: Kid[]; removed: boolean; setAttribute(name: string, value: string): void; append(...children: Kid[]): void; remove(): void; addEventListener(): void; }
    const el = (): Kid => ({
        className: "", textContent: null, tabIndex: -1, style: { left: "", top: "" }, attrs: {}, kids: [], removed: false,
        setAttribute(name, value) { this.attrs[name] = value; }, append(...children) { this.kids.push(...children); }, remove() { this.removed = true; }, addEventListener() { /* not needed */ }
    });
    const styleHost = () => {
        const live: Array<{ id: string; textContent: string | null; remove(): void; }> = [];
        return { live, host: { create: () => { const e = { id: "", textContent: null as string | null, remove: () => { live.splice(live.indexOf(e), 1); } }; return e; }, attach: (e: (typeof live)[number]) => { live.push(e); } } };
    };
    const hot = (id: string) => ({ ...plugin(id, { enabledByDefault: false }) });

    it("gives every plugin its own context menu, and with no page nothing opens and nothing breaks", async () => {
        const seen: Array<[string, string, string, string, boolean]> = [];
        const t = setup([plugin("A")], {
            A: { start(ctx) { const m = ctx.contextMenu; seen.push(["A", typeof m.open, typeof m.close, typeof m.onElement, m.open({ clientX: 1, clientY: 2 }, [{ id: "x", label: "x", action: () => undefined }])]); m.close(); m.onElement(".x", () => [])(); } }
        });
        t.boot();
        t.dom();
        await t.engine.done;
        assert.deepEqual(seen, [["A", "function", "function", "function", false]]);
        assert.equal(typesOf(t.events, "runtime-error").length, 0);
    });

    it("draws a plugin's menu in the page, adds the style once, and takes the menu away when the plugin is switched off", async () => {
        let plugins!: NonNullable<Parameters<NonNullable<PluginCode["start"]>>[0]["plugins"]>;
        const body = el();
        const page = styleHost();
        const listeners: string[] = [];
        const t = setup([plugin("Core", { core: true }), hot("Menu"), hot("Other")], {
            Core: { start(ctx) { plugins = ctx.plugins!; } },
            Menu: { start(ctx) { ctx.contextMenu.open({ clientX: 5, clientY: 6 }, [{ id: "a", label: "Item", action: () => undefined }]); } },
            Other: { start() { /* nothing */ } }
        }, {
            document: {
                createElement: () => el(), body, documentElement: null,
                addEventListener: (type: string) => { listeners.push(`+${type}`); }, removeEventListener: (type: string) => { listeners.push(`-${type}`); }
            } as never,
            styleHost: page.host
        });
        t.boot();
        t.dom();
        await t.engine.done;
        await plugins.toggle("Menu", true);
        const [menu] = body.kids;
        assert.equal(menu.className, "amiricord-context-menu");
        assert.deepEqual([menu.style.left, menu.style.top], ["5px", "6px"]);
        assert.equal(page.live.filter(style => (style.textContent ?? "").includes("amiricord-context-menu")).length, 1, "the style is added once");
        assert.ok(listeners.includes("+mousedown") && listeners.includes("+keydown"));
        await plugins.toggle("Other", true);
        assert.equal(menu.removed, false, "another plugin starting leaves it");
        await plugins.toggle("Menu", false);
        assert.equal(menu.removed, true, "switching its plugin off takes it away");
        assert.ok(listeners.includes("-mousedown") && listeners.includes("-keydown"), "and it stops listening");
        assert.equal(typesOf(t.events, "runtime-error").length, 0);
    });
});
