/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildReport,
    defaultHealthState,
    HealthEvent,
    HealthState,
    HISTORY_WINDOW,
    isBroken,
    MAX_ISSUES_PER_PLUGIN,
    MAX_TEXT_LENGTH,
    parseHealthState,
    PatchEventReplacement,
    recordEvent,
    redact,
    serializeHealthState,
    stabilityOf,
    startSession
} from "../src/shared/health";

const fresh = () => defaultHealthState("s0", 1000, 647615);

function record(state: HealthState, ...events: HealthEvent[]) {
    return events.reduce((s, e, i) => recordEvent(s, e, 2000 + i), state);
}

const patchEvent = (extra: Partial<Extract<HealthEvent, { type: "patch"; }>> = {}): HealthEvent => ({
    type: "patch", plugin: "P", find: "anchor", moduleId: "1", required: true, status: "failed",
    replacements: [{ match: "/x/", status: "no-effect" }], ...extra
});

/** A state with `broken` of the last `total` sessions broken for plugin P, the last one being the current session. */
function withHistory(total: number, broken: number): HealthState {
    let s = defaultHealthState("s0", 0);
    for (let i = 0; i < total; i++) {
        if (i > 0) s = startSession(s, `s${i}`, i * 10);
        s = recordEvent(s, { type: "enabled", plugins: ["P"] }, i * 10);
        if (i < broken) s = recordEvent(s, { type: "runtime-error", plugin: "P", source: "start", error: "x" }, i * 10);
    }
    return s;
}

describe("redact", () => {
    it("hides Discord ids, tokens, e-mail addresses and Windows user names", () => {
        const text = redact("user 1554284154009682032 mailed me@example.com from C:\\Users\\jdoe\\AppData and c:/users/Someone/x token " + ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "GabcDE", "abcdefghijklmnopqrstuvwxyz1"].join("."));
        assert.ok(!text.includes("1554284154009682032"));
        assert.ok(!text.includes("me@example.com"));
        assert.ok(!text.includes("jdoe"));
        assert.ok(!text.includes("Someone"));
        assert.ok(!text.includes("abcdefghijklmnopqrstuvwxyz1"));
        assert.match(text, /<id>/);
        assert.match(text, /<email>/);
        assert.match(text, /C:\\Users\\<user>/);
        assert.match(text, /<token>/);
    });

    it("leaves ordinary text alone", () => {
        assert.equal(redact("patch by RiskyExample had no effect (module 123456)"), "patch by RiskyExample had no effect (module 123456)");
    });
});

describe("recording patch outcomes", () => {
    it("records nothing for patches that applied or were skipped", () => {
        const s = record(fresh(), patchEvent({ status: "applied", replacements: [{ match: "/x/", status: "applied" }] }), patchEvent({ status: "skipped" }));
        assert.deepEqual(s.plugins, {});
    });

    it("turns each failed replacement into an issue of the right kind", () => {
        const replacements: PatchEventReplacement[] = [
            { match: "/a/", status: "no-effect" },
            { match: "/b/", status: "errored", error: "TypeError: x" },
            { match: "/c/", status: "syntax-error" },
            { match: "/d/", status: "applied" }
        ];
        const s = record(fresh(), patchEvent({ status: "partial", replacements }));
        assert.deepEqual(s.plugins.P.issues.map(i => i.kind), ["patch-no-effect", "patch-errored", "patch-syntax"]);
        assert.ok(s.plugins.P.issues.every(i => i.severity === "error"));
        assert.match(s.plugins.P.issues[1].detail, /TypeError: x/);
    });

    it("records an undone group as one issue naming the cause", () => {
        const s = record(fresh(), patchEvent({ status: "undone", replacements: [{ match: "/a/", status: "undone" }, { match: "/b/", status: "no-effect" }, { match: "/c/", status: "not-run" }] }));
        assert.equal(s.plugins.P.issues.length, 1);
        assert.equal(s.plugins.P.issues[0].kind, "patch-undone");
        assert.match(s.plugins.P.issues[0].detail, /\/b\/ no-effect/);
    });

    it("an optional patch only gives a warning, which does not break the session", () => {
        const s = record(fresh(), patchEvent({ required: false }));
        assert.equal(s.plugins.P.issues[0].severity, "warning");
        assert.equal(s.current.plugins.P, undefined);
    });

    it("a required patch that failed counts as a patch failure of the session", () => {
        const s = record(fresh(), patchEvent());
        assert.equal(s.current.plugins.P.patchFailures, 1);
    });

    it("records a patch that found no module, required or optional", () => {
        const s = record(fresh(),
            { type: "patch-no-module", plugin: "A", find: "text", required: true },
            { type: "patch-no-module", plugin: "B", find: "text", required: false });
        assert.equal(s.plugins.A.issues[0].severity, "error");
        assert.equal(s.plugins.B.issues[0].severity, "warning");
        assert.equal(s.current.plugins.A.patchFailures, 1);
        assert.equal(s.current.plugins.B, undefined);
    });
});

describe("a patch that finds its module after the boot judged it", () => {
    const noModule = (extra: Partial<Extract<HealthEvent, { type: "patch-no-module"; }>> = {}): HealthEvent => ({ type: "patch-no-module", plugin: "P", find: "anchor", required: true, ...extra });
    const found = (status: Extract<HealthEvent, { type: "patch"; }>["status"] = "applied", extra: Partial<Extract<HealthEvent, { type: "patch"; }>> = {}) =>
        patchEvent({ status, replacements: [{ match: "/x/", status: "applied" }], ...extra });

    it("takes away the no-module issue and the failure it counted, when the patch applied", () => {
        const s = record(fresh(), noModule(), found());
        assert.deepEqual(s.plugins.P.issues, []);
        assert.equal(s.current.plugins.P.patchFailures, 0);
        assert.equal(isBroken(s.current.plugins.P), false);
    });

    it("also settles it when the module was found but the patch partly failed, and records the real failure instead", () => {
        const s = record(fresh(), noModule(), found("partial", { replacements: [{ match: "/y/", status: "no-effect" }] }));
        assert.deepEqual(s.plugins.P.issues.map(i => i.kind), ["patch-no-effect"]);
        assert.equal(s.current.plugins.P.patchFailures, 1, "the no-module failure was taken away and the real one counted");
    });

    it("does not settle it when the patch was skipped by the build range (its module was never found)", () => {
        const s = record(fresh(), noModule(), found("skipped"));
        assert.deepEqual(s.plugins.P.issues.map(i => i.kind), ["patch-no-module"]);
        assert.equal(s.current.plugins.P.patchFailures, 1);
    });

    it("settles only the patch that found its module, not another of the same plugin or of another plugin", () => {
        const s = record(fresh(), noModule({ find: "a" }), noModule({ find: "b" }), noModule({ plugin: "Q", find: "a" }), found("applied", { find: "a" }));
        assert.deepEqual(s.plugins.P.issues.map(i => i.key), ["patch-no-module|b|"]);
        assert.deepEqual(s.plugins.Q.issues.map(i => i.key), ["patch-no-module|a|"]);
        assert.equal(s.current.plugins.P.patchFailures, 1);
        assert.equal(s.current.plugins.Q.patchFailures, 1);
    });

    it("leaves an optional patch's warning counting nothing against the session when it is settled", () => {
        const s = record(fresh(), noModule({ required: false }), found());
        assert.deepEqual(s.plugins.P.issues, []);
        assert.equal(s.current.plugins.P, undefined, "an optional miss never counted");
    });

    it("takes away as many failures as the issue added, never going below zero", () => {
        const twice = record(fresh(), noModule(), noModule(), found());
        assert.equal(twice.current.plugins.P.patchFailures, 0);
        assert.deepEqual(twice.plugins.P.issues, []);
        const other = record(fresh(), noModule({ find: "a" }), noModule({ find: "b" }), found("applied", { find: "a" }));
        assert.equal(other.current.plugins.P.patchFailures, 1, "the other patch's failure stays");
    });

    it("takes no failure away for an optional patch's warning, even when the plugin has failures of its own", () => {
        const s = record(fresh(), noModule({ find: "needed" }), noModule({ find: "optional", required: false }), found("applied", { find: "optional" }));
        assert.deepEqual(s.plugins.P.issues.map(i => i.key), ["patch-no-module|needed|"]);
        assert.equal(s.current.plugins.P.patchFailures, 1, "the failure of the required patch stays");
    });

    it("never takes the count below zero, even from data that says the issue added more than was counted", () => {
        const base = record(fresh(), noModule());
        const odd: HealthState = {
            ...base,
            plugins: { P: { ...base.plugins.P, issues: base.plugins.P.issues.map(issue => ({ ...issue, count: 3 })) } }
        };
        const s = recordEvent(odd, found(), 3000);
        assert.equal(s.current.plugins.P.patchFailures, 0);
    });

    it("does nothing when there was no notice, or no health for the plugin", () => {
        const s0 = record(fresh(), found());
        assert.equal(s0.plugins.P, undefined);
        const s1 = record(fresh(), { type: "runtime-error", plugin: "P", source: "start", error: "x" }, found());
        assert.equal(s1.plugins.P.issues.length, 1);
    });

    it("does not change the state it was given", () => {
        const before = record(fresh(), noModule());
        const copy = JSON.stringify(before);
        recordEvent(before, found(), 3000);
        assert.equal(JSON.stringify(before), copy);
    });
});

describe("recording other events", () => {
    it("records start failures, runtime errors and missing finders", () => {
        const s = record(fresh(),
            { type: "start-failed", plugin: "P", error: "Error: no" },
            { type: "runtime-error", plugin: "P", source: "flux:MESSAGE_CREATE", error: "TypeError: y" },
            { type: "finder-miss", plugin: "P", finder: "byProps(a)", required: true });
        assert.deepEqual(s.plugins.P.issues.map(i => i.kind), ["start-failed", "runtime-error", "finder-miss"]);
        assert.deepEqual({ ...s.current.plugins.P }, { patchFailures: 0, runtimeErrors: 1, startFailures: 1, finderMisses: 1, notices: 0 });
    });

    it("keeps one issue for the same problem and counts the repeats", () => {
        const e: HealthEvent = { type: "runtime-error", plugin: "P", source: "flux:X", error: "boom" };
        const s = record(fresh(), e, e, e);
        assert.equal(s.plugins.P.issues.length, 1);
        assert.equal(s.plugins.P.issues[0].count, 3);
        assert.ok(s.plugins.P.issues[0].lastAt > s.plugins.P.issues[0].firstAt);
    });

    it("keeps at most a fixed number of issues per plugin, newest last", () => {
        let s = fresh();
        for (let i = 0; i < MAX_ISSUES_PER_PLUGIN + 10; i++) s = recordEvent(s, { type: "runtime-error", plugin: "P", source: "s", error: `error ${i}` }, i);
        assert.equal(s.plugins.P.issues.length, MAX_ISSUES_PER_PLUGIN);
        assert.match(s.plugins.P.issues.at(-1)!.detail, new RegExp(`error ${MAX_ISSUES_PER_PLUGIN + 9}`));
    });

    it("redacts and shortens what it stores", () => {
        const s = record(fresh(), { type: "runtime-error", plugin: "P", source: "s", error: `user 1554284154009682032 ${"x".repeat(5000)}` });
        const detail = s.plugins.P.issues[0].detail;
        assert.ok(!detail.includes("1554284154009682032"));
        assert.ok(detail.length < MAX_TEXT_LENGTH + 50);
        assert.match(detail, /truncated/);
    });

    it("a change in Discord's code is a notice and does not break the session", () => {
        const s = record(fresh(), { type: "discord-changed", plugin: "P", find: "anchor", detail: "hash changed" });
        assert.equal(s.plugins.P.notices.length, 1);
        assert.deepEqual(s.plugins.P.issues, []);
        assert.equal(s.current.plugins.P.notices, 1);
        assert.equal(stabilityOf(s, "P").sessionsBroken, 0);
    });

    it("remembers the start time, the enabled plugins and the Discord build", () => {
        const s = record(fresh(), { type: "started", plugin: "P", ms: 12.5 }, { type: "enabled", plugins: ["P", "P", "Q"] }, { type: "discord-build", build: 700000 });
        assert.equal(s.plugins.P.startMs, 12.5);
        assert.deepEqual(s.current.enabled, ["P", "Q"]);
        assert.equal(s.current.discordBuild, 700000);
    });

    it("never changes the state it was given", () => {
        const base = Object.freeze(fresh());
        assert.doesNotThrow(() => recordEvent(base, patchEvent(), 5));
        assert.deepEqual(base.plugins, {});
    });
});

describe("sessions", () => {
    it("moves the current session to the history and keeps its details once", () => {
        let s = record(fresh(), { type: "enabled", plugins: ["P"] }, { type: "runtime-error", plugin: "P", source: "s", error: "e" });
        s = startSession(s, "s1", 5000);
        assert.equal(s.current.id, "s1");
        assert.deepEqual(s.plugins, {});
        assert.equal(s.history.length, 1);
        assert.equal(s.history[0].id, "s0");
        assert.equal(s.previous?.sessionId, "s0");
        assert.equal(s.previous?.plugins.P.issues.length, 1);
    });

    it("does not store an empty session", () => {
        const s = startSession(fresh(), "s1", 5000);
        assert.deepEqual(s.history, []);
        assert.equal(s.previous, null);
    });

    it("keeps only the last sessions", () => {
        const s = withHistory(HISTORY_WINDOW + 5, 0);
        assert.equal(s.history.length, HISTORY_WINDOW);
        assert.equal(s.history[0].id, "s4");
    });
});

describe("stability", () => {
    it("is unknown before three sessions, even with no problems", () => {
        assert.equal(stabilityOf(withHistory(2, 0), "P").badge, "unknown");
    });

    it("is stable after three clean sessions", () => {
        assert.deepEqual(stabilityOf(withHistory(3, 0), "P"), { badge: "stable", sessionsSeen: 3, sessionsBroken: 0 });
    });

    it("is flaky below 40 percent broken and unstable from 40 percent", () => {
        assert.equal(stabilityOf(withHistory(10, 3), "P").badge, "flaky");
        assert.equal(stabilityOf(withHistory(10, 4), "P").badge, "unstable");
        assert.equal(stabilityOf(withHistory(10, 10), "P").badge, "unstable");
    });

    it("counts only sessions in which the plugin ran", () => {
        let s = defaultHealthState("s0", 0);
        s = recordEvent(s, { type: "enabled", plugins: ["Other"] }, 1);
        s = startSession(s, "s1", 10);
        s = recordEvent(s, { type: "enabled", plugins: ["P"] }, 11);
        assert.equal(stabilityOf(s, "P").sessionsSeen, 1);
    });

    it("a session with only a warning or a notice is not broken", () => {
        let s = withHistory(3, 0);
        s = recordEvent(s, patchEvent({ required: false }), 99);
        s = recordEvent(s, { type: "discord-changed", plugin: "P", find: "a", detail: "b" }, 100);
        assert.equal(stabilityOf(s, "P").badge, "stable");
    });
});

describe("report", () => {
    it("says so when there is nothing to report", () => {
        const r = buildReport(record(fresh(), { type: "enabled", plugins: ["P"] }));
        assert.deepEqual(r.plugins, []);
        assert.match(r.text, /No problems recorded this session\./);
        assert.match(r.text, /Discord build: 647615/);
        assert.equal(r.pluginsEnabled, 1);
    });

    it("lists the plugins with problems, with their latest issues", () => {
        let s = record(fresh(), { type: "enabled", plugins: ["Fine", "Bad"] }, patchEvent({ plugin: "Bad" }));
        s = recordEvent(s, { type: "runtime-error", plugin: "Bad", source: "start", error: "boom" }, 3000);
        const r = buildReport(s);
        assert.deepEqual(r.plugins.map(p => p.plugin), ["Bad"]);
        assert.equal(r.plugins[0].errors, 2);
        assert.match(r.text, /Bad: unstable \(1 of 1 sessions broken\)/);
        assert.match(r.text, /\[error\] patch-no-effect/);
        assert.match(r.text, /\[error\] runtime-error: start: boom/);
        assert.doesNotMatch(r.text, /Fine/);
    });

    it("uses a fixed date format and no machine specific text", () => {
        const r = buildReport(fresh());
        assert.match(r.text, /session started 1970-01-01T00:00:01Z/);
    });
});

describe("reading and writing", () => {
    it("reads back what it wrote", () => {
        let s = record(fresh(), { type: "enabled", plugins: ["P"] }, patchEvent(), { type: "discord-changed", plugin: "P", find: "a", detail: "b" });
        s = startSession(s, "s1", 5000);
        const { state, problems } = parseHealthState(serializeHealthState(s), "x", 0);
        assert.deepEqual(problems, []);
        assert.deepEqual(state, s);
    });

    it("starts empty, with a problem, for damaged or unknown data", () => {
        for (const text of ["", "{ nope", "[]", JSON.stringify({ schema: 2 })]) {
            const r = parseHealthState(text, "fallback", 7);
            assert.equal(r.state.current.id, "fallback");
            assert.deepEqual(r.state.history, []);
            assert.equal(r.problems.length, 1, text);
        }
    });

    it("keeps the good parts and reports the damaged ones", () => {
        const good = withHistory(3, 1);
        const raw = JSON.parse(serializeHealthState(good));
        raw.history.push("garbage");
        raw.plugins.P = { issues: [{ kind: "made-up", key: "k", detail: "d" }, ...raw.plugins.P?.issues ?? []], notices: [] };
        const r = parseHealthState(JSON.stringify(raw), "x", 0);
        assert.equal(r.state.history.length, good.history.length);
        assert.ok(r.problems.some(p => p.includes("history[")));
        assert.deepEqual(r.state.plugins.P.issues.map(i => i.kind), good.plugins.P?.issues.map(i => i.kind) ?? []);
    });

    it("limits what it reads: more sessions or issues than the caps are cut", () => {
        const s = withHistory(3, 0);
        const raw = JSON.parse(serializeHealthState(s));
        raw.history = Array.from({ length: 40 }, (_, i) => ({ id: `h${i}`, startedAt: i, endedAt: i, discordBuild: null, enabled: [], plugins: {} }));
        const r = parseHealthState(JSON.stringify(raw), "x", 0);
        assert.equal(r.state.history.length, HISTORY_WINDOW);
        assert.equal(r.state.history.at(-1)!.id, "h39");
    });
});
