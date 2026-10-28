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

import { readTextFile, writeTextAtomic } from "../src/main/atomicFile";
import { healthPath, HealthStore, Scheduler } from "../src/main/healthStore";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-health-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A timer that only fires when the test says so. */
function fakeScheduler() {
    const scheduled: Array<{ id: number; work: () => void; ms: number; }> = [];
    let next = 1;
    const scheduler: Scheduler = {
        set: (work, ms) => { const id = next++; scheduled.push({ id, work, ms }); return id; },
        clear: handle => { const i = scheduled.findIndex(s => s.id === handle); if (i >= 0) scheduled.splice(i, 1); }
    };
    return { scheduler, pending: () => scheduled.length, fire: () => scheduled.splice(0).forEach(s => s.work()), delays: () => scheduled.map(s => s.ms) };
}

function makeStore(extra: { ids?: string[]; } = {}) {
    const timer = fakeScheduler();
    let clock = 5000;
    const ids = extra.ids ?? [];
    let counter = 0;
    const store = new HealthStore(healthPath(dir), { now: () => clock++, newSessionId: () => ids[counter++] ?? `id${counter}`, scheduler: timer.scheduler });
    return { store, timer };
}

describe("atomic file helpers", () => {
    it("reads text, a missing file and an error as different results", () => {
        const file = join(dir, "a.txt");
        assert.deepEqual(readTextFile(file), { kind: "missing" });
        writeFileSync(file, "﻿hello");
        assert.deepEqual(readTextFile(file), { kind: "text", text: "hello" });
        mkdirSync(join(dir, "folder"));
        assert.equal(readTextFile(join(dir, "folder")).kind, "error");
    });

    it("writes through a temporary file and leaves nothing behind", () => {
        const file = join(dir, "sub", "b.txt");
        assert.equal(writeTextAtomic(file, "one"), null);
        assert.equal(writeTextAtomic(file, "two"), null);
        assert.equal(readFileSync(file, "utf8"), "two");
        assert.deepEqual(readdirSync(join(dir, "sub")), ["b.txt"]);
    });

    it("returns the error instead of throwing", () => {
        const blocker = join(dir, "blocker");
        writeFileSync(blocker, "a file");
        assert.ok(writeTextAtomic(join(blocker, "x.txt"), "text"));
    });
});

describe("HealthStore", () => {
    it("starts a session on load, even when there is no file yet", () => {
        const { store } = makeStore({ ids: ["c1", "s1"] });
        assert.deepEqual(store.load(647615), []);
        assert.equal(store.state.current.id, "s1");
        assert.equal(store.state.current.discordBuild, 647615);
        assert.equal(store.lastProblem, null);
    });

    it("writes a short time after the last change, and only once for a burst of events", () => {
        const { store, timer } = makeStore();
        store.load();
        timer.fire();
        for (let i = 0; i < 20; i++) store.record({ type: "runtime-error", plugin: "P", source: "s", error: `e${i}` });
        assert.equal(timer.pending(), 1);
        assert.deepEqual(timer.delays(), [5000]);
        timer.fire();
        const saved = JSON.parse(readFileSync(healthPath(dir), "utf8"));
        assert.equal(Object.keys(saved.plugins.P.issues).length, 20);
        assert.equal(timer.pending(), 0);
    });

    it("writes at once on request and when it is disposed", () => {
        const { store, timer } = makeStore();
        store.load();
        store.record({ type: "enabled", plugins: ["P"] });
        assert.equal(existsSync(healthPath(dir)), false);
        assert.equal(store.flushNow(), null);
        assert.equal(existsSync(healthPath(dir)), true);
        assert.equal(timer.pending(), 0);

        store.record({ type: "enabled", plugins: ["P", "Q"] });
        store.dispose();
        assert.deepEqual(JSON.parse(readFileSync(healthPath(dir), "utf8")).current.enabled, ["P", "Q"]);
    });

    it("keeps the previous session after a restart, and the history", () => {
        const first = makeStore({ ids: ["c1", "s1"] }); // the constructor takes the first id, load the second
        first.store.load();
        first.store.record({ type: "enabled", plugins: ["P"] });
        first.store.record({ type: "runtime-error", plugin: "P", source: "start", error: "boom" });
        first.store.dispose();

        const second = makeStore({ ids: ["c2", "s2"] });
        const problems = second.store.load();
        assert.deepEqual(problems, []);
        assert.equal(second.store.state.history.length, 1);
        assert.equal(second.store.state.previous?.plugins.P.issues[0].kind, "runtime-error");
        assert.equal(second.store.state.current.id, "s2");
        assert.deepEqual(second.store.state.plugins, {});
    });

    it("starts empty and says why when the file is damaged", () => {
        writeFileSync(healthPath(dir), "{ broken");
        const { store } = makeStore();
        const problems = store.load();
        assert.equal(problems.length, 1);
        assert.match(store.lastProblem ?? "", /not valid JSON/);
        assert.deepEqual(store.state.history, []);
    });

    it("reports a file that cannot be read, and a write that fails, without throwing", () => {
        mkdirSync(healthPath(dir));
        const { store } = makeStore();
        assert.match(store.load()[0], /could not be read/);
        assert.match(store.flushNow() ?? "", /could not be written/);
        assert.match(store.lastProblem ?? "", /could not be written/);
    });

    it("gives the report of the current session", () => {
        const { store } = makeStore();
        store.load(700000);
        store.record({ type: "enabled", plugins: ["P"] });
        store.record({ type: "start-failed", plugin: "P", error: "Error: no" });
        const report = store.report();
        assert.equal(report.discordBuild, 700000);
        assert.match(report.text, /P: unstable \(1 of 1 sessions broken\)/);
    });
});
