/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultBootState, quarantinePlugin, setSafeMode } from "../src/shared/bootState";
import { computeEnabledSet, EnabledSetInput, PluginInfo } from "../src/shared/enabledSet";

const plugin = (id: string, extra: Partial<PluginInfo> = {}): PluginInfo => ({ id, core: false, enabledByDefault: false, dependencies: [], ...extra });

function run(plugins: PluginInfo[], options: Partial<Omit<EnabledSetInput, "plugins">> = {}) {
    return computeEnabledSet({
        plugins,
        startOrder: options.startOrder ?? plugins.map(p => p.id),
        choices: options.choices ?? {},
        bootState: options.bootState ?? defaultBootState(),
        engineApis: options.engineApis
    });
}

describe("computeEnabledSet: what is wanted", () => {
    it("runs nothing when nothing is chosen and nothing is on by default", () => {
        const r = run([plugin("A"), plugin("B")]);
        assert.deepEqual(r.enabled, []);
        assert.deepEqual(r.skipped, {});
    });

    it("runs a plugin the user chose, and one that is on by default unless the user turned it off", () => {
        const plugins = [plugin("A"), plugin("B", { enabledByDefault: true }), plugin("C", { enabledByDefault: true })];
        const r = run(plugins, { choices: { A: true, C: false } });
        assert.deepEqual(r.enabled, ["A", "B"]);
        assert.deepEqual(r.why.A, { reason: "chosen", neededBy: [], overridesChoice: false });
        assert.equal(r.why.B.reason, "default");
    });

    it("always runs core plugins, even if the user turned them off", () => {
        const r = run([plugin("NoTrack", { core: true })], { choices: { NoTrack: false } });
        assert.deepEqual(r.enabled, ["NoTrack"]);
        assert.equal(r.why.NoTrack.reason, "core");
    });

    it("ignores choices for plugins that do not exist, and says so", () => {
        const r = run([plugin("A")], { choices: { Ghost: true } });
        assert.deepEqual(r.enabled, []);
        assert.match(r.problems[0], /unknown plugin "Ghost"/);
    });
});

describe("computeEnabledSet: dependencies", () => {
    it("pulls in the plugins that are needed, without anyone choosing them", () => {
        const plugins = [plugin("Base"), plugin("Mid", { dependencies: ["Base"] }), plugin("Top", { dependencies: ["Mid"] })];
        const r = run(plugins, { choices: { Top: true } });
        assert.deepEqual(r.enabled, ["Base", "Mid", "Top"]);
        assert.deepEqual(r.why.Base, { reason: "dependency", neededBy: ["Mid"], overridesChoice: false });
        assert.deepEqual(r.why.Mid.neededBy, ["Top"]);
    });

    it("reports when a dependency overrides the user's choice to turn a plugin off", () => {
        const plugins = [plugin("Base"), plugin("Top", { dependencies: ["Base"] })];
        const r = run(plugins, { choices: { Top: true, Base: false } });
        assert.deepEqual(r.enabled, ["Base", "Top"]);
        assert.equal(r.why.Base.overridesChoice, true);
    });

    it("keeps the chosen reason when a plugin is both chosen and needed", () => {
        const plugins = [plugin("Base"), plugin("Top", { dependencies: ["Base"] })];
        const r = run(plugins, { choices: { Top: true, Base: true } });
        assert.equal(r.why.Base.reason, "chosen");
        assert.deepEqual(r.why.Base.neededBy, ["Top"]);
        assert.equal(r.why.Base.overridesChoice, false);
    });

    it("does not count a dependant that does not run in `neededBy`", () => {
        const plugins = [plugin("Base"), plugin("Off", { dependencies: ["Base"] }), plugin("On", { dependencies: ["Base"] })];
        const r = run(plugins, { choices: { On: true } });
        assert.deepEqual(r.why.Base.neededBy, ["On"]);
    });

    it("treats engine APIs as provided, not as plugins", () => {
        const plugins = [plugin("A", { dependencies: ["CommandsAPI"] })];
        const r = run(plugins, { choices: { A: true }, engineApis: ["CommandsAPI"] });
        assert.deepEqual(r.enabled, ["A"]);
        assert.deepEqual(r.skipped, {});
    });

    it("skips a plugin whose dependency does not exist", () => {
        const r = run([plugin("A", { dependencies: ["Nope"] })], { choices: { A: true } });
        assert.deepEqual(r.enabled, []);
        assert.equal(r.skipped.A.kind, "missing-dependency");
        assert.equal(r.skipped.A.dependency, "Nope");
    });

    it("never pulls in the dependencies of a plugin that cannot run", () => {
        const plugins = [plugin("Base"), plugin("A", { dependencies: ["Base", "Nope"] })];
        const r = run(plugins, { choices: { A: true } });
        assert.deepEqual(r.enabled, []);
    });

    it("survives a dependency cycle by skipping instead of looping, and reports it", () => {
        const plugins = [plugin("A", { dependencies: ["B"] }), plugin("B", { dependencies: ["A"] })];
        const r = run(plugins, { choices: { A: true } });
        assert.deepEqual(r.enabled, []);
        assert.ok(r.problems.some(p => p.includes("cycle")));
        assert.ok(r.skipped.A);
    });
});

describe("computeEnabledSet: quarantine", () => {
    const quarantineOf = (...ids: string[]) => ids.reduce((s, id) => quarantinePlugin(s, id, "test", 1), defaultBootState());

    it("keeps a quarantined plugin out, with the reason", () => {
        const r = run([plugin("A")], { choices: { A: true }, bootState: quarantineOf("A") });
        assert.deepEqual(r.enabled, []);
        assert.equal(r.skipped.A.kind, "quarantined");
    });

    it("keeps out every plugin that needs a quarantined one, down the whole chain", () => {
        const plugins = [plugin("C"), plugin("B", { dependencies: ["C"] }), plugin("A", { dependencies: ["B"] }), plugin("Free")];
        const r = run(plugins, { choices: { A: true, B: true, Free: true }, bootState: quarantineOf("C") });
        assert.deepEqual(r.enabled, ["Free"]);
        assert.equal(r.skipped.B.kind, "dependency-unavailable");
        assert.equal(r.skipped.B.dependency, "C");
        assert.equal(r.skipped.A.kind, "dependency-unavailable");
        assert.equal(r.skipped.A.dependency, "B");
    });

    it("applies to core plugins too, and reports a problem", () => {
        const r = run([plugin("NoTrack", { core: true })], { bootState: quarantineOf("NoTrack") });
        assert.deepEqual(r.enabled, []);
        assert.ok(r.problems.some(p => p.includes("core plugin") && p.includes("NoTrack")));
    });

    it("names a quarantined plugin that is not in the registry", () => {
        const r = run([plugin("A")], { bootState: quarantineOf("Old") });
        assert.ok(r.problems.some(p => p.includes('"Old"')));
    });
});

describe("computeEnabledSet: safe mode", () => {
    const safe = () => setSafeMode(defaultBootState(), true, "test");

    it("runs only core plugins, and says why the others do not run", () => {
        const plugins = [plugin("NoTrack", { core: true }), plugin("Settings", { core: true }), plugin("A", { enabledByDefault: true }), plugin("B")];
        const r = run(plugins, { choices: { B: true }, bootState: safe() });
        assert.deepEqual(r.enabled, ["NoTrack", "Settings"]);
        assert.equal(r.skipped.A.kind, "safe-mode");
        assert.equal(r.skipped.B.kind, "safe-mode");
    });

    it("still runs what a core plugin needs", () => {
        const plugins = [plugin("Base"), plugin("Settings", { core: true, dependencies: ["Base"] })];
        const r = run(plugins, { bootState: safe() });
        assert.deepEqual(r.enabled, ["Base", "Settings"]);
        assert.equal(r.why.Base.reason, "dependency");
    });

    it("does not list plugins nobody wanted as skipped", () => {
        const r = run([plugin("A")], { bootState: safe() });
        assert.deepEqual(r.skipped, {});
    });
});

describe("computeEnabledSet: order and purity", () => {
    it("follows the start order, whatever the order of the plugins in the list", () => {
        const plugins = [plugin("Top", { dependencies: ["Base"] }), plugin("Base")];
        const r = run(plugins, { startOrder: ["Base", "Top"], choices: { Top: true } });
        assert.deepEqual(r.enabled, ["Base", "Top"]);
    });

    it("still returns a plugin that is missing from the start order, and reports it", () => {
        const r = run([plugin("A")], { startOrder: [], choices: { A: true } });
        assert.deepEqual(r.enabled, ["A"]);
        assert.ok(r.problems.some(p => p.includes("start order")));
    });

    it("does not change its input and gives the same answer every time", () => {
        const plugins = Object.freeze([plugin("Base"), plugin("Top", { dependencies: ["Base"] })].map(p => Object.freeze({ ...p, dependencies: Object.freeze([...p.dependencies]) as string[] })));
        const input: EnabledSetInput = {
            plugins,
            startOrder: Object.freeze(["Base", "Top"]),
            choices: Object.freeze({ Top: true }),
            bootState: Object.freeze(defaultBootState())
        };
        const a = computeEnabledSet(input);
        const b = computeEnabledSet(input);
        assert.deepEqual(a, b);
    });
});
