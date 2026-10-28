/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LifecycleEvent, PluginContext, PluginLifecycle, PluginRuntime } from "../src/api/lifecycle";

type Log = string[];

function runtime(id: string, extra: Partial<PluginRuntime> = {}): PluginRuntime {
    return { id, startAt: "webpackReady", deferrable: false, dependencies: [], ...extra };
}

function setup(runtimes: PluginRuntime[], options: ConstructorParameters<typeof PluginLifecycle>[1] = {}) {
    const events: LifecycleEvent[] = [];
    const lifecycle = new PluginLifecycle(runtimes, { ...options, onEvent: e => { events.push(e); options.onEvent?.(e); } });
    return { lifecycle, events };
}

describe("starting a plugin", () => {
    it("runs start with its own context and ends up started, with an event", async () => {
        let seen = "";
        const { lifecycle, events } = setup([runtime("A", { start: ctx => { seen = ctx.id; } })]);
        assert.equal(lifecycle.stateOf("A"), "idle");
        assert.equal(await lifecycle.startPlugin("A"), true);
        assert.equal(seen, "A");
        assert.equal(lifecycle.stateOf("A"), "started");
        assert.deepEqual(events.map(e => e.type), ["started"]);
    });

    it("waits for an async start", async () => {
        const log: Log = [];
        const { lifecycle } = setup([runtime("A", { start: async () => { await Promise.resolve(); log.push("done"); } })]);
        await lifecycle.startPlugin("A");
        assert.deepEqual(log, ["done"]);
        assert.equal(lifecycle.stateOf("A"), "started");
    });

    it("is idempotent: a started plugin is not started twice", async () => {
        let calls = 0;
        const { lifecycle } = setup([runtime("A", { start: () => { calls++; } })]);
        await lifecycle.startPlugin("A");
        assert.equal(await lifecycle.startPlugin("A"), true);
        assert.equal(calls, 1);
    });

    it("does not throw for a plugin it does not know", async () => {
        const { lifecycle } = setup([]);
        assert.equal(await lifecycle.startPlugin("Nope"), false);
        assert.equal(await lifecycle.stopPlugin("Nope"), false);
        assert.equal(lifecycle.stateOf("Nope"), undefined);
    });
});

describe("a failed start is rolled back completely", () => {
    it("runs the undos registered before the failure, last first, and marks the plugin failed", async () => {
        const log: Log = [];
        const { lifecycle, events } = setup([runtime("A", {
            start: (ctx: PluginContext) => {
                ctx.onDispose(() => { log.push("undo style"); });
                ctx.onDispose(() => { log.push("undo listener"); });
                throw new Error("boom");
            }
        })]);
        assert.equal(await lifecycle.startPlugin("A"), false);
        assert.deepEqual(log, ["undo listener", "undo style"]);
        assert.equal(lifecycle.stateOf("A"), "failed");
        assert.match(lifecycle.errorOf("A") ?? "", /boom/);
        const failure = events.find(e => e.type === "start-failed");
        assert.ok(failure && failure.type === "start-failed" && failure.rolledBack === 2);
    });

    it("treats a rejected promise like a thrown error", async () => {
        const log: Log = [];
        const { lifecycle } = setup([runtime("A", {
            start: async ctx => {
                ctx.onDispose(() => { log.push("undo"); });
                await Promise.resolve();
                throw new Error("late");
            }
        })]);
        assert.equal(await lifecycle.startPlugin("A"), false);
        assert.deepEqual(log, ["undo"]);
        assert.equal(lifecycle.stateOf("A"), "failed");
    });

    it("still runs the remaining undos when one undo fails, and reports it", async () => {
        const log: Log = [];
        const { lifecycle, events } = setup([runtime("A", {
            start: ctx => {
                ctx.onDispose(() => { log.push("first"); });
                ctx.onDispose(() => { throw new Error("undo broke"); });
                throw new Error("boom");
            }
        })]);
        await lifecycle.startPlugin("A");
        assert.deepEqual(log, ["first"]);
        assert.ok(events.some(e => e.type === "dispose-error"));
    });

    it("lets a failed plugin try again later", async () => {
        let attempts = 0;
        const { lifecycle } = setup([runtime("A", { start: () => { if (++attempts === 1) throw new Error("first time"); } })]);
        assert.equal(await lifecycle.startPlugin("A"), false);
        assert.equal(await lifecycle.startPlugin("A"), true);
        assert.equal(lifecycle.stateOf("A"), "started");
        assert.equal(lifecycle.errorOf("A"), null);
    });
});

describe("dependencies", () => {
    it("does not start a plugin whose dependency is not running, and says so", async () => {
        let started = false;
        const { lifecycle } = setup([
            runtime("Base"),
            runtime("Top", { dependencies: ["Base"], start: () => { started = true; } })
        ]);
        assert.equal(await lifecycle.startPlugin("Top"), false);
        assert.equal(started, false);
        assert.match(lifecycle.errorOf("Top") ?? "", /needs Base, which is not running/);
        await lifecycle.startPlugin("Base");
        assert.equal(await lifecycle.startPlugin("Top"), true);
    });

    it("keeps the plugins that depend on a failed one from starting, but not the others", async () => {
        const { lifecycle } = setup([
            runtime("Base", { start: () => { throw new Error("no"); } }),
            runtime("Top", { dependencies: ["Base"] }),
            runtime("Free")
        ]);
        const result = await lifecycle.startStage("webpackReady", ["Base", "Top", "Free"]);
        assert.deepEqual(result.started, ["Free"]);
        assert.deepEqual(result.failed.map(f => f.id), ["Base", "Top"]);
    });

    it("ignores dependencies that are engine APIs and not plugins", async () => {
        const { lifecycle } = setup([runtime("A", { dependencies: ["CommandsAPI"] })]);
        assert.equal(await lifecycle.startPlugin("A"), true);
    });
});

describe("stopping a plugin", () => {
    it("runs its stop, then the undos last first, and allows starting again", async () => {
        const log: Log = [];
        let starts = 0;
        const { lifecycle, events } = setup([runtime("A", {
            start: ctx => { starts++; ctx.onDispose(() => { log.push("undo 1"); }); ctx.onDispose(() => { log.push("undo 2"); }); },
            stop: () => { log.push("stop"); }
        })]);
        await lifecycle.startPlugin("A");
        assert.equal(await lifecycle.stopPlugin("A"), true);
        assert.deepEqual(log, ["stop", "undo 2", "undo 1"]);
        assert.equal(lifecycle.stateOf("A"), "idle");
        assert.ok(events.some(e => e.type === "stopped"));
        assert.equal(await lifecycle.startPlugin("A"), true);
        assert.equal(starts, 2);
    });

    it("runs the undos registered after the start finished", async () => {
        const log: Log = [];
        let register: PluginContext["onDispose"] = () => { };
        const { lifecycle } = setup([runtime("A", { start: ctx => { register = ctx.onDispose; } })]);
        await lifecycle.startPlugin("A");
        register(() => { log.push("late undo"); });
        await lifecycle.stopPlugin("A");
        assert.deepEqual(log, ["late undo"]);
    });

    it("keeps going after failures, runs every undo and reports false", async () => {
        const log: Log = [];
        const { lifecycle, events } = setup([runtime("A", {
            start: ctx => {
                ctx.onDispose(() => { log.push("a"); });
                ctx.onDispose(() => { throw new Error("bad undo"); });
                ctx.onDispose(() => { log.push("c"); });
            },
            stop: () => { throw new Error("bad stop"); }
        })]);
        await lifecycle.startPlugin("A");
        assert.equal(await lifecycle.stopPlugin("A"), false);
        assert.deepEqual(log, ["c", "a"]);
        assert.equal(lifecycle.stateOf("A"), "idle");
        assert.deepEqual(events.filter(e => e.type.endsWith("error")).map(e => e.type), ["stop-error", "dispose-error"]);
    });

    it("does nothing for a plugin that is not started", async () => {
        const { lifecycle } = setup([runtime("A")]);
        assert.equal(await lifecycle.stopPlugin("A"), false);
    });
});

describe("starting a stage", () => {
    it("starts only the plugins of that stage that are in the enabled list, in the given order", async () => {
        const log: Log = [];
        const mk = (id: string, startAt: PluginRuntime["startAt"]) => runtime(id, { startAt, start: () => { log.push(id); } });
        const { lifecycle } = setup([mk("Early", "init"), mk("B", "webpackReady"), mk("A", "webpackReady"), mk("Late", "domReady"), mk("Off", "webpackReady")]);
        const result = await lifecycle.startStage("webpackReady", ["Early", "A", "B", "Late"]);
        assert.deepEqual(log, ["A", "B"]);
        assert.deepEqual(result, { started: ["A", "B"], failed: [], deferred: [] });
        await lifecycle.startStage("init", ["Early", "A", "B", "Late"]);
        assert.equal(lifecycle.stateOf("Early"), "started");
        assert.equal(lifecycle.stateOf("Late"), "idle");
        assert.equal(lifecycle.stateOf("Off"), "idle");
    });

    it("hands control back to the page between slices", async () => {
        let clock = 0;
        const yields: number[] = [];
        const runtimes = ["A", "B", "C", "D", "E"].map(id => runtime(id, { start: () => { clock += 6; } }));
        const { lifecycle } = setup(runtimes, {
            now: () => clock, sliceMs: 10, yieldToEventLoop: async () => { yields.push(clock); }
        });
        await lifecycle.startStage("webpackReady", ["A", "B", "C", "D", "E"]);
        assert.deepEqual(yields, [12, 24]);
    });

    it("does not stop the pass when one plugin throws", async () => {
        const { lifecycle } = setup([runtime("A", { start: () => { throw new Error("x"); } }), runtime("B")]);
        const result = await lifecycle.startStage("webpackReady", ["A", "B"]);
        assert.deepEqual(result.started, ["B"]);
        assert.equal(result.failed[0].id, "A");
        assert.match(result.failed[0].error, /x/);
    });
});

describe("deferred start", () => {
    it("leaves a deferrable plugin for the idle callback, and starts it when that runs", async () => {
        let idle: (() => void) | null = null;
        const { lifecycle } = setup([runtime("Now"), runtime("Later", { deferrable: true })], { defer: work => { idle = work; } });
        const result = await lifecycle.startStage("webpackReady", ["Now", "Later"]);
        assert.deepEqual(result, { started: ["Now"], failed: [], deferred: ["Later"] });
        assert.equal(lifecycle.stateOf("Later"), "idle");
        assert.ok(idle);
        (idle as unknown as () => void)();
        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(lifecycle.stateOf("Later"), "started");
    });

    it("never defers a plugin that another enabled plugin needs", async () => {
        const { lifecycle } = setup([
            runtime("Base", { deferrable: true }),
            runtime("Top", { dependencies: ["Base"] })
        ], { defer: () => { } });
        const result = await lifecycle.startStage("webpackReady", ["Base", "Top"]);
        assert.deepEqual(result.started, ["Base", "Top"]);
        assert.deepEqual(result.deferred, []);
    });

    it("starts deferrable plugins in the normal pass when no idle scheduler is given", async () => {
        const { lifecycle } = setup([runtime("Later", { deferrable: true })]);
        const result = await lifecycle.startStage("webpackReady", ["Later"]);
        assert.deepEqual(result.started, ["Later"]);
    });
});

describe("listeners", () => {
    it("a listener that throws does not break the lifecycle", async () => {
        const { lifecycle } = setup([runtime("A")], { onEvent: () => { throw new Error("listener"); } });
        assert.equal(await lifecycle.startPlugin("A"), true);
        assert.equal(await lifecycle.stopPlugin("A"), true);
    });
});

describe("adding a plugin after the lifecycle was made", () => {
    it("knows it, starts it and stops it like any other, and refuses a second one with the same id", async () => {
        const log: Log = [];
        const { lifecycle } = setup([runtime("A")]);
        assert.equal(lifecycle.has("B"), false);
        assert.equal(lifecycle.add(runtime("B", { start: () => { log.push("start"); }, stop: () => { log.push("stop"); } })), true);
        assert.equal(lifecycle.has("B"), true);
        assert.equal(lifecycle.stateOf("B"), "idle");
        assert.equal(lifecycle.add(runtime("B", { start: () => { log.push("other"); } })), false);
        assert.equal(await lifecycle.startPlugin("B"), true);
        assert.equal(await lifecycle.stopPlugin("B"), true);
        assert.deepEqual(log, ["start", "stop"]);
    });

    it("can start the same plugin again after it stopped", async () => {
        let starts = 0;
        const { lifecycle } = setup([runtime("A", { start: () => { starts++; } })]);
        await lifecycle.startPlugin("A");
        await lifecycle.stopPlugin("A");
        assert.equal(await lifecycle.startPlugin("A"), true);
        assert.equal(starts, 2);
    });
});
