/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { bootStatePath, readBootStateFile, writeBootStateFile } from "../src/main/bootStateFile";
import {
    beginBoot,
    BOOT_FAILURE_LIMIT,
    BootState,
    defaultBootState,
    forgetUnfinishedBoot,
    isQuarantined,
    leaveSafeMode,
    parseBootState,
    quarantinedIds,
    quarantinePlugin,
    recordStartFailure,
    reportCleanBoot,
    serializeBootState,
    setSafeMode,
    START_FAILURE_LIMIT,
    START_FAILURE_WINDOW_MS,
    unquarantinePlugin
} from "../src/shared/bootState";

const HOUR = 60 * 60 * 1000;

describe("parseBootState", () => {
    it("reads what serializeBootState wrote", () => {
        let s = defaultBootState();
        s = quarantinePlugin(s, "Broken", "test", 1234);
        s = setSafeMode(s, true, "because");
        s = { ...s, bootAttempts: 2, lastBootAt: 99, startFailures: { Other: [1, 2] } };
        const { state, problems } = parseBootState(serializeBootState(s));
        assert.deepEqual(problems, []);
        assert.deepEqual(state, s);
    });

    it("gives the defaults, with a problem, for text that is not JSON or not an object", () => {
        for (const text of ["", "{ nope", "[]", "42", "null"]) {
            const { state, problems } = parseBootState(text);
            assert.deepEqual(state, defaultBootState(), text);
            assert.equal(problems.length, 1, text);
        }
    });

    it("gives the defaults for an unknown schema", () => {
        const { state, problems } = parseBootState(JSON.stringify({ schema: 2, safeMode: true }));
        assert.deepEqual(state, defaultBootState());
        assert.match(problems[0], /unknown schema/);
    });

    it("keeps the good fields and reports each bad one", () => {
        const { state, problems } = parseBootState(JSON.stringify({
            schema: 1,
            safeMode: "yes",
            bootAttempts: -3,
            lastBootAt: "later",
            quarantine: [{ id: "Good", reason: "r", at: 5 }, { reason: "no id" }, "text", { id: "Good" }, { id: "AlsoGood" }],
            startFailures: { A: [1, "x", 3], B: "nope" },
            unknownField: true
        }));
        assert.equal(state.safeMode, false);
        assert.equal(state.bootAttempts, 0);
        assert.equal(state.lastBootAt, 0);
        assert.deepEqual(quarantinedIds(state), ["Good", "AlsoGood"]);
        assert.deepEqual(state.startFailures, { A: [1, 3] });
        assert.ok(!("unknownField" in state));
        assert.ok(problems.length >= 5, problems.join("\n"));
    });

    it("forgets the safe mode reason when safe mode is off", () => {
        const { state } = parseBootState(JSON.stringify({ schema: 1, safeMode: false, safeModeReason: "old" }));
        assert.equal(state.safeModeReason, null);
    });

    it("caps absurd counters", () => {
        const { state } = parseBootState(JSON.stringify({ schema: 1, bootAttempts: 1e9 }));
        assert.equal(state.bootAttempts, 1000);
    });
});

describe("beginBoot, reportCleanBoot and safe mode", () => {
    it("counts the boot and records the time", () => {
        const r = beginBoot(defaultBootState(), 500);
        assert.equal(r.state.bootAttempts, 1);
        assert.equal(r.state.lastBootAt, 500);
        assert.equal(r.enteredSafeMode, false);
    });

    it("a clean boot resets the counter, so normal use never reaches the limit", () => {
        let s = defaultBootState();
        for (let i = 0; i < 20; i++) {
            s = beginBoot(s, i).state;
            s = reportCleanBoot(s);
        }
        assert.equal(s.bootAttempts, 0);
        assert.equal(s.safeMode, false);
    });

    it(`turns safe mode on at the start of the boot after ${BOOT_FAILURE_LIMIT} failed boots in a row`, () => {
        let s = defaultBootState();
        for (let i = 1; i <= BOOT_FAILURE_LIMIT; i++) {
            const r = beginBoot(s, i);
            assert.equal(r.enteredSafeMode, false, `boot ${i}`);
            assert.equal(r.state.safeMode, false);
            s = r.state; // never reported clean
        }
        const r = beginBoot(s, 100);
        assert.equal(r.enteredSafeMode, true);
        assert.equal(r.state.safeMode, true);
        assert.match(r.state.safeModeReason ?? "", /3 boots in a row/);
    });

    it("keeps safe mode on after a clean boot until it is turned off on purpose", () => {
        let s = defaultBootState();
        for (let i = 0; i < BOOT_FAILURE_LIMIT + 1; i++) s = beginBoot(s, i).state;
        assert.equal(s.safeMode, true);
        s = reportCleanBoot(s);
        assert.equal(s.bootAttempts, 0);
        assert.equal(s.safeMode, true);
        s = setSafeMode(s, false);
        assert.equal(s.safeMode, false);
        assert.equal(s.safeModeReason, null);
    });

    it("does not announce safe mode again while it is already on", () => {
        let s = setSafeMode(defaultBootState(), true, "manual");
        s = { ...s, bootAttempts: 10 };
        const r = beginBoot(s, 1);
        assert.equal(r.enteredSafeMode, false);
        assert.equal(r.state.safeModeReason, "manual");
    });

    it("never changes the state it was given", () => {
        const s = Object.freeze(defaultBootState());
        assert.doesNotThrow(() => beginBoot(s, 1));
        assert.doesNotThrow(() => reportCleanBoot(s));
        assert.doesNotThrow(() => setSafeMode(s, true, "x"));
    });
});

describe("quarantine", () => {
    it("adds a plugin once, with a reason and a time", () => {
        let s = quarantinePlugin(defaultBootState(), "P", "bad", 10);
        s = quarantinePlugin(s, "P", "again", 20);
        assert.equal(s.quarantine.length, 1);
        assert.deepEqual(s.quarantine[0], { id: "P", reason: "bad", at: 10 });
        assert.ok(isQuarantined(s, "P"));
        assert.ok(!isQuarantined(s, "Q"));
    });

    it("removes a plugin and clears its failure history", () => {
        let s = recordStartFailure(defaultBootState(), "P", 1).state;
        s = quarantinePlugin(s, "P", "bad", 2);
        s = unquarantinePlugin(s, "P");
        assert.ok(!isQuarantined(s, "P"));
        assert.ok(!("P" in s.startFailures));
    });
});

describe("recordStartFailure", () => {
    it(`quarantines a plugin on its ${START_FAILURE_LIMIT}rd failure inside 24 hours, not before`, () => {
        let s = defaultBootState();
        let r = recordStartFailure(s, "P", 0);
        assert.equal(r.quarantined, false);
        r = recordStartFailure(r.state, "P", 1 * HOUR);
        assert.equal(r.quarantined, false);
        assert.ok(!isQuarantined(r.state, "P"));
        r = recordStartFailure(r.state, "P", 2 * HOUR);
        assert.equal(r.quarantined, true);
        assert.ok(isQuarantined(r.state, "P"));
        assert.match(r.state.quarantine[0].reason, /3 times in 24 hours/);
        s = r.state;
        assert.equal(recordStartFailure(s, "P", 3 * HOUR).quarantined, false, "already in quarantine");
    });

    it("forgets failures older than the window", () => {
        let s = defaultBootState();
        s = recordStartFailure(s, "P", 0).state;
        s = recordStartFailure(s, "P", 1).state;
        const r = recordStartFailure(s, "P", START_FAILURE_WINDOW_MS + 5);
        assert.equal(r.quarantined, false);
        assert.deepEqual(r.state.startFailures.P, [START_FAILURE_WINDOW_MS + 5]);
    });

    it("counts each plugin on its own", () => {
        let s = defaultBootState();
        for (const id of ["A", "B", "C"]) s = recordStartFailure(s, id, 1).state;
        assert.deepEqual(quarantinedIds(s), []);
    });
});

describe("boot state file", () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "amiricord-boot-")); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("a missing file is a normal first start: defaults and no problem", () => {
        const r = readBootStateFile(bootStatePath(join(dir, "none")));
        assert.deepEqual(r.state, defaultBootState());
        assert.deepEqual(r.problems, []);
    });

    it("writes, creating the folder, and reads back the same state", () => {
        const path = bootStatePath(join(dir, "a", "b"));
        const state: BootState = quarantinePlugin(setSafeMode(defaultBootState(), true, "x"), "P", "r", 7);
        assert.equal(writeBootStateFile(path, state), null);
        const r = readBootStateFile(path);
        assert.deepEqual(r.problems, []);
        assert.deepEqual(r.state, state);
    });

    it("replaces an old file and leaves no temporary files behind", () => {
        const path = bootStatePath(dir);
        writeBootStateFile(path, defaultBootState());
        writeBootStateFile(path, setSafeMode(defaultBootState(), true, "later"));
        assert.equal(readBootStateFile(path).state.safeMode, true);
        assert.deepEqual(readdirSync(dir).sort(), ["state.json"]);
    });

    it("reads a damaged file as defaults with a problem, and a byte order mark is fine", () => {
        const path = bootStatePath(dir);
        writeFileSync(path, "{ truncated");
        const damaged = readBootStateFile(path);
        assert.deepEqual(damaged.state, defaultBootState());
        assert.equal(damaged.problems.length, 1);

        writeFileSync(path, "﻿" + serializeBootState(setSafeMode(defaultBootState(), true, "bom")));
        assert.equal(readBootStateFile(path).state.safeModeReason, "bom");
    });

    it("reports an error text instead of throwing when the file cannot be written", () => {
        const blocker = join(dir, "blocker");
        writeFileSync(blocker, "a file where a folder is needed");
        const error = writeBootStateFile(bootStatePath(blocker), defaultBootState());
        assert.match(error ?? "", /could not be written/);
        assert.ok(!existsSync(join(blocker, "state.json")));
    });

    it("an unreadable path (a folder instead of a file) is defaults with a problem", () => {
        const path = bootStatePath(dir);
        mkdirSync(path);
        const r = readBootStateFile(path);
        assert.deepEqual(r.state, defaultBootState());
        assert.equal(r.problems.length, 1);
    });
});

describe("forgetUnfinishedBoot and leaveSafeMode", () => {
    it("takes one failed boot away, never below zero", () => {
        assert.equal(forgetUnfinishedBoot({ ...defaultBootState(), bootAttempts: 2 }).bootAttempts, 1);
        const zero = defaultBootState();
        assert.equal(forgetUnfinishedBoot(zero), zero);
    });

    it("leaves safe mode and forgets the failed boots, keeping the quarantine", () => {
        const state = quarantinePlugin({ ...defaultBootState(), safeMode: true, safeModeReason: "x", bootAttempts: 4 }, "P", "r", 1);
        const left = leaveSafeMode(state);
        assert.equal(left.safeMode, false);
        assert.equal(left.safeModeReason, null);
        assert.equal(left.bootAttempts, 0);
        assert.deepEqual(quarantinedIds(left), ["P"]);
    });
});
