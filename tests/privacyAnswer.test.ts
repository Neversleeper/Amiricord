/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DNS_PROVIDERS } from "../src/main/dns/providers";
import { buildPrivacyAnswer, makeProviderTester, TEST_GAP_MS } from "../src/main/privacyAnswer";
import type { HostRule } from "../src/shared/hostRules";
import { DEFAULT_PROVIDER, parsePrivacyAnswer, PRIVACY_MAX_PAUSE_MS, PRIVACY_MAX_RULES } from "../src/shared/privacy";
import { emptyNetworkCounts } from "../src/shared/shields";

const rule = (n: number): HostRule => ({ id: `r${n}`, host: `h${n}.test`, subdomains: n % 2 === 0, action: "block", reason: `why ${n}`, created: 1234 });
const input = (rules: HostRule[] = []) => ({ counts: { ...emptyNetworkCounts(), "usage-reports": 3 }, dnsLine: "Off", dnsMode: "off" as const, dnsProvider: "", dnsSaved: { mode: "off" as const, provider: "" }, telemetry: { usage: true, crash: true }, logVersion: 5, pauseRemainingMs: null as number | null, rules });

describe("the snapshot for the Privacy & Security tab", () => {
    it("carries the counters, the DNS state, the rules and the providers, and the page can read it back", () => {
        const answer = parsePrivacyAnswer(buildPrivacyAnswer(input([rule(1), rule(2)])))!;
        assert.equal(answer.counts["usage-reports"], 3);
        assert.deepEqual(answer.dns, { line: "Off", mode: "off", provider: "", saved: { mode: "off", provider: "" }, pending: false });
        assert.deepEqual(answer.rules.map(r => [r.id, r.host, r.subdomains, r.reason]), [["r1", "h1.test", false, "why 1"], ["r2", "h2.test", true, "why 2"]]);
        assert.equal(answer.ruleCount, 2);
        assert.deepEqual(answer.providers.map(p => p.id), DNS_PROVIDERS.map(p => p.id));
    });

    it("tells the mode and the provider that were chosen", () => {
        const answer = buildPrivacyAnswer({ ...input(), dnsMode: "strict", dnsProvider: "mullvad-base" });
        assert.deepEqual(answer.dns, { line: "Off", mode: "strict", provider: "mullvad-base", saved: { mode: "off", provider: "" }, pending: true });
    });

    it("tells what is saved, whether a restart is pending, and the two switches", () => {
        const answer = buildPrivacyAnswer({ ...input(), telemetry: { usage: false, crash: true } });
        assert.deepEqual(answer.telemetry, { usage: false, crash: true });
        assert.deepEqual(answer.dns.saved, { mode: "off", provider: "" });
        assert.equal(answer.dns.pending, false);
    });

    it("says a restart is pending when the saved mode is not the one in force, or the provider differs while a mode is on", () => {
        const pending = (inForce: { mode: "off" | "automatic" | "strict"; provider: string; }, saved: { mode: "off" | "automatic" | "strict"; provider: string; }) =>
            buildPrivacyAnswer({ ...input(), dnsMode: inForce.mode, dnsProvider: inForce.provider, dnsSaved: saved }).dns.pending;
        assert.equal(pending({ mode: "off", provider: "" }, { mode: "off", provider: "" }), false);
        assert.equal(pending({ mode: "off", provider: "" }, { mode: "automatic", provider: "quad9" }), true);
        assert.equal(pending({ mode: "automatic", provider: "quad9" }, { mode: "off", provider: "quad9" }), true);
        assert.equal(pending({ mode: "automatic", provider: "quad9" }, { mode: "strict", provider: "quad9" }), true);
        assert.equal(pending({ mode: "automatic", provider: "quad9" }, { mode: "automatic", provider: "cloudflare" }), true);
        assert.equal(pending({ mode: "automatic", provider: "quad9" }, { mode: "automatic", provider: "quad9" }), false);
        assert.equal(pending({ mode: "off", provider: "quad9" }, { mode: "off", provider: "cloudflare" }), false, "the provider does not matter while off");
    });

    it("offers the default provider that the tab proposes, and it is in our own table", () => {
        assert.equal(DEFAULT_PROVIDER, "mullvad-base");
        assert.ok(parsePrivacyAnswer(buildPrivacyAnswer(input()))!.providers.some(p => p.id === DEFAULT_PROVIDER));
    });

    it("gives each provider's host name for the status table, from our own table", () => {
        const answer = parsePrivacyAnswer(buildPrivacyAnswer(input()))!;
        assert.deepEqual(answer.providers.map(p => [p.id, p.host]), [["quad9", "dns.quad9.net"], ["mullvad-base", "base.dns.mullvad.net"], ["cloudflare", "cloudflare-dns.com"], ["adguard-unfiltered", "unfiltered.adguard-dns.com"]]);
    });

    it("carries the number of blocks counted, as a whole number that is never negative", () => {
        const version = (logVersion: number) => buildPrivacyAnswer({ ...input(), logVersion }).logVersion;
        assert.equal(version(5), 5);
        assert.equal(version(5.9), 5);
        assert.equal(version(0), 0);
        assert.equal(version(-4), 0);
        assert.equal(parsePrivacyAnswer(buildPrivacyAnswer(input()))!.logVersion, 5);
    });

    it("never carries a provider address, the time a rule was made, or the action", () => {
        const text = JSON.stringify(buildPrivacyAnswer(input([rule(1)])));
        assert.doesNotMatch(text, /https:|dns-query|created|1234|action/);
    });

    it("does not change what the caller gave it", () => {
        const given = input();
        const answer = buildPrivacyAnswer(given);
        answer.cancelled.metrics = 99;
        assert.equal(given.counts.metrics, 0);
    });

    it("sends at most the first rules and tells how many there are", () => {
        const rules = Array.from({ length: PRIVACY_MAX_RULES + 50 }, (_, i) => rule(i));
        const answer = buildPrivacyAnswer(input(rules));
        assert.equal(answer.rules.length, PRIVACY_MAX_RULES);
        assert.equal(answer.ruleCount, PRIVACY_MAX_RULES + 50);
        assert.equal(answer.rules[0]!.id, "r0");
        assert.equal(answer.rules[PRIVACY_MAX_RULES - 1]!.id, `r${PRIVACY_MAX_RULES - 1}`);
    });
});

function tester(result: { ok: boolean; reason: string; ms: number; } | Error = { ok: true, reason: "", ms: 41.4 }) {
    let clock = 10_000;
    const asked: string[] = [];
    const run = makeProviderTester({
        verify: async address => {
            asked.push(address);
            if (result instanceof Error) throw result;
            return result;
        },
        now: () => clock
    });
    return { run, asked, advance: (ms: number) => { clock += ms; } };
}

describe("Test now", () => {
    it("waits three seconds between tests", () => {
        assert.equal(TEST_GAP_MS, 3000);
    });

    it("asks the address of our own table for the id the page named, and applies nothing", async () => {
        const t = tester();
        const answer = await t.run("quad9");
        assert.deepEqual(answer, { ok: true, reason: "", ms: 41 });
        assert.deepEqual(t.asked, ["https://dns.quad9.net/dns-query"]);
    });

    it("refuses an id that is not in the table, whatever else it is, without asking anyone", async () => {
        const t = tester();
        for (const id of ["nope", "custom", "", 5, null, undefined, "https://evil.test/dns-query", { id: "quad9" }]) {
            const answer = await t.run(id);
            assert.equal(answer.ok, false);
            assert.match(answer.reason, /not in the list/);
            t.advance(TEST_GAP_MS);
        }
        assert.deepEqual(t.asked, []);
    });

    it("says why a provider did not pass, with no time", async () => {
        const t = tester({ ok: false, reason: "the provider did not answer within 3 seconds", ms: 3000 });
        assert.deepEqual(await t.run("mullvad-base"), { ok: false, reason: "the provider did not answer within 3 seconds", ms: null });
    });

    it("does not fail when the check throws", async () => {
        const t = tester(new Error("boom"));
        assert.deepEqual(await t.run("cloudflare"), { ok: false, reason: "the check could not run", ms: null });
    });

    it("does not start a second test too soon, but does after the pause, even after a failure", async () => {
        const t = tester(new Error("boom"));
        await t.run("quad9");
        t.advance(TEST_GAP_MS - 1);
        const early = await t.run("quad9");
        assert.match(early.reason, /wait a few seconds/);
        assert.equal(t.asked.length, 1);
        t.advance(1);
        await t.run("quad9");
        assert.equal(t.asked.length, 2);
    });

    it("does not run two at once, and can run again when the first has finished", async () => {
        let finish: (value: { ok: boolean; reason: string; ms: number; }) => void = () => undefined;
        let clock = 0;
        let calls = 0;
        const run = makeProviderTester({ verify: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, now: () => clock });
        const first = run("quad9");
        clock += TEST_GAP_MS * 2;
        const second = await run("adguard-unfiltered");
        assert.match(second.reason, /already running/);
        finish({ ok: true, reason: "", ms: 5 });
        assert.equal((await first).ok, true);
        assert.equal(calls, 1);
        clock += TEST_GAP_MS;
        void run("quad9");
        assert.equal(calls, 2);
    });
});

describe("the pause in the snapshot", () => {
    it("says there is no pause when none runs", () => {
        assert.equal(buildPrivacyAnswer(input()).pause, null);
        assert.equal(parsePrivacyAnswer(buildPrivacyAnswer(input()))!.pause, null);
    });

    it("carries the time left and the page reads it back", () => {
        const built = buildPrivacyAnswer({ ...input(), pauseRemainingMs: 120_000 });
        assert.deepEqual(built.pause, { remainingMs: 120_000 });
        assert.deepEqual(parsePrivacyAnswer(built)!.pause, { remainingMs: 120_000 });
    });

    it("tells whole milliseconds, never a fraction and never less than zero", () => {
        assert.deepEqual(buildPrivacyAnswer({ ...input(), pauseRemainingMs: 1500.6 }).pause, { remainingMs: 1501 });
        assert.deepEqual(buildPrivacyAnswer({ ...input(), pauseRemainingMs: 1500.4 }).pause, { remainingMs: 1500 });
        assert.deepEqual(buildPrivacyAnswer({ ...input(), pauseRemainingMs: -5 }).pause, { remainingMs: 0 });
        assert.ok(parsePrivacyAnswer(buildPrivacyAnswer({ ...input(), pauseRemainingMs: 1500.6 })), "what it builds, the page accepts");
    });

    it("accepts the ends of the range and nothing outside it", () => {
        const withPause = (pause: unknown) => parsePrivacyAnswer({ ...buildPrivacyAnswer(input()), pause });
        assert.deepEqual(withPause({ remainingMs: 0 })!.pause, { remainingMs: 0 });
        assert.deepEqual(withPause({ remainingMs: PRIVACY_MAX_PAUSE_MS })!.pause, { remainingMs: PRIVACY_MAX_PAUSE_MS });
        assert.equal(PRIVACY_MAX_PAUSE_MS, 600_000);
        for (const bad of [{ remainingMs: -1 }, { remainingMs: PRIVACY_MAX_PAUSE_MS + 1 }, { remainingMs: 1.5 }, { remainingMs: "5" }, { remainingMs: Infinity }, {}, 5, "yes", [], undefined]) {
            assert.equal(withPause(bad), null, JSON.stringify(bad));
        }
    });
});
