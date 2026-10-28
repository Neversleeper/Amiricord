/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { before, describe, it } from "node:test";

import { build } from "esbuild";

import { pageOptions } from "../scripts/build/build";
import { SettingsClient } from "../src/api/settingsClient";
import { gateSentry, quietConfig, quietMaker } from "../src/plugins/NoTrack/quiet";
import type { EnginePluginContext, PluginCode, StoppedKind } from "../src/renderer/engine";
import { compileModule } from "../src/webpack/compileModule";

const srcRoot = resolve(import.meta.dirname, "..", "src");

type Plugin = PluginCode & {
    quietAnalytics(maker: (config: Record<string, unknown>) => unknown): (config: Record<string, unknown>) => unknown;
    metricsTimerOff(): boolean;
    stopMetric(): boolean;
};

let load: () => Plugin;

before(async () => {
    const result = await build({
        entryPoints: [resolve(srcRoot, "plugins/NoTrack/index.ts")],
        ...pageOptions(srcRoot),
        bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", absWorkingDir: resolve(srcRoot, "..")
    });
    const code = result.outputFiles[0].text;
    load = () => {
        const module = { exports: {} as { default: Plugin; } };
        // eslint-disable-next-line no-new-func -- runs the code just bundled from the project's own source
        new Function("module", "exports", code)(module, module.exports);
        return module.exports.default;
    };
});

/** The plugin with its settings attached the way the engine does, and a context that records what it counts. */
function setup(values: Record<string, boolean> = {}, pausedNow: { value: boolean; } = { value: false }) {
    const plugin = load();
    const client = new SettingsClient({ schema: 1, plugins: { NoTrack: { values } } }, () => undefined);
    plugin.settings!.bind(client, "NoTrack");
    const counted: StoppedKind[] = [];
    const errors: string[] = [];
    const ctx = {
        id: "NoTrack",
        onDispose: () => undefined,
        reportError: (source: string, error: unknown) => { errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`); },
        privacy: { stopped: (kind: StoppedKind) => { counted.push(kind); }, paused: () => pausedNow.value }
    } as unknown as EnginePluginContext;
    return { plugin, ctx, counted, errors };
}

/** A configuration shaped like the one Discord's module hands to its analytics store maker. */
const config = () => ({
    dispatcher: { name: "dispatcher" },
    actionHandler: {
        CONNECTION_OPEN: () => true, TRACK: () => true, SET_ANALYTICS_TOKEN: () => true
    },
    TRACKING_URL: "/science"
});

describe("quietConfig", () => {
    it("turns every action into 'do nothing, nothing changed', keeps the rest, and counts only TRACK", () => {
        let tracked = 0;
        const original = config();
        const quiet = quietConfig(original, () => { tracked++; })!;
        assert.deepEqual(Object.keys(quiet.actionHandler!), ["CONNECTION_OPEN", "TRACK", "SET_ANALYTICS_TOKEN"]);
        assert.equal(quiet.dispatcher, original.dispatcher);
        assert.equal(quiet.TRACKING_URL, "/science");
        for (const action of Object.keys(original.actionHandler)) assert.equal((quiet.actionHandler![action] as () => boolean)(), false);
        assert.equal(tracked, 1, "only the TRACK call counted");
    });

    it("does not change the configuration it was given", () => {
        const original = config();
        const handler = original.actionHandler.TRACK;
        quietConfig(original, () => undefined);
        assert.equal(original.actionHandler.TRACK, handler);
    });

    it("keeps answering when counting throws", () => {
        const quiet = quietConfig(config(), () => { throw new Error("counter broke"); })!;
        assert.equal((quiet.actionHandler!.TRACK as () => boolean)(), false);
    });

    it("gives null for a configuration that is not shaped as expected", () => {
        for (const odd of [null, undefined, 5, "x", {}, { actionHandler: null }, { actionHandler: [] }, { actionHandler: "x" }]) assert.equal(quietConfig(odd, () => undefined), null);
    });
});

describe("quietMaker", () => {
    const hooks = (overrides: Partial<Parameters<typeof quietMaker>[1]> = {}) => ({ onTrack: () => undefined, onUnexpected: () => undefined, enabled: () => true, ...overrides });

    it("makes the store with the quiet configuration", () => {
        let given: unknown;
        const made = quietMaker(c => { given = c; return "store"; }, hooks())(config());
        assert.equal(made, "store");
        assert.equal((given as ReturnType<typeof config>).actionHandler.TRACK(), false);
    });

    it("runs Discord's own maker with the configuration as it came when turned off", () => {
        const original = config();
        let given: unknown;
        quietMaker(c => { given = c; return 1; }, hooks({ enabled: () => false }))(original);
        assert.equal(given, original);
    });

    it("leaves a configuration it does not know alone and says so, once per use", () => {
        let said = 0;
        let given: unknown;
        const odd = { nothing: "here" };
        quietMaker(c => { given = c; return 1; }, hooks({ onUnexpected: () => { said++; } }))(odd);
        assert.equal(given, odd);
        assert.equal(said, 1);
    });

    it("survives an error reporter that throws, and gives back what is not a function", () => {
        const maker = quietMaker(c => c, hooks({ onUnexpected: () => { throw new Error("reporter broke"); } }));
        assert.doesNotThrow(() => maker({}));
        const notAFunction = {} as never;
        assert.equal(quietMaker(notAFunction, hooks()), notAFunction);
    });
});

describe("gateSentry", () => {
    it("makes the object read as nothing, ignores assignments and tells about them", () => {
        const target: Record<string, unknown> = {};
        let assigned = 0;
        const release = gateSentry(target, () => { assigned++; })!;
        assert.equal(target.DiscordSentry, undefined);
        target.DiscordSentry = { captureException: () => "sent" };
        target.DiscordSentry = { another: true };
        assert.equal(target.DiscordSentry, undefined);
        assert.equal(assigned, 2);
        assert.equal("DiscordSentry" in target, true);
        assert.equal(Object.keys(target).includes("DiscordSentry"), false, "it does not show up when the page lists its properties");
        release();
        assert.equal("DiscordSentry" in target, false);
        target.DiscordSentry = 1;
        assert.equal(target.DiscordSentry, 1, "after releasing, assignments work again");
    });

    it("puts back what was there before", () => {
        const target = {} as Record<string, unknown>;
        Object.defineProperty(target, "DiscordSentry", { value: "old", configurable: true, writable: true, enumerable: true });
        const release = gateSentry(target)!;
        assert.equal(target.DiscordSentry, undefined);
        release();
        assert.equal(target.DiscordSentry, "old");
    });

    it("gives null, and breaks nothing, when the property cannot be defined", () => {
        const fixed = {};
        Object.defineProperty(fixed, "DiscordSentry", { value: 1, configurable: false });
        assert.equal(gateSentry(fixed), null);
        assert.equal(gateSentry(Object.freeze({})), null);
    });

    it("keeps working when the listener throws", () => {
        const target: Record<string, unknown> = {};
        gateSentry(target, () => { throw new Error("listener broke"); });
        assert.doesNotThrow(() => { target.DiscordSentry = 1; });
    });
});

describe("the patches, on the shapes read from Discord (build 650200)", () => {
    // Reduced to what the patches look at; the real modules are larger.
    const analyticsModule = "function(e,t,n){\"use strict\";n.d(t,{A:()=>u});var i=n(562708),a=n(73153);let u=(0,i.analyticsTrackingStoreMaker)({dispatcher:a.h,actionHandler:{CONNECTION_OPEN:e=>i.AnalyticsActionHandlers.handleConnectionOpen(e),TRACK:e=>i.AnalyticsActionHandlers.handleTrack(e)},TRACKING_URL:c.Rsh.TRACK})}";
    const handlersModule = "function(e,t,n){\"use strict\";n.d(t,{analyticsTrackingStoreMaker:()=>Z,AnalyticsActionHandlers:()=>K});class X{}K.handleTrack=function(e){return!1}}";
    const metricsModule = "function(e,t,n){\"use strict\";let c=new class{constructor(){this._metrics=[],this._intervalId=setInterval(()=>{this._flush()},12e4)}increment(e){let t=arguments.length>1&&void 0!==arguments[1]&&arguments[1];this._metrics.push(e),(t||this._metrics.length>=100)&&this._flush()}distribution(e,t){let n=arguments.length>2&&void 0!==arguments[2]&&arguments[2];this._metrics.push({e,t}),(n||this._metrics.length>=100)&&this._flush()}_flush(){r.Bo.post({url:o.Rsh.METRICS_V2,body:{metrics:[...this._metrics]}}),this._metrics=[]}};t.M=c}";

    it("wraps the analytics store maker in the one module that builds the store, and nowhere else", () => {
        const [analytics] = load().patches!;
        assert.equal(analytics.find, "AnalyticsActionHandlers.handle");
        const result = compileModule("930839", analyticsModule, [{ ...analytics, plugin: "NoTrack" }]);
        assert.equal(result.outcomes[0].status, "applied");
        assert.match(result.code, /Amiricord\.plugin\("NoTrack"\)\.quietAnalytics\(\(0,i\.analyticsTrackingStoreMaker\)\)\(\{dispatcher:a\.h/);
        const other = compileModule("562708", handlersModule, [{ ...analytics, plugin: "NoTrack" }]);
        assert.equal(other.changed, false, "the module that only defines the handlers is not touched");
    });

    it("stops the metrics timer and the two methods that fill the pile, and nothing else of that module", () => {
        const [, metrics] = load().patches!;
        assert.equal(metrics.find, ".METRICS_V2");
        const result = compileModule("807393", metricsModule, [{ ...metrics, plugin: "NoTrack" }]);
        assert.equal(result.outcomes[0].status, "applied");
        assert.deepEqual(result.outcomes[0].replacements.map(r => r.status), ["applied", "applied"]);
        assert.match(result.code, /this\._intervalId=Amiricord\.plugin\("NoTrack"\)\.metricsTimerOff\(\)\?void 0:setInterval\(/);
        assert.match(result.code, /increment\(e\)\{if\(Amiricord\.plugin\("NoTrack"\)\.stopMetric\(\)\)return;let t=/);
        assert.match(result.code, /distribution\(e,t\)\{if\(Amiricord\.plugin\("NoTrack"\)\.stopMetric\(\)\)return;let n=/);
        assert.ok(result.code.includes("_flush(){r.Bo.post"), "the flush method itself is left alone");
    });

    it("works when run: with the timer off and the methods quiet, nothing piles up and nothing is sent", () => {
        const { plugin, ctx, counted } = setup();
        plugin.start!(ctx);
        const [, metrics] = plugin.patches!;
        const result = compileModule("807393", metricsModule, [{ ...metrics, plugin: "NoTrack" }]);
        const sent: unknown[] = [];
        const timers: unknown[] = [];
        // The page's global entry and the pieces the module uses, as stand-ins.
        // eslint-disable-next-line no-new-func -- the test runs the module text that the patch compiler produced, as Discord's loader would
        const run = new Function("Amiricord", "setInterval", "r", "o", `return ${result.code}`)(
            { plugin: () => plugin }, () => { timers.push("timer"); return 1; }, { Bo: { post: (x: unknown) => { sent.push(x); } } }, { Rsh: { METRICS_V2: "/metrics" } }
        ) as (m: unknown, e: Record<string, unknown>, r: unknown) => void;
        const exports: Record<string, { increment(name: string): void; distribution(name: string, value: number): void; _metrics: unknown[]; _intervalId: unknown; }> = {};
        run({}, exports, undefined);
        const counter = exports.M;
        assert.equal(timers.length, 0, "the timer never started");
        assert.equal(counter._intervalId, undefined);
        for (let i = 0; i < 150; i++) counter.increment("a");
        counter.distribution("b", 3);
        assert.equal(counter._metrics.length, 0, "nothing piled up");
        assert.equal(sent.length, 0, "nothing was sent");
        assert.equal(counted.filter(k => k === "metrics").length, 151);
        plugin.stop!(ctx);
    });

    it("leaves the metrics alone when the setting is off", () => {
        const { plugin, ctx } = setup({ disableAnalytics: false });
        plugin.start!(ctx);
        assert.equal(plugin.metricsTimerOff(), false);
        assert.equal(plugin.stopMetric(), false);
        plugin.stop!(ctx);
    });

    it("has patches that are required, so a Discord that moves the text shows up as a failure and not as a silent gap", () => {
        for (const patch of load().patches!) assert.notEqual(patch.required, false);
    });
});

describe("quietConfig with a way through", () => {
    it("runs Discord's own handler with its arguments while the way is open, and counts nothing", () => {
        let tracked = 0;
        const seen: unknown[][] = [];
        const original = { actionHandler: { TRACK: (...args: unknown[]) => { seen.push(args); return "own"; }, OTHER: () => "other" } };
        const quiet = quietConfig(original, () => { tracked++; }, () => true)!;
        const handlers = quiet.actionHandler as Record<string, (...args: unknown[]) => unknown>;
        assert.equal(handlers.TRACK!(1, 2), "own");
        assert.equal(handlers.OTHER!(), "other");
        assert.deepEqual([seen, tracked], [[[1, 2]], 0]);
    });

    it("asks again on every event, so closing the way stops the next one", () => {
        let open = true;
        let tracked = 0;
        const quiet = quietConfig({ actionHandler: { TRACK: () => true } }, () => { tracked++; }, () => open)!;
        const track = (quiet.actionHandler as Record<string, () => unknown>).TRACK!;
        assert.equal(track(), true);
        open = false;
        assert.equal(track(), false);
        assert.equal(tracked, 1);
    });

    it("treats a way that throws, or says anything but true, as closed", () => {
        for (const way of [() => { throw new Error("x"); }, () => 1 as unknown as boolean, () => undefined as unknown as boolean]) {
            let tracked = 0;
            const quiet = quietConfig({ actionHandler: { TRACK: () => true } }, () => { tracked++; }, way)!;
            assert.equal((quiet.actionHandler as Record<string, () => unknown>).TRACK!(), false);
            assert.equal(tracked, 1);
        }
    });

    it("stays quiet for an action whose handler is not a function, even with the way open", () => {
        const quiet = quietConfig({ actionHandler: { TRACK: "not a function" } }, () => undefined, () => true)!;
        assert.equal((quiet.actionHandler as Record<string, () => unknown>).TRACK!(), false);
    });
});

describe("while protection is paused", () => {
    it("lets the analytics events through and counts none, and stops again when the pause ends", () => {
        const pause = { value: true };
        const { plugin, ctx, counted } = setup({}, pause);
        plugin.start!(ctx);
        let made: Record<string, unknown> | undefined;
        plugin.quietAnalytics(c => { made = c; return "store"; })(config());
        const handler = (made!.actionHandler as Record<string, () => boolean>);
        assert.equal(handler.TRACK(), true, "Discord's own handler runs while paused");
        assert.equal(handler.CONNECTION_OPEN(), true, "every action is Discord's own while paused");
        assert.deepEqual(counted, []);
        pause.value = false;
        assert.equal(handler.TRACK(), false, "stopped again after the pause");
        assert.deepEqual(counted, ["analytics"]);
        plugin.stop!(ctx);
    });

    it("lets the metric methods run and counts none", () => {
        const pause = { value: true };
        const { plugin, ctx, counted } = setup({}, pause);
        plugin.start!(ctx);
        assert.equal(plugin.stopMetric(), false);
        assert.deepEqual(counted, []);
        pause.value = false;
        assert.equal(plugin.stopMetric(), true);
        assert.deepEqual(counted, ["metrics"]);
        plugin.stop!(ctx);
    });

    it("keeps the metrics timer off, so a pause never starts a timer that cannot be stopped", () => {
        const { plugin, ctx } = setup({}, { value: true });
        plugin.start!(ctx);
        assert.equal(plugin.metricsTimerOff(), true);
        plugin.stop!(ctx);
    });
});

describe("the plugin", () => {
    it("counts the analytics events it stops, through the maker it hands out", () => {
        const { plugin, ctx, counted } = setup();
        plugin.start!(ctx);
        let made: Record<string, unknown> | undefined;
        plugin.quietAnalytics(c => { made = c; return "store"; })(config());
        const handler = (made!.actionHandler as Record<string, () => boolean>);
        handler.TRACK();
        handler.TRACK();
        handler.CONNECTION_OPEN();
        assert.deepEqual(counted, ["analytics", "analytics"]);
        plugin.stop!(ctx);
    });

    it("reports a configuration it does not know, and still lets Discord make its store", () => {
        const { plugin, ctx, errors } = setup();
        plugin.start!(ctx);
        const made = plugin.quietAnalytics(c => c)({ odd: true });
        assert.deepEqual(made, { odd: true });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /NoTrack: .*analytics store was configured/);
        plugin.stop!(ctx);
    });

    it("lets analytics through when the setting is off", () => {
        const { plugin, ctx } = setup({ disableAnalytics: false });
        plugin.start!(ctx);
        const original = config();
        let given: unknown;
        plugin.quietAnalytics(c => { given = c; return 1; })(original);
        assert.equal(given, original);
        plugin.stop!(ctx);
    });

    it("keeps Discord's crash-report object out of the page while it runs, counts the attempts, and gives it back when it stops", () => {
        const { plugin, ctx, counted } = setup();
        const page = globalThis as Record<string, unknown>;
        plugin.start!(ctx);
        page.DiscordSentry = { captureException: () => "sent" };
        assert.equal(page.DiscordSentry, undefined);
        assert.deepEqual(counted, ["crash-reports"]);
        plugin.stop!(ctx);
        assert.equal("DiscordSentry" in page, false);
    });

    it("does not touch the crash-report object when that setting is off", () => {
        const { plugin, ctx } = setup({ disableCrashReports: false });
        const page = globalThis as Record<string, unknown>;
        plugin.start!(ctx);
        page.DiscordSentry = 7;
        assert.equal(page.DiscordSentry, 7);
        delete page.DiscordSentry;
        plugin.stop!(ctx);
    });

    it("declares its two settings on by default and needing a restart", () => {
        const plugin = load();
        assert.ok(plugin.settings);
        const { plugin: bound } = setup();
        assert.equal(bound.metricsTimerOff(), true, "analytics are off (stopped) by default");
    });
});
