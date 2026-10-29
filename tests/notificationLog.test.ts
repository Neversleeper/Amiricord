/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createNotificationLog, DEFAULT_LOG_SIZE, LOG_SIZE_CHOICES, logSizeOf } from "../src/api/notificationLog";

function setup(start = 1000) {
    let clock = start;
    const log = createNotificationLog(() => clock++);
    return { log };
}

describe("the notification log", () => {
    it("keeps what was shown, newest first, with the plugin, the text and the time", () => {
        const { log } = setup(5000);
        log.add("A", "First", "one", 100);
        log.add("B", "Second", "", 100);
        const list = log.list();
        assert.deepEqual(list.map(entry => [entry.plugin, entry.title, entry.body]), [["B", "Second", ""], ["A", "First", "one"]]);
        assert.deepEqual(list.map(entry => entry.at), [5001, 5000]);
        assert.ok(list[0].id > list[1].id, "a newer one has a larger id");
    });

    it("gives a new array each time, so changing it cannot change the log", () => {
        const { log } = setup();
        log.add("A", "T", "B", 10);
        const first = log.list();
        first.length = 0;
        assert.equal(log.list().length, 1);
    });

    it("drops the oldest ones over the limit, and keeps at least one", () => {
        const { log } = setup();
        for (let i = 1; i <= 5; i++) log.add("A", `n${i}`, "", 3);
        assert.deepEqual(log.list().map(entry => entry.title), ["n5", "n4", "n3"]);
        log.add("A", "n6", "", 0);
        assert.deepEqual(log.list().map(entry => entry.title), ["n6"], "a limit of zero still keeps the newest");
        log.add("A", "n7", "", Number.NaN);
        assert.equal(log.list().length, 2, "a limit that is not a number falls back to the default size");
    });

    it("trims to a smaller size at once, and says nothing when there was nothing to drop", () => {
        const { log } = setup();
        let heard = 0;
        log.subscribe(() => { heard++; });
        for (let i = 1; i <= 4; i++) log.add("A", `n${i}`, "", 50);
        const before = heard;
        log.trim(2);
        assert.deepEqual(log.list().map(entry => entry.title), ["n4", "n3"]);
        assert.equal(heard, before + 1);
        log.trim(2);
        log.trim(10);
        assert.equal(heard, before + 1, "nothing changed, nobody is told");
    });

    it("clears everything, and tells nobody when it was already empty", () => {
        const { log } = setup();
        let heard = 0;
        log.subscribe(() => { heard++; });
        log.clear();
        assert.equal(heard, 0);
        log.add("A", "T", "B", 10);
        log.clear();
        assert.deepEqual(log.list(), []);
        assert.equal(heard, 2);
    });

    it("tells whoever listens about each change, lets one stop listening, and does not let a listener that throws stop the others or the notification", () => {
        const { log } = setup();
        const heard: string[] = [];
        log.subscribe(() => { throw new Error("broken listener"); });
        const stop = log.subscribe(() => { heard.push("a"); });
        log.subscribe(() => { heard.push("b"); });
        assert.doesNotThrow(() => log.add("A", "T", "B", 10));
        assert.deepEqual(heard, ["a", "b"]);
        stop();
        log.add("A", "T2", "B", 10);
        assert.deepEqual(heard, ["a", "b", "b"]);
        assert.equal(log.list().length, 2);
    });

    it("changes its version whenever the list changes, and only then", () => {
        const { log } = setup();
        const start = log.version();
        log.add("A", "T", "B", 10);
        assert.equal(log.version(), start + 1);
        log.clear();
        assert.equal(log.version(), start + 2);
        log.clear();
        assert.equal(log.version(), start + 2);
    });
});

describe("the size of the log", () => {
    it("offers four sizes, and the default is one of them", () => {
        assert.deepEqual([...LOG_SIZE_CHOICES], [25, 50, 100, 200]);
        assert.ok((LOG_SIZE_CHOICES as readonly number[]).includes(DEFAULT_LOG_SIZE));
    });

    it("takes a saved size only when it is one of the choices, and uses the default for anything else", () => {
        for (const size of LOG_SIZE_CHOICES) assert.equal(logSizeOf(size), size);
        for (const bad of [undefined, null, 0, 30, -25, 1e9, "50", {}, [], true, Number.NaN]) assert.equal(logSizeOf(bad), DEFAULT_LOG_SIZE, String(bad));
    });
});
