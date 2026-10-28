/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginState } from "../src/api/lifecycle";
import { PluginSwitch, SwitchPlugin, ToggleResult } from "../src/api/pluginSwitch";

const plugin = (id: string, extra: Partial<SwitchPlugin> = {}): SwitchPlugin => ({ id, core: false, dependencies: [], hasPatches: false, requiresRestart: "auto", ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Plugins in `slowStart` do not finish starting until the test calls `finish`, like a plugin that waits for a module of Discord. Plugins in `slowStop` do the same when stopping. */
function setup(plugins: SwitchPlugin[], options: { running?: string[]; slowStart?: string[]; slowStop?: string[]; } = {}) {
    const log: string[] = [];
    const state = new Map<string, PluginState>((options.running ?? []).map(id => [id, "started"]));
    const choices: Record<string, boolean | undefined> = {};
    const errors = new Map<string, string>();
    const startGates = new Map<string, (ok: boolean) => void>();
    const stopGates = new Map<string, () => void>();
    const sw = new PluginSwitch({
        plugins,
        engineApis: ["engineApi"],
        stateOf: id => state.get(id),
        errorOf: id => errors.get(id) ?? null,
        start: async id => {
            log.push(`start ${id}`);
            state.set(id, "starting");
            if (options.slowStart?.includes(id)) {
                const ok = await new Promise<boolean>(resolve => { startGates.set(id, resolve); });
                startGates.delete(id);
                state.set(id, ok ? "started" : "failed");
                if (!ok) errors.set(id, `${id} broke`);
                return ok;
            }
            await Promise.resolve();
            state.set(id, "started");
            return true;
        },
        stop: async id => {
            log.push(`stop ${id}`);
            if (options.slowStop?.includes(id)) await new Promise<void>(resolve => { stopGates.set(id, resolve); });
            state.set(id, "idle");
            return true;
        },
        prepare: id => { log.push(`prepare ${id}`); return "ready"; },
        release: id => { log.push(`release ${id}`); },
        choiceOf: id => choices[id],
        setChoice: (id, enabled) => { log.push(`choice ${id}=${enabled}`); choices[id] = enabled; return null; },
        blockedReason: () => undefined
    });
    return {
        sw, log, state, choices,
        finishStart: (id: string, ok = true) => { startGates.get(id)!(ok); },
        finishStop: (id: string) => { stopGates.get(id)!(); },
        waitingStarts: () => [...startGates.keys()],
        locks: () => (sw as unknown as { locks: Map<string, unknown>; }).locks.size
    };
}

/** Whether a promise has settled, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false;
    void promise.then(() => { done = true; }, () => { done = true; });
    await tick();
    return done;
}

describe("PluginSwitch: different plugins do not wait for each other", () => {
    it("lets other plugins be switched while one plugin is still starting", async () => {
        const t = setup([plugin("Slow"), plugin("B"), plugin("C")], { slowStart: ["Slow"] });
        const slow = t.sw.toggle("Slow", true);
        await tick();
        assert.equal(await settled(slow), false, "the slow plugin is still starting");
        assert.deepEqual(t.waitingStarts(), ["Slow"]);
        assert.deepEqual(await t.sw.toggle("B", true), { status: "applied" });
        assert.deepEqual(await t.sw.toggle("C", true), { status: "applied" });
        assert.deepEqual(await t.sw.toggle("B", false), { status: "applied" });
        assert.equal(await settled(slow), false, "and it still is");
        t.finishStart("Slow");
        assert.deepEqual(await slow, { status: "applied" });
        assert.equal(t.state.get("Slow"), "started");
    });

    it("does not make a plugin that is stopping slowly hold the others", async () => {
        const t = setup([plugin("A"), plugin("B")], { running: ["A"], slowStop: ["A"] });
        const off = t.sw.toggle("A", false);
        await tick();
        assert.deepEqual(await t.sw.toggle("B", true), { status: "applied" });
        assert.equal(await settled(off), false);
        t.finishStop("A");
        assert.deepEqual(await off, { status: "applied" });
    });

    it("answers every other plugin while one is slow, however many there are", async () => {
        const others = Array.from({ length: 25 }, (_, i) => plugin(`P${i}`));
        const t = setup([plugin("Slow"), ...others], { slowStart: ["Slow"] });
        const slow = t.sw.toggle("Slow", true);
        const results = await Promise.all(others.map(p => t.sw.toggle(p.id, true)));
        assert.ok(results.every(result => result.status === "applied"));
        t.finishStart("Slow");
        await slow;
    });

    it("reports a failed slow start to the plugin that asked, and to nobody else", async () => {
        const t = setup([plugin("Slow"), plugin("B")], { slowStart: ["Slow"] });
        const slow = t.sw.toggle("Slow", true);
        await tick();
        assert.deepEqual(await t.sw.toggle("B", true), { status: "applied" });
        t.finishStart("Slow", false);
        assert.deepEqual(await slow, { status: "failed", error: "Slow broke" });
        assert.equal(t.choices.Slow, true, "the choice stays saved, as in every failed start");
    });

    it("keeps going for the others when one change blows up", async () => {
        const t = setup([plugin("A"), plugin("B")]);
        const raw = t.sw as unknown as { run(id: string, enabled: boolean): Promise<unknown>; };
        const real = raw.run.bind(t.sw);
        raw.run = async (id, enabled) => { if (id === "A") throw new Error("boom"); return real(id, enabled); };
        const [a, b] = await Promise.all([t.sw.toggle("A", true), t.sw.toggle("B", true)]);
        assert.deepEqual(a, { status: "failed", error: "boom" });
        assert.deepEqual(b, { status: "applied" });
    });
});

describe("PluginSwitch: changes to the same plugin go one after the other", () => {
    it("makes a click on a plugin that is still starting wait for that start", async () => {
        const t = setup([plugin("Slow")], { slowStart: ["Slow"] });
        const on = t.sw.toggle("Slow", true);
        await tick();
        const off = t.sw.toggle("Slow", false);
        await tick();
        assert.equal(await settled(off), false, "off waits");
        assert.deepEqual(t.log.filter(line => line.startsWith("stop")), [], "nothing is stopped half started");
        t.finishStart("Slow");
        assert.deepEqual(await on, { status: "applied" });
        assert.deepEqual(await off, { status: "applied" });
        assert.deepEqual(t.log, ["choice Slow=true", "prepare Slow", "start Slow", "choice Slow=false", "stop Slow", "release Slow"]);
        assert.equal(t.choices.Slow, false);
    });

    it("starts a plugin once when it is turned on again while it is starting", async () => {
        const t = setup([plugin("Slow")], { slowStart: ["Slow"] });
        const first = t.sw.toggle("Slow", true);
        await tick();
        const second = t.sw.toggle("Slow", true);
        t.finishStart("Slow");
        assert.deepEqual(await first, { status: "applied" });
        assert.deepEqual(await second, { status: "unchanged" });
        assert.equal(t.log.filter(line => line === "start Slow").length, 1);
    });

    it("lets go of its table of waiting changes when they are all done", async () => {
        const t = setup([plugin("A"), plugin("B")]);
        await Promise.all([t.sw.toggle("A", true), t.sw.toggle("A", false), t.sw.toggle("B", true)]);
        await tick();
        assert.equal(t.locks(), 0);
    });
});

describe("PluginSwitch: plugins that need each other, switched at the same time", () => {
    it("starts what two plugins both need only once", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] }), plugin("B", { dependencies: ["Base"] })], { slowStart: ["Base"] });
        const a = t.sw.toggle("A", true);
        const b = t.sw.toggle("B", true);
        const base = t.sw.toggle("Base", true);
        await tick();
        await tick();
        t.finishStart("Base");
        const results = await Promise.all([a, b, base]);
        assert.ok(results.every(result => result.status === "applied" || result.status === "unchanged"), JSON.stringify(results));
        assert.equal(t.log.filter(line => line === "start Base").length, 1);
        assert.deepEqual([t.state.get("A"), t.state.get("B"), t.state.get("Base")], ["started", "started", "started"]);
        assert.ok(t.log.indexOf("start Base") < t.log.indexOf("start A"));
    });

    it("refuses to turn off what a plugin needs while that plugin is waiting to start", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] })], { slowStart: ["Base"] });
        const on = t.sw.toggle("A", true);
        await tick();
        await tick();
        const off = await t.sw.toggle("Base", false);
        assert.deepEqual(off, { status: "refused", reason: "A needs it and is starting" });
        assert.equal(t.choices.Base, undefined, "nothing was saved");
        t.finishStart("Base");
        assert.deepEqual(await on, { status: "applied" });
    });

    it("says running, not starting, when what needs it is already running", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] })], { running: ["Base", "A"] });
        assert.deepEqual(await t.sw.toggle("Base", false), { status: "refused", reason: "A needs it and is running" });
    });

    it("refuses to start a plugin that needs something that is being turned off", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] })], { running: ["Base"], slowStop: ["Base"] });
        const off = t.sw.toggle("Base", false);
        await tick();
        const on = await t.sw.toggle("A", true);
        assert.deepEqual(on, { status: "failed", error: "needs Base, which is being turned off" });
        assert.equal(t.state.get("A"), undefined);
        t.finishStop("Base");
        assert.deepEqual(await off, { status: "applied" });
    });

    it("lets a plugin that needs something be turned on after that was turned off and on again", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] })], { running: ["Base"] });
        assert.deepEqual(await t.sw.toggle("Base", false), { status: "applied" });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "applied" });
        assert.deepEqual([t.state.get("Base"), t.state.get("A")], ["started", "started"]);
    });
});

describe("PluginSwitch: what a caller sees", () => {
    it("gives every caller its own answer, in the order of its plugin's changes", async () => {
        const t = setup([plugin("A")]);
        const answers: ToggleResult["status"][] = [];
        await Promise.all([true, false, true, false].map(async enabled => { answers.push((await t.sw.toggle("A", enabled)).status); }));
        assert.deepEqual(answers, ["applied", "applied", "applied", "applied"]);
        assert.equal(t.state.get("A"), "idle");
    });
});

describe("PluginSwitch: the order of several changes to one plugin, and what is left behind", () => {
    it("makes a change that comes while an earlier one is still being done wait for all the changes before it", async () => {
        const t = setup([plugin("A")], { slowStop: ["A"] });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "applied" });
        const off = t.sw.toggle("A", false);
        await tick();
        const on = t.sw.toggle("A", true);
        await tick();
        assert.equal(await settled(on), false, "the second 'on' waits for the 'off' that is stopping the plugin");
        t.finishStop("A");
        assert.deepEqual(await off, { status: "applied" });
        assert.deepEqual(await on, { status: "applied" });
        assert.deepEqual(t.log.filter(line => /^(start|stop) /.test(line)), ["start A", "stop A", "start A"]);
        assert.equal(t.state.get("A"), "started");
    });

    it("forgets that a plugin was being turned on once that is over, so what it needs can be turned off after it", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] })]);
        assert.deepEqual(await t.sw.toggle("A", true), { status: "applied" });
        assert.deepEqual(await t.sw.toggle("A", false), { status: "applied" });
        assert.deepEqual(await t.sw.toggle("Base", false), { status: "applied" });
    });

    it("tells a plugin that needs something whose start failed that it failed, with the reason", async () => {
        const t = setup([plugin("Base"), plugin("A", { dependencies: ["Base"] })], { slowStart: ["Base"] });
        const base = t.sw.toggle("Base", true);
        await tick();
        const a = t.sw.toggle("A", true);
        await tick();
        await tick();
        t.finishStart("Base", false);
        assert.deepEqual(await base, { status: "failed", error: "Base broke" });
        assert.deepEqual(await a, { status: "failed", error: "Base broke" });
        assert.equal(t.state.get("A"), undefined, "A was not started without what it needs");
    });
});

describe("PluginSwitch: a change that arrives while two others are queued", () => {
    it("waits for the whole line of changes to its plugin, not only for the first", async () => {
        const t = setup([plugin("A")], { slowStart: ["A"], slowStop: ["A"] });
        const on = t.sw.toggle("A", true);
        await tick();
        const off = t.sw.toggle("A", false);
        t.finishStart("A");
        assert.deepEqual(await on, { status: "applied" });
        await tick();
        assert.equal(await settled(off), false, "the 'off' is stopping the plugin");
        const again = t.sw.toggle("A", true);
        await tick();
        assert.equal(await settled(again), false, "the third change waits for the 'off', although the first one is over");
        t.finishStop("A");
        assert.deepEqual(await off, { status: "applied" });
        await tick();
        t.finishStart("A");
        assert.deepEqual(await again, { status: "applied" });
        assert.deepEqual(t.log.filter(line => /^(start|stop) /.test(line)), ["start A", "stop A", "start A"]);
    });
});
