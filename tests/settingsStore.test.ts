/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { settingsPath, SettingsStore } from "../src/main/settingsStore";
import { defaultSettings, serializeSettings } from "../src/shared/settings";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-settings-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A timer that only fires when the test says so. */
function fakeScheduler() {
    const scheduled: Array<{ id: number; work: () => void; ms: number; }> = [];
    let next = 1;
    return {
        scheduler: {
            set: (work: () => void, ms: number) => { const id = next++; scheduled.push({ id, work, ms }); return id; },
            clear: (handle: unknown) => { const i = scheduled.findIndex(s => s.id === handle); if (i >= 0) scheduled.splice(i, 1); }
        },
        pending: () => scheduled.length,
        fire: () => scheduled.splice(0).forEach(s => s.work()),
        delays: () => scheduled.map(s => s.ms)
    };
}

const make = () => {
    const timer = fakeScheduler();
    const store = new SettingsStore(settingsPath(dir), { scheduler: timer.scheduler });
    return { store, timer };
};

const on = (plugin: string, enabled: boolean | null = true) => ({ type: "plugin-enabled", plugin, enabled });

describe("SettingsStore", () => {
    it("starts with the defaults when there is no file, and writes nothing until something changes", () => {
        const { store, timer } = make();
        assert.deepEqual(store.load(), []);
        assert.deepEqual(store.settings, defaultSettings());
        assert.equal(timer.pending(), 0);
        store.dispose();
        assert.equal(existsSync(settingsPath(dir)), false);
    });

    it("applies a change at once in memory and writes the file a moment later, once for many changes", () => {
        const { store, timer } = make();
        store.load();
        assert.equal(store.change(on("A")), null);
        assert.equal(store.change(on("B", false)), null);
        assert.equal(store.change({ type: "plugin-setting", plugin: "A", key: "size", value: 3 }), null);
        assert.deepEqual(store.settings.plugins.A, { enabled: true, values: { size: 3 } });
        assert.equal(existsSync(settingsPath(dir)), false, "not written yet");
        assert.equal(timer.pending(), 1, "one write is waiting, not three");
        assert.deepEqual(timer.delays(), [1000]);

        timer.fire();
        assert.equal(readFileSync(settingsPath(dir), "utf8"), serializeSettings(store.settings));
        assert.deepEqual(readdirSync(dir), ["settings.json"], "no temporary file is left");
    });

    it("reads back what it wrote in a new session", () => {
        const first = make();
        first.store.load();
        first.store.change(on("A"));
        first.store.change({ type: "plugin-setting", plugin: "A", key: "name", value: "x" });
        first.store.dispose();

        const second = make();
        assert.deepEqual(second.store.load(), []);
        assert.deepEqual(second.store.settings, first.store.settings);
    });

    it("refuses a bad change, keeps the old settings and writes nothing", () => {
        const { store, timer } = make();
        store.load();
        const before = store.settings;
        const bad = [null, "x", { type: "plugin-enabled", plugin: "__proto__", enabled: true }, { type: "plugin-setting", plugin: "A", key: "k", value: () => 1 }, { type: "nope", plugin: "A" }];
        for (const payload of bad) assert.match(store.change(payload) ?? "", /refused/);
        assert.equal(store.settings, before);
        assert.equal(timer.pending(), 0);
    });

    it("uses the defaults and says why when the file is damaged, and keeps the good entries of a half-good file", () => {
        writeFileSync(settingsPath(dir), "{ not json");
        const damaged = make();
        const problems = damaged.store.load();
        assert.equal(problems.length, 1);
        assert.deepEqual(damaged.store.settings, defaultSettings());
        assert.equal(damaged.store.lastProblem, problems[0]);

        writeFileSync(settingsPath(dir), JSON.stringify({ schema: 1, plugins: { Good: { enabled: true }, "bad id": { enabled: true } } }));
        const half = make();
        assert.equal(half.store.load().length, 1);
        assert.deepEqual(half.store.settings.plugins, { Good: { enabled: true } });
    });

    it("uses the defaults when the file cannot be read at all", () => {
        mkdirSync(settingsPath(dir));
        const { store } = make();
        const problems = store.load();
        assert.match(problems[0], /could not be read/);
        assert.deepEqual(store.settings, defaultSettings());
    });

    it("reports a write problem as text, keeps the change in memory and tries again at the next flush", () => {
        const { store } = make();
        store.load();
        mkdirSync(settingsPath(dir));
        store.change(on("A"));
        assert.match(store.flushNow() ?? "", /could not be written/);
        assert.deepEqual(store.settings.plugins.A, { enabled: true });
        rmSync(settingsPath(dir), { recursive: true });
        assert.equal(store.flushNow(), null);
        assert.equal(JSON.parse(readFileSync(settingsPath(dir), "utf8")).plugins.A.enabled, true);
        assert.equal(store.lastProblem, null);
    });

    it("writes on dispose what is still waiting", () => {
        const { store, timer } = make();
        store.load();
        store.change(on("A"));
        store.dispose();
        assert.equal(timer.pending(), 0);
        assert.equal(JSON.parse(readFileSync(settingsPath(dir), "utf8")).plugins.A.enabled, true);
    });
});
