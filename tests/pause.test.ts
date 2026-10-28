/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makePause, PAUSE_MS } from "../src/main/pause";

function setup(options: { onChangeThrows?: boolean; cancelThrows?: boolean; } = {}) {
    let clock = 1000;
    const timers: Array<{ work: () => void; ms: number; cancelled: boolean; }> = [];
    const changes: boolean[] = [];
    const pause = makePause({
        now: () => clock,
        after: (work, ms) => {
            const timer = { work, ms, cancelled: false };
            timers.push(timer);
            return () => { timer.cancelled = true; if (options.cancelThrows) throw new Error("no timer"); };
        },
        onChange: active => { changes.push(active); if (options.onChangeThrows) throw new Error("listener broke"); }
    });
    return { pause, timers, changes, advance: (ms: number) => { clock += ms; } };
}

describe("pausing protection", () => {
    it("lasts ten minutes, fixed", () => {
        assert.equal(PAUSE_MS, 600_000);
    });

    it("is not paused at first, and says nothing is left", () => {
        const t = setup();
        assert.deepEqual([t.pause.active(), t.pause.remainingMs()], [false, null]);
        assert.deepEqual(t.timers, []);
    });

    it("starts a pause that has ten minutes left and one timer of ten minutes", () => {
        const t = setup();
        assert.equal(t.pause.start(), true);
        assert.deepEqual([t.pause.active(), t.pause.remainingMs()], [true, PAUSE_MS]);
        assert.deepEqual(t.timers.map(timer => timer.ms), [PAUSE_MS]);
        assert.deepEqual(t.changes, [true]);
    });

    it("counts down with the clock", () => {
        const t = setup();
        t.pause.start();
        t.advance(90_000);
        assert.equal(t.pause.remainingMs(), PAUSE_MS - 90_000);
        t.advance(PAUSE_MS - 90_000 - 1);
        assert.equal(t.pause.remainingMs(), 1);
        assert.equal(t.pause.active(), true);
    });

    it("refuses a second pause while one runs, and changes nothing", () => {
        const t = setup();
        t.pause.start();
        t.advance(60_000);
        assert.equal(t.pause.start(), false);
        assert.equal(t.pause.remainingMs(), PAUSE_MS - 60_000, "the time left is not reset");
        assert.equal(t.timers.length, 1);
        assert.deepEqual(t.changes, [true]);
    });

    it("ends by itself when the timer fires, and tells it", () => {
        const t = setup();
        t.pause.start();
        t.advance(PAUSE_MS);
        t.timers[0]!.work();
        assert.deepEqual([t.pause.active(), t.pause.remainingMs()], [false, null]);
        assert.deepEqual(t.changes, [true, false]);
    });

    it("ends by the clock even if the timer never fires", () => {
        const t = setup();
        t.pause.start();
        t.advance(PAUSE_MS);
        assert.deepEqual([t.pause.active(), t.pause.remainingMs()], [false, null]);
        t.advance(PAUSE_MS * 5);
        assert.equal(t.pause.active(), false);
    });

    it("allows a new pause after one ended by the clock, ending the old one first", () => {
        const t = setup();
        t.pause.start();
        t.advance(PAUSE_MS + 5);
        assert.equal(t.pause.start(), true);
        assert.equal(t.pause.remainingMs(), PAUSE_MS);
        assert.equal(t.timers.length, 2);
        assert.equal(t.timers[0]!.cancelled, true, "the old timer is cancelled");
        assert.deepEqual(t.changes, [true, false, true]);
    });

    it("ends at once when asked, cancels its timer and tells it", () => {
        const t = setup();
        t.pause.start();
        assert.equal(t.pause.stop(), true);
        assert.deepEqual([t.pause.active(), t.pause.remainingMs()], [false, null]);
        assert.equal(t.timers[0]!.cancelled, true);
        assert.deepEqual(t.changes, [true, false]);
    });

    it("says there was none to end when it is not paused, and tells nothing", () => {
        const t = setup();
        assert.equal(t.pause.stop(), false);
        assert.deepEqual(t.changes, []);
        t.pause.start();
        t.pause.stop();
        assert.equal(t.pause.stop(), false, "a second stop does nothing");
        assert.deepEqual(t.changes, [true, false]);
    });

    it("ignores a timer that fires after the pause was already ended", () => {
        const t = setup();
        t.pause.start();
        t.pause.stop();
        t.timers[0]!.work();
        assert.deepEqual(t.changes, [true, false], "ended once");
        t.pause.start();
        t.timers[0]!.work();
        assert.equal(t.pause.active(), true, "an old timer does not end the new pause");
    });

    it("never lets a failing listener or a failing timer cancel change the state", () => {
        const t = setup({ onChangeThrows: true, cancelThrows: true });
        assert.equal(t.pause.start(), true);
        assert.equal(t.pause.active(), true);
        assert.equal(t.pause.stop(), true);
        assert.equal(t.pause.active(), false);
    });

    it("never gives a negative time left", () => {
        const t = setup();
        t.pause.start();
        t.advance(PAUSE_MS - 1);
        assert.equal(t.pause.remainingMs(), 1);
    });
});
