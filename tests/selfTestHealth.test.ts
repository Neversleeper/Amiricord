/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReport, defaultHealthState, HealthEvent, parseHealthState, recordEvent, serializeHealthState, startSession } from "../src/shared/health";
import { parseHealthEvent } from "../src/shared/ipc";

const selfTest = (name: string, status: "pass" | "fail" | "not-seen", detail = "d", ms = 10): HealthEvent => ({ type: "self-test", name, status, detail, ms });
const fresh = () => defaultHealthState("s1", 1000);

describe("recording the privacy self-test", () => {
    it("keeps each result under its name in the session", () => {
        let state = recordEvent(fresh(), selfTest("super-properties", "pass", "ok", 40), 2000);
        state = recordEvent(state, selfTest("first-gateway-message", "pass", "ok too", 3800), 3000);
        assert.deepEqual(state.current.selfTests, [
            { name: "super-properties", status: "pass", detail: "ok", ms: 40 },
            { name: "first-gateway-message", status: "pass", detail: "ok too", ms: 3800 }
        ]);
    });

    it("keeps the worst answer for a check: a fail is never replaced by a pass, a pass never by not seen", () => {
        let state = recordEvent(fresh(), selfTest("a", "not-seen"), 1);
        state = recordEvent(state, selfTest("a", "pass"), 2);
        assert.equal(state.current.selfTests![0].status, "pass");
        state = recordEvent(state, selfTest("a", "not-seen"), 3);
        assert.equal(state.current.selfTests![0].status, "pass");
        state = recordEvent(state, selfTest("a", "fail"), 4);
        assert.equal(state.current.selfTests![0].status, "fail");
        state = recordEvent(state, selfTest("a", "pass"), 5);
        assert.equal(state.current.selfTests![0].status, "fail");
    });

    it("redacts and shortens what it stores, and keeps at most eight checks", () => {
        let state = recordEvent(fresh(), selfTest("a", "fail", "user C:/Users/Someone/x 123456789012345678 and " + "z".repeat(900)), 1);
        const detail = state.current.selfTests![0].detail;
        assert.ok(!detail.includes("Someone") && !detail.includes("123456789012345678"));
        assert.ok(detail.length <= 300);
        for (let i = 0; i < 12; i++) state = recordEvent(state, selfTest(`check-${i}`, "pass"), 2);
        assert.equal(state.current.selfTests!.length, 8);
    });

    it("never changes the state it was given, and a new session starts with none", () => {
        const before = fresh();
        recordEvent(before, selfTest("a", "pass"), 5);
        assert.equal(before.current.selfTests, undefined);
        const state = recordEvent(before, selfTest("a", "pass"), 5);
        const next = startSession(state, "s2", 9000);
        assert.equal(next.current.selfTests, undefined);
        assert.equal(next.history[0].selfTests![0].name, "a", "the earlier session keeps its result, so a change shows between starts");
    });
});

describe("the report", () => {
    it("lists each result, and says loudly when one failed", () => {
        let state = recordEvent(fresh(), selfTest("super-properties", "pass", "has_client_mods is false in Discord's properties", 40), 1);
        state = recordEvent(state, selfTest("first-gateway-message", "not-seen", "no gateway send carried the key", 60000), 2);
        let report = buildReport(state);
        assert.equal(report.selfTests.length, 2);
        assert.match(report.text, /Privacy self-test super-properties: pass after 40 ms/);
        assert.match(report.text, /Privacy self-test first-gateway-message: not-seen after 60000 ms/);
        assert.ok(!report.text.includes("PRIVACY SELF-TEST FAILED"));

        state = recordEvent(state, selfTest("first-gateway-message", "fail", "TRUE in send number 3"), 3);
        report = buildReport(state);
        assert.match(report.text, /PRIVACY SELF-TEST FAILED: Discord was told this client has mods\./);
    });

    it("has nothing about the self-test when it did not run", () => {
        const report = buildReport(fresh());
        assert.deepEqual(report.selfTests, []);
        assert.ok(!report.text.includes("self-test"));
    });
});

describe("storage", () => {
    it("reads back what it wrote", () => {
        const state = recordEvent(fresh(), selfTest("a", "fail", "x", 7), 1);
        const read = parseHealthState(serializeHealthState(state), "s9", 5);
        assert.deepEqual(read.state.current.selfTests, [{ name: "a", status: "fail", detail: "x", ms: 7 }]);
        assert.deepEqual(read.problems, []);
    });

    it("drops damaged entries and keeps the rest", () => {
        const state = recordEvent(fresh(), selfTest("a", "pass"), 1);
        const raw = JSON.parse(serializeHealthState(state));
        raw.current.selfTests.push({ name: "b", status: "great", detail: "x", ms: 1 }, { name: 5 }, "oops", { name: "c", status: "pass", detail: "x", ms: "slow" });
        const read = parseHealthState(JSON.stringify(raw), "s9", 5);
        assert.deepEqual(read.state.current.selfTests!.map(t => t.name), ["a"]);
    });

    it("reads an older file with no self-test data", () => {
        const raw = JSON.parse(serializeHealthState(fresh()));
        delete raw.current.selfTests;
        assert.equal(parseHealthState(JSON.stringify(raw), "s9", 5).state.current.selfTests, undefined);
    });
});

describe("the event as it comes from the page", () => {
    it("is accepted with only its own fields", () => {
        const event = parseHealthEvent({ type: "self-test", name: "super-properties", status: "pass", detail: "ok", ms: 12, token: "SECRET", extra: 1 });
        assert.deepEqual(event, { type: "self-test", name: "super-properties", status: "pass", detail: "ok", ms: 12 });
    });

    it("is refused when anything is wrong", () => {
        const good = { type: "self-test", name: "super-properties", status: "pass", detail: "ok", ms: 12 };
        for (const bad of [
            { ...good, name: "../x" }, { ...good, name: "Upper" }, { ...good, name: "a".repeat(41) }, { ...good, status: "great" },
            { ...good, detail: 5 }, { ...good, detail: "x".repeat(501) }, { ...good, ms: "12" }, { ...good, ms: Infinity }, { type: "self-test" }
        ]) assert.equal(parseHealthEvent(bad), null);
    });
});
