/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginState } from "../src/api/lifecycle";
import { buildPluginCards, CardInput, compatibilityOf, PluginSource } from "../src/api/pluginCards";
import { computeEnabledSet } from "../src/shared/enabledSet";
import { emptyPermissions, HIGH_RISK_LABEL } from "../src/shared/manifest";

type BootPart = { safeMode: boolean; quarantine: Array<{ id: string; reason: string; at: number; }>; };
const noBoot: BootPart = { safeMode: false, quarantine: [] };

/** Whether a value holds a function anywhere inside it. */
function holdsFunction(value: unknown): boolean {
    if (typeof value === "function") return true;
    if (value && typeof value === "object") return Object.values(value).some(holdsFunction);
    return false;
}

/** Cards for some plugins, with the start decision made the way the engine makes it. */
function cards(plugins: PluginSource[], options: { choices?: Record<string, boolean>; liveChoices?: Record<string, boolean>; build?: number | null; states?: Record<string, PluginState>; errors?: Record<string, string>; bootState?: BootPart; } = {}) {
    const infos = plugins.map(p => ({ core: false, enabledByDefault: true, dependencies: [] as string[], ...p }));
    const enabledSet = computeEnabledSet({ plugins: infos, startOrder: infos.map(p => p.id), choices: options.choices ?? {}, bootState: options.bootState ?? noBoot });
    const live = options.liveChoices ?? options.choices ?? {};
    const input: CardInput = {
        plugins: infos,
        enabledSet,
        choiceOf: id => live[id],
        build: options.build === undefined ? 650101 : options.build,
        stateOf: id => options.states?.[id] ?? (enabledSet.enabled.includes(id) ? "started" : undefined),
        errorOf: id => options.errors?.[id] ?? null
    };
    return Object.fromEntries(buildPluginCards(input).map(card => [card.id, card]));
}

describe("buildPluginCards: what is shown about a plugin", () => {
    const permissions = { ...emptyPermissions(), network: [{ host: "api.example.com", from: "renderer" as const, why: "looks things up" }] };

    it("carries the description, authors, credits and tags, and copies them so the page cannot change the registry", () => {
        const source: PluginSource = {
            id: "A", name: "Alpha", version: "1.2.3", description: "Does alpha", origin: "vencord", license: "GPL-3.0-or-later",
            authors: [{ name: "Original Author" }], credits: [{ name: "Original Author", license: "GPL-3.0-or-later" }], tags: ["ui"], permissions
        };
        const card = cards([source]).A;
        assert.deepEqual([card.name, card.version, card.description, card.origin, card.license], ["Alpha", "1.2.3", "Does alpha", "vencord", "GPL-3.0-or-later"]);
        assert.deepEqual(card.authors, [{ name: "Original Author" }]);
        card.authors[0].name = "changed";
        card.tags.push("chat");
        assert.equal(source.authors![0].name, "Original Author");
        assert.deepEqual(source.tags, ["ui"]);
    });

    it("fills the gaps of a bare stand-in with neutral values, using the id as the name", () => {
        const card = cards([{ id: "Bare" }]).Bare;
        assert.equal(card.name, "Bare");
        assert.deepEqual([card.authors, card.credits, card.hosts, card.telemetryHosts], [[], [], [], []]);
        assert.equal(card.risk.level, "low");
    });

    it("turns permissions into plain facts: the risk with its reasons and label, the hosts and the telemetry hosts", () => {
        const high = { ...permissions, token: true, telemetry: { send: ["stats.example.com"] } };
        const result = cards([{ id: "Low" }, { id: "Medium", permissions }, { id: "High", permissions: high }]);
        assert.deepEqual(result.Low.risk, { level: "low", label: null, reasons: [] });
        assert.equal(result.Medium.risk.level, "medium");
        assert.equal(result.Medium.risk.label, null);
        assert.deepEqual(result.Medium.hosts, [{ host: "api.example.com", from: "renderer", why: "looks things up" }]);
        assert.equal(result.High.risk.level, "high");
        assert.equal(result.High.risk.label, HIGH_RISK_LABEL);
        assert.ok(result.High.risk.reasons.some(r => r.includes("token")));
        assert.deepEqual(result.High.telemetryHosts, ["stats.example.com"]);
    });

    it("never carries the names of secret settings, nor anything that is not plain data", () => {
        const card = cards([{ id: "A", secrets: ["apiKey"], path: "plugins/A", permissionsHash: "x" } as PluginSource]).A;
        const text = JSON.stringify(card);
        assert.ok(!text.includes("apiKey"));
        assert.ok(!("secrets" in card) && !("path" in card));
        assert.equal(holdsFunction(card), false, "holds no functions, so nothing live reaches the page");
    });

    it("lists the cards in a stable order by id", () => {
        const input = ["C", "A", "B"].map(id => ({ id }));
        assert.deepEqual(Object.keys(cards(input)), ["A", "B", "C"]);
    });
});

describe("when a restart is needed to switch a plugin", () => {
    const live = { Plain: false, Patched: false, Forced: false, Hot: false };
    const plugins: PluginSource[] = [
        { id: "Plain" },
        { id: "Patched", hasPatches: true },
        { id: "Forced", requiresRestart: true },
        { id: "Hot", requiresRestart: false },
        { id: "AutoPatched", requiresRestart: "auto", hasPatches: true }
    ];

    it("is yes for a plugin with patches or one that says so, and no for the rest ('auto' follows the patches)", () => {
        const result = cards(plugins);
        assert.deepEqual(Object.fromEntries(Object.entries(result).map(([id, c]) => [id, c.restartToToggle])),
            { AutoPatched: true, Forced: true, Hot: false, Patched: true, Plain: false });
    });

    it("asks for a restart after a change only for the plugins that need one", () => {
        const result = cards(plugins, { choices: {}, liveChoices: { ...live, AutoPatched: false } });
        assert.deepEqual(Object.fromEntries(Object.entries(result).map(([id, c]) => [id, c.state.restartNeeded])),
            { AutoPatched: true, Forced: true, Hot: false, Patched: true, Plain: false });
    });
});

describe("a plugin with main-process code", () => {
    it("needs a restart to be switched, and says so on its card, unless its own word says otherwise", () => {
        const result = cards([{ id: "Native", hasNative: true }, { id: "Own", hasNative: true, requiresRestart: false }, { id: "Plain" }]);
        assert.deepEqual(Object.fromEntries(Object.entries(result).map(([id, c]) => [id, c.restartToToggle])), { Native: true, Own: false, Plain: false });
    });

    it("asks for a restart after a change", () => {
        const result = cards([{ id: "Native", hasNative: true }], { choices: {}, liveChoices: { Native: false } });
        assert.equal(result.Native.state.restartNeeded, true);
    });
});

describe("compatibility with the Discord build", () => {
    it("is unknown without a build, and compares against the limits that exist", () => {
        const none = { minBuild: null, maxBuild: null };
        assert.equal(compatibilityOf(none, null), "unknown");
        assert.equal(compatibilityOf(none, 1), "ok");
        assert.equal(compatibilityOf({ minBuild: 100, maxBuild: 200 }, 100), "ok");
        assert.equal(compatibilityOf({ minBuild: 100, maxBuild: 200 }, 200), "ok");
        assert.equal(compatibilityOf({ minBuild: 100, maxBuild: 200 }, 99), "discord-too-old");
        assert.equal(compatibilityOf({ minBuild: 100, maxBuild: 200 }, 201), "discord-too-new");
        assert.equal(compatibilityOf({ minBuild: 100, maxBuild: null }, 5000), "ok");
    });

    it("shows up on the card", () => {
        const result = cards([{ id: "Old", discord: { minBuild: 700000, maxBuild: null } }, { id: "Fine" }], { build: 650101 });
        assert.equal(result.Old.compatibility, "discord-too-old");
        assert.equal(result.Fine.compatibility, "ok");
        assert.equal(cards([{ id: "X" }], { build: null }).X.compatibility, "unknown");
    });
});

describe("the state on the card", () => {
    it("says why a plugin runs, and which running plugins need it", () => {
        const result = cards([{ id: "Core", core: true }, { id: "Base" }, { id: "User", dependencies: ["Base"] }, { id: "Off", enabledByDefault: false }], { choices: { Base: false } });
        assert.equal(result.Core.state.reason, "core");
        assert.equal(result.Base.state.reason, "dependency");
        assert.deepEqual(result.Base.state.neededBy, ["User"]);
        assert.equal(result.User.state.reason, "default");
        assert.equal(result.Off.state.reason, undefined);
        assert.equal(result.Off.state.running, false);
        assert.equal(result.User.state.running, true);
    });

    it("needs a restart when the choice now differs from what runs, and not otherwise", () => {
        const plugins = [{ id: "On", hasPatches: true }, { id: "Off", enabledByDefault: false, hasPatches: true }, { id: "Same", hasPatches: true }];
        const before = cards(plugins);
        assert.deepEqual([before.On.state.restartNeeded, before.Off.state.restartNeeded, before.Same.state.restartNeeded], [false, false, false]);
        const after = cards(plugins, { choices: {}, liveChoices: { On: false, Off: true } });
        assert.equal(after.On.state.restartNeeded, true, "turned off, still running");
        assert.equal(after.Off.state.restartNeeded, true, "turned on, not running");
        assert.equal(after.Same.state.restartNeeded, false);
        assert.deepEqual([after.On.state.chosen, after.On.state.wanted, after.Off.state.wanted], [false, false, true]);
    });

    it("never asks for a restart for a core plugin, one kept alive by a dependency, or one that cannot run anyway", () => {
        const plugins = [{ id: "Core", core: true, hasPatches: true }, { id: "Base", hasPatches: true }, { id: "User", dependencies: ["Base"] }, { id: "Bad", hasPatches: true }];
        const live = { Core: false, Base: false };
        const result = cards(plugins, { choices: { Base: false }, liveChoices: live, bootState: { safeMode: false, quarantine: [{ id: "Bad", reason: "", at: 0 }] } });
        assert.equal(result.Core.state.restartNeeded, false);
        assert.equal(result.Core.state.wanted, true, "a core plugin is always wanted");
        assert.equal(result.Base.state.restartNeeded, false);
        assert.equal(result.Bad.state.restartNeeded, false);
        assert.match(result.Bad.state.skipped?.message ?? "", /quarantine/);
    });

    it("reports a plugin that is wanted but skipped in safe mode, with the lifecycle state and error it has", () => {
        const result = cards([{ id: "Core", core: true }, { id: "Plain" }], {
            bootState: { safeMode: true, quarantine: [] },
            states: { Core: "failed" },
            errors: { Core: "boom" }
        });
        assert.equal(result.Plain.state.skipped?.kind, "safe-mode");
        assert.equal(result.Plain.state.running, false);
        assert.equal(result.Core.state.lifecycle, "failed");
        assert.equal(result.Core.state.error, "boom");
        assert.equal(result.Core.state.running, false);
    });
});

describe("whether a plugin has settings", () => {
    it("is carried to the card, and is false for a plugin that does not say", () => {
        const result = cards([{ id: "With", hasSettings: true }, { id: "Without", hasSettings: false }, { id: "Unsaid" }]);
        assert.deepEqual(Object.fromEntries(Object.entries(result).map(([id, c]) => [id, c.hasSettings])), { With: true, Without: false, Unsaid: false });
    });
});
