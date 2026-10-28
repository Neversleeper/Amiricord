/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyChange, choicesOf, defaultSettings, isJsonValue, LIMITS, parseSettings, parseSettingsChange, serializeSettings, SettingsData } from "../src/shared/settings";

const data = (plugins: SettingsData["plugins"]): SettingsData => ({ schema: 1, plugins });

describe("isJsonValue", () => {
    it("accepts plain data and refuses what JSON cannot hold or could harm", () => {
        for (const ok of [null, true, 1.5, "x", [], [1, "a", null], { a: { b: [1] } }]) assert.equal(isJsonValue(ok), true, JSON.stringify(ok));
        const bad: unknown[] = [undefined, NaN, Infinity, () => 1, Symbol("x"), 10n, new Date(), new Map(), { a: undefined }, [undefined], Object.create({ inherited: 1 })];
        for (const value of bad) assert.equal(isJsonValue(value), false, String(typeof value));
    });

    it("refuses objects with forbidden keys at any depth, and anything nested too deep", () => {
        assert.equal(isJsonValue(JSON.parse("{\"__proto__\": {\"x\": 1}}")), false);
        assert.equal(isJsonValue({ a: [{ b: JSON.parse("{\"constructor\": 1}") }] }), false);
        assert.equal(isJsonValue({ prototype: 1 }), false);
        let deep: unknown = 1;
        for (let i = 0; i < LIMITS.maxDepth + 2; i++) deep = [deep];
        assert.equal(isJsonValue(deep), false);
    });
});

describe("parseSettings", () => {
    it("reads what serializeSettings wrote", () => {
        const original = data({ B: { enabled: false }, A: { enabled: true, values: { size: 3, name: "x", list: [1, 2] } } });
        const { settings, problems } = parseSettings(serializeSettings(original));
        assert.deepEqual(problems, []);
        assert.deepEqual(settings, original);
    });

    it("writes the same text for the same data, whatever the order it was built in", () => {
        const a = data({ B: { enabled: true }, A: { values: { z: 1, a: 2 } } });
        const b = data({ A: { values: { a: 2, z: 1 } }, B: { enabled: true } });
        assert.equal(serializeSettings(a), serializeSettings(b));
    });

    it("gives the defaults, with a problem, for a text that is not JSON or has the wrong shape", () => {
        for (const text of ["", "{", "[]", "null", "\"x\"", "{\"schema\":2,\"plugins\":{}}", "{\"schema\":1}", "{\"schema\":1,\"plugins\":[]}"]) {
            const { settings, problems } = parseSettings(text);
            assert.deepEqual(settings, defaultSettings(), text);
            assert.equal(problems.length, 1, text);
        }
    });

    it("drops bad entries and keeps the good ones", () => {
        const text = JSON.stringify({
            schema: 1,
            plugins: {
                Good: { enabled: true, values: { ok: 1, "bad key!": 2, "": 3, deep: { a: 1 } } },
                "bad id": { enabled: true },
                "9start": { enabled: true },
                NotAnObject: 5,
                WrongEnabled: { enabled: "yes", values: [1] },
                Empty: {}
            }
        });
        const { settings, problems } = parseSettings(text);
        assert.deepEqual(settings, data({ Good: { enabled: true, values: { ok: 1, deep: { a: 1 } } } }));
        assert.ok(problems.some(p => p.includes("bad key!")));
        assert.ok(problems.some(p => p.includes("bad id")));
        assert.ok(problems.some(p => p.includes("WrongEnabled")));
    });

    it("never lets a saved forbidden key through", () => {
        const text = "{\"schema\":1,\"plugins\":{\"__proto__\":{\"enabled\":true},\"A\":{\"values\":{\"__proto__\":1,\"ok\":{\"constructor\":1}}}}}";
        const { settings } = parseSettings(text);
        assert.deepEqual(settings, defaultSettings());
        assert.equal(({} as Record<string, unknown>).enabled, undefined);
    });

    it("drops a value larger than the limit and a plugin with too many settings", () => {
        const big = { schema: 1, plugins: { A: { values: { huge: "x".repeat(LIMITS.maxValueChars + 1), fine: 1 } } } };
        assert.deepEqual(parseSettings(JSON.stringify(big)).settings, data({ A: { values: { fine: 1 } } }));
        const many: Record<string, number> = {};
        for (let i = 0; i < LIMITS.maxKeysPerPlugin + 5; i++) many[`k${i}`] = i;
        const { settings, problems } = parseSettings(JSON.stringify({ schema: 1, plugins: { A: { values: many } } }));
        assert.equal(Object.keys(settings.plugins.A.values!).length, LIMITS.maxKeysPerPlugin);
        assert.ok(problems.some(p => p.includes("too many")));
    });
});

describe("parseSettingsChange", () => {
    it("accepts each kind of change and keeps only its fields", () => {
        assert.deepEqual(parseSettingsChange({ type: "plugin-enabled", plugin: "A", enabled: true, extra: 1 }), { type: "plugin-enabled", plugin: "A", enabled: true });
        assert.deepEqual(parseSettingsChange({ type: "plugin-enabled", plugin: "A", enabled: null }), { type: "plugin-enabled", plugin: "A", enabled: null });
        assert.deepEqual(parseSettingsChange({ type: "plugin-setting", plugin: "A", key: "k", value: { a: [1] } }), { type: "plugin-setting", plugin: "A", key: "k", value: { a: [1] } });
        assert.deepEqual(parseSettingsChange({ type: "plugin-setting", plugin: "A", key: "k" }), { type: "plugin-setting", plugin: "A", key: "k" });
        assert.deepEqual(parseSettingsChange({ type: "plugin-reset", plugin: "A" }), { type: "plugin-reset", plugin: "A" });
    });

    it("refuses anything malformed or dangerous", () => {
        const bad: unknown[] = [
            null, undefined, 5, "x", [], {}, { type: "nope", plugin: "A" }, { type: "plugin-enabled", plugin: "A" }, { type: "plugin-enabled", plugin: "A", enabled: "yes" },
            { type: "plugin-enabled", plugin: "bad id", enabled: true }, { type: "plugin-enabled", plugin: "__proto__", enabled: true },
            { type: "plugin-setting", plugin: "A", key: "__proto__", value: 1 }, { type: "plugin-setting", plugin: "A", key: "bad key", value: 1 },
            { type: "plugin-setting", plugin: "A", value: 1 }, { type: "plugin-setting", plugin: "A", key: "k", value: () => 1 },
            { type: "plugin-setting", plugin: "A", key: "k", value: "x".repeat(LIMITS.maxValueChars + 1) },
            { type: "plugin-setting", plugin: "A", key: "k", value: JSON.parse("{\"__proto__\":1}") },
            { type: "plugin-reset" }, { type: 5, plugin: "A" }
        ];
        for (const value of bad) assert.equal(parseSettingsChange(value), null, JSON.stringify(value));
    });
});

describe("applyChange", () => {
    it("turns a plugin on, off, and back to its default, removing empty entries", () => {
        let state = defaultSettings();
        state = applyChange(state, { type: "plugin-enabled", plugin: "A", enabled: true }).settings;
        assert.deepEqual(state, data({ A: { enabled: true } }));
        state = applyChange(state, { type: "plugin-enabled", plugin: "A", enabled: false }).settings;
        assert.deepEqual(state, data({ A: { enabled: false } }));
        state = applyChange(state, { type: "plugin-enabled", plugin: "A", enabled: null }).settings;
        assert.deepEqual(state, defaultSettings());
    });

    it("sets and removes a setting without touching the plugin's choice or other settings", () => {
        let state = data({ A: { enabled: true, values: { x: 1 } } });
        state = applyChange(state, { type: "plugin-setting", plugin: "A", key: "y", value: [1, 2] }).settings;
        assert.deepEqual(state, data({ A: { enabled: true, values: { x: 1, y: [1, 2] } } }));
        state = applyChange(state, { type: "plugin-setting", plugin: "A", key: "x" }).settings;
        state = applyChange(state, { type: "plugin-setting", plugin: "A", key: "y" }).settings;
        assert.deepEqual(state, data({ A: { enabled: true } }));
        state = applyChange(state, { type: "plugin-enabled", plugin: "A", enabled: null }).settings;
        assert.deepEqual(state, defaultSettings());
    });

    it("resets one plugin only", () => {
        const state = data({ A: { enabled: true, values: { x: 1 } }, B: { enabled: false } });
        assert.deepEqual(applyChange(state, { type: "plugin-reset", plugin: "A" }).settings, data({ B: { enabled: false } }));
    });

    it("never modifies the object it was given", () => {
        const state = data({ A: { enabled: true, values: { x: 1 } } });
        const before = JSON.stringify(state);
        applyChange(state, { type: "plugin-setting", plugin: "A", key: "x", value: 2 });
        applyChange(state, { type: "plugin-reset", plugin: "A" });
        assert.equal(JSON.stringify(state), before);
    });

    it("refuses a change that would pass a limit, and keeps the old settings", () => {
        const values: Record<string, number> = {};
        for (let i = 0; i < LIMITS.maxKeysPerPlugin; i++) values[`k${i}`] = i;
        const full = data({ A: { values } });
        const result = applyChange(full, { type: "plugin-setting", plugin: "A", key: "one-more", value: 1 });
        assert.match(result.error ?? "", /too many/);
        assert.equal(result.settings, full);

        // Many values near the per-value limit pass the per-value check but not the file limit.
        const chunky = data({});
        let current = chunky;
        let refused: string | null = null;
        for (let p = 0; p < 40 && !refused; p++) {
            for (let k = 0; k < 5 && !refused; k++) {
                const step = applyChange(current, { type: "plugin-setting", plugin: `P${p}`, key: `k${k}`, value: "x".repeat(LIMITS.maxValueChars - 100) });
                if (step.error) refused = step.error; else current = step.settings;
            }
        }
        assert.match(refused ?? "", /too large/);
    });
});

describe("choicesOf", () => {
    it("lists only the plugins with a choice", () => {
        assert.deepEqual(choicesOf(data({ A: { enabled: true }, B: { values: { x: 1 } }, C: { enabled: false } })), { A: true, C: false });
        assert.deepEqual(choicesOf(defaultSettings()), {});
    });
});
