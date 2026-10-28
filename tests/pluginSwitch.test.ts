/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginState } from "../src/api/lifecycle";
import { PluginSwitch, SwitchPlugin } from "../src/api/pluginSwitch";

const plugin = (id: string, extra: Partial<SwitchPlugin> = {}): SwitchPlugin => ({ id, core: false, dependencies: [], hasPatches: false, requiresRestart: "auto", ...extra });

/** Fake pieces that keep a log, so a test can see exactly what was done and in which order. */
function setup(plugins: SwitchPlugin[], options: { running?: string[]; choices?: Record<string, boolean>; blocked?: Record<string, string>; prepare?: Record<string, "ready" | "restart">; failToStart?: string[]; stopClean?: boolean; saveError?: string; } = {}) {
    const log: string[] = [];
    const state = new Map<string, PluginState>((options.running ?? []).map(id => [id, "started"]));
    const choices: Record<string, boolean | undefined> = { ...options.choices };
    const errors = new Map<string, string>();
    const sw = new PluginSwitch({
        plugins,
        engineApis: ["engineApi"],
        stateOf: id => state.get(id),
        errorOf: id => errors.get(id) ?? null,
        start: async id => {
            log.push(`start ${id}`);
            await Promise.resolve();
            if (options.failToStart?.includes(id)) { state.set(id, "failed"); errors.set(id, `${id} broke`); return false; }
            state.set(id, "started");
            return true;
        },
        stop: async id => { log.push(`stop ${id}`); await Promise.resolve(); state.set(id, "idle"); return options.stopClean ?? true; },
        prepare: id => { log.push(`prepare ${id}`); return options.prepare?.[id] ?? "ready"; },
        release: id => { log.push(`release ${id}`); },
        choiceOf: id => choices[id],
        setChoice: (id, enabled) => { if (options.saveError) return options.saveError; log.push(`choice ${id}=${enabled}`); choices[id] = enabled; return null; },
        blockedReason: id => options.blocked?.[id]
    });
    return { sw, log, state, choices };
}

describe("PluginSwitch: plugins without patches change on the spot", () => {
    it("turns one on: saves the choice, prepares it, starts it", async () => {
        const t = setup([plugin("A")]);
        assert.deepEqual(await t.sw.toggle("A", true), { status: "applied" });
        assert.deepEqual(t.log, ["choice A=true", "prepare A", "start A"]);
        assert.equal(t.state.get("A"), "started");
    });

    it("turns one off: saves the choice, stops it, lets go of what was attached", async () => {
        const t = setup([plugin("A")], { running: ["A"] });
        assert.deepEqual(await t.sw.toggle("A", false), { status: "applied" });
        assert.deepEqual(t.log, ["choice A=false", "stop A", "release A"]);
    });

    it("says unchanged when it is already running or already stopped, but still saves the choice", async () => {
        const on = setup([plugin("A")], { running: ["A"] });
        assert.deepEqual(await on.sw.toggle("A", true), { status: "unchanged" });
        assert.deepEqual(on.log, ["choice A=true"]);
        const off = setup([plugin("B")]);
        assert.deepEqual(await off.sw.toggle("B", false), { status: "unchanged" });
        assert.deepEqual(off.log, ["choice B=false"]);
    });

    it("starts what the plugin needs first, in order, and leaves them running", async () => {
        const t = setup([plugin("A", { dependencies: ["B", "engineApi"] }), plugin("B", { dependencies: ["C"] }), plugin("C")]);
        assert.deepEqual(await t.sw.toggle("A", true), { status: "applied" });
        assert.deepEqual(t.log, ["choice A=true", "prepare C", "start C", "prepare B", "start B", "prepare A", "start A"]);
    });

    it("does not start again what already runs", async () => {
        const t = setup([plugin("A", { dependencies: ["B"] }), plugin("B")], { running: ["B"] });
        await t.sw.toggle("A", true);
        assert.deepEqual(t.log, ["choice A=true", "prepare A", "start A"]);
    });

    it("waits for a restart when something it needs has patches, without starting anything", async () => {
        const t = setup([plugin("A", { dependencies: ["B"] }), plugin("B", { hasPatches: true })]);
        assert.deepEqual(await t.sw.toggle("A", true), { status: "restart-needed" });
        assert.deepEqual(t.log, ["choice A=true"]);
    });

    it("waits for a restart when something it needs has main-process code, without starting anything", async () => {
        const t = setup([plugin("A", { dependencies: ["B"] }), plugin("B", { hasNative: true })]);
        assert.deepEqual(await t.sw.toggle("A", true), { status: "restart-needed" });
        assert.deepEqual(t.log, ["choice A=true"], "neither A nor B was prepared or started");
    });

    it("waits for a restart when the code turns out to have patches the build did not see", async () => {
        const t = setup([plugin("A")], { prepare: { A: "restart" } });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "restart-needed" });
        assert.deepEqual(t.log, ["choice A=true", "prepare A"]);
    });

    it("reports a start failure with its error, keeping the choice", async () => {
        const t = setup([plugin("A")], { failToStart: ["A"] });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "failed", error: "A broke" });
        assert.equal(t.choices.A, true);
    });

    it("reports a failure of something it needs as its own failure", async () => {
        const t = setup([plugin("A", { dependencies: ["B"] }), plugin("B")], { failToStart: ["B"] });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "failed", error: "B broke" });
        assert.ok(!t.log.includes("start A"));
    });

    it("refuses a dependency cycle and a dependency that does not exist, without hanging", async () => {
        const cycle = setup([plugin("A", { dependencies: ["B"] }), plugin("B", { dependencies: ["A"] })]);
        const result = await cycle.sw.toggle("A", true);
        assert.equal(result.status, "failed");
        assert.match((result as { error: string; }).error, /cycle/);
        const missing = setup([plugin("A", { dependencies: ["Ghost"] })]);
        const second = await missing.sw.toggle("A", true);
        assert.match((second as { error: string; }).error, /does not exist/);
    });

    it("refuses to turn on a plugin that cannot run this session, and saves nothing", async () => {
        const t = setup([plugin("A")], { blocked: { A: "it is in quarantine" } });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "refused", reason: "it is in quarantine" });
        assert.deepEqual(t.log, []);
        const needs = setup([plugin("A", { dependencies: ["B"] }), plugin("B")], { blocked: { B: "safe mode" } });
        const result = await needs.sw.toggle("A", true);
        assert.equal(result.status, "failed");
        assert.match((result as { error: string; }).error, /needs B, which cannot run \(safe mode\)/);
    });

    it("refuses to turn off a plugin that running plugins need, naming them, and saves nothing", async () => {
        const t = setup([plugin("Base"), plugin("U1", { dependencies: ["Base"] }), plugin("U2", { dependencies: ["Base"] }), plugin("Idle", { dependencies: ["Base"] })], { running: ["Base", "U1", "U2"] });
        assert.deepEqual(await t.sw.toggle("Base", false), { status: "refused", reason: "U1, U2 need it and are running" });
        assert.deepEqual(t.log, []);
        assert.deepEqual(await setup([plugin("Base"), plugin("U", { dependencies: ["Base"] })], { running: ["Base", "U"] }).sw.toggle("Base", false), { status: "refused", reason: "U needs it and is running" });
    });

    it("lets a plugin go off once nothing running needs it", async () => {
        const t = setup([plugin("Base"), plugin("U", { dependencies: ["Base"] })], { running: ["Base"] });
        assert.deepEqual(await t.sw.toggle("Base", false), { status: "applied" });
    });

    it("reports a stop with errors as failed, after having stopped and released it", async () => {
        const t = setup([plugin("A")], { running: ["A"], stopClean: false });
        assert.deepEqual(await t.sw.toggle("A", false), { status: "failed", error: "it stopped with errors" });
        assert.deepEqual(t.log, ["choice A=false", "stop A", "release A"]);
    });
});

describe("PluginSwitch: plugins with patches, core plugins and bad requests", () => {
    it("saves the choice and waits for a restart; nothing starts or stops", async () => {
        const t = setup([plugin("P", { hasPatches: true })], { running: ["P"] });
        assert.deepEqual(await t.sw.toggle("P", false), { status: "restart-needed" });
        assert.deepEqual(t.log, ["choice P=false"]);
        assert.equal(t.state.get("P"), "started");
    });

    it("a plugin with main-process code waits for a restart too, because the main process loads it only at start", async () => {
        const t = setup([plugin("N", { hasNative: true })]);
        assert.deepEqual(await t.sw.toggle("N", true), { status: "restart-needed" });
        assert.deepEqual(t.log, ["choice N=true"]);
        assert.notEqual(t.state.get("N"), "started", "nothing started on the spot");
        const own = setup([plugin("O", { hasNative: true, requiresRestart: false })]);
        assert.deepEqual(await own.sw.toggle("O", true), { status: "applied" }, "the plugin's own word still wins");
    });

    it("says unchanged for a plugin with main-process code when the choice is the same as before, and saves nothing again", async () => {
        const t = setup([plugin("N", { hasNative: true })], { choices: { N: true } });
        assert.deepEqual(await t.sw.toggle("N", true), { status: "unchanged" });
        assert.deepEqual(t.log, ["choice N=true"], "the choice is written once, by the check itself, and nothing starts");
    });

    it("says unchanged when the choice is the same as before", async () => {
        const t = setup([plugin("P", { hasPatches: true })], { choices: { P: true } });
        assert.deepEqual(await t.sw.toggle("P", true), { status: "unchanged" });
    });

    it("follows requiresRestart: true forces a restart, false allows the spot even with the word 'auto' absent", async () => {
        const forced = setup([plugin("F", { requiresRestart: true })]);
        assert.deepEqual(await forced.sw.toggle("F", true), { status: "restart-needed" });
        const hot = setup([plugin("H", { requiresRestart: false })]);
        assert.deepEqual(await hot.sw.toggle("H", true), { status: "applied" });
    });

    it("never turns a core plugin off, and a core plugin is always on", async () => {
        const t = setup([plugin("C", { core: true })], { running: ["C"] });
        assert.deepEqual(await t.sw.toggle("C", false), { status: "refused", reason: "core plugins cannot be turned off" });
        assert.deepEqual(await t.sw.toggle("C", true), { status: "unchanged" });
        assert.deepEqual(t.log, []);
    });

    it("refuses an unknown plugin and a choice that cannot be saved", async () => {
        const t = setup([plugin("A")], { saveError: "the settings file is full" });
        assert.deepEqual(await t.sw.toggle("Nope", true), { status: "refused", reason: "there is no plugin called \"Nope\"" });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "refused", reason: "the settings file is full" });
        assert.deepEqual(await t.sw.toggle("A", false), { status: "refused", reason: "the settings file is full" });
        const patched = setup([plugin("P", { hasPatches: true })], { saveError: "no" });
        assert.deepEqual(await patched.sw.toggle("P", true), { status: "refused", reason: "no" });
    });
});

describe("PluginSwitch: one change at a time", () => {
    it("runs two quick requests one after the other, so their starts and stops do not interleave", async () => {
        const t = setup([plugin("A")]);
        const results = await Promise.all([t.sw.toggle("A", true), t.sw.toggle("A", false), t.sw.toggle("A", true)]);
        assert.deepEqual(results.map(r => r.status), ["applied", "applied", "applied"]);
        assert.deepEqual(t.log, [
            "choice A=true", "prepare A", "start A",
            "choice A=false", "stop A", "release A",
            "choice A=true", "prepare A", "start A"
        ]);
    });

    it("starts a plugin only once when it is turned on twice in a row (two clicks, or two screens)", async () => {
        const t = setup([plugin("A")]);
        const results = await Promise.all([t.sw.toggle("A", true), t.sw.toggle("A", true), t.sw.toggle("A", true)]);
        assert.deepEqual(results.map(r => r.status), ["applied", "unchanged", "unchanged"]);
        assert.equal(t.log.filter(line => line === "start A").length, 1);
    });

    it("keeps going after a request that blew up, and never throws", async () => {
        const t = setup([plugin("A")]);
        const original = t.sw as unknown as { run(id: string, enabled: boolean): Promise<unknown>; };
        const real = original.run.bind(t.sw);
        let first = true;
        original.run = async (id, enabled) => { if (first) { first = false; throw new Error("boom"); } return real(id, enabled); };
        assert.deepEqual(await t.sw.toggle("A", true), { status: "failed", error: "boom" });
        assert.deepEqual(await t.sw.toggle("A", true), { status: "applied" });
    });
});
