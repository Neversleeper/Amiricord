/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyDns, dnsOff, dnsText, ResolverOptions, RETRY_DELAY_MS } from "../src/main/dns/apply";
import type { DnsChoice } from "../src/main/dns/config";
import type { VerifyResult } from "../src/main/dns/verify";

const choice = (mode: DnsChoice["mode"], extra: Partial<DnsChoice> = {}): DnsChoice => ({ mode, address: "https://dns.quad9.net/dns-query", name: "Quad9", ...extra });

function setup(verified: VerifyResult | Error, configure?: (options: ResolverOptions) => void) {
    const verifyCalls: string[] = [];
    const configured: ResolverOptions[] = [];
    return {
        deps: {
            verify: async (address: string) => { verifyCalls.push(address); if (verified instanceof Error) throw verified; return verified; },
            configure: (options: ResolverOptions) => { if (configure) configure(options); configured.push(options); }
        },
        verifyCalls,
        configured
    };
}

describe("applying encrypted DNS", () => {
    it("does nothing, and asks nothing, when it is off", async () => {
        const t = setup({ ok: true, reason: "", ms: 10 });
        assert.deepEqual(await applyDns({ mode: "off", address: null, name: "" }, t.deps), dnsOff());
        assert.deepEqual(await applyDns({ mode: "off", address: "https://x.test/q", name: "X" }, t.deps), dnsOff());
        assert.deepEqual(await applyDns({ mode: "automatic", address: null, name: "X" }, t.deps), dnsOff());
        assert.deepEqual([t.verifyCalls, t.configured], [[], []]);
    });

    it("verifies the provider first and, when it answers, tells the resolver to use it in automatic mode", async () => {
        const t = setup({ ok: true, reason: "", ms: 38 });
        const status = await applyDns(choice("automatic"), t.deps);
        assert.deepEqual(status, { state: "configured", asked: "automatic", inForce: "automatic", provider: "Quad9", ms: 38, reason: "" });
        assert.deepEqual(t.verifyCalls, ["https://dns.quad9.net/dns-query"]);
        assert.deepEqual(t.configured, [{ enableBuiltInResolver: true, secureDnsMode: "automatic", secureDnsServers: ["https://dns.quad9.net/dns-query"] }]);
    });

    it("uses the mode that never falls back for Strict", async () => {
        const t = setup({ ok: true, reason: "", ms: 12 });
        const status = await applyDns(choice("strict"), t.deps);
        assert.equal(status.inForce, "strict");
        assert.equal(t.configured[0]!.secureDnsMode, "secure");
    });

    it("does not apply a provider that did not answer, in either mode, and says which DNS stays", async () => {
        for (const [mode, stays] of [["automatic", /system's DNS stays in use/], ["strict", /encrypted DNS stays off so that Discord can still connect/]] as const) {
            const t = setup({ ok: false, reason: "the provider did not answer within 3 seconds", ms: 3000 });
            const status = await applyDns(choice(mode), t.deps);
            assert.equal(status.state, "not-applied");
            assert.equal(status.inForce, "off");
            assert.equal(status.asked, mode);
            assert.equal(status.ms, null);
            assert.match(status.reason, /did not answer within 3 seconds/);
            assert.match(status.reason, stays);
            assert.deepEqual(t.configured, [], mode + ": the resolver is not touched");
        }
    });

    it("asks only once when it has no way to wait", async () => {
        const t = setup({ ok: false, reason: "no answer", ms: 0 });
        await applyDns(choice("automatic"), t.deps);
        assert.equal(t.verifyCalls.length, 1);
    });

    it("asks a second time after a pause when the first check fails, and applies the provider if the second answers", async () => {
        const answers: Array<VerifyResult | Error> = [{ ok: false, reason: "the provider did not answer within 3 seconds", ms: 0 }, { ok: true, reason: "", ms: 44 }];
        const waits: number[] = [];
        const configured: ResolverOptions[] = [];
        const status = await applyDns(choice("automatic"), {
            verify: async () => { const next = answers.shift()!; if (next instanceof Error) throw next; return next; },
            wait: async ms => { waits.push(ms); },
            configure: options => { configured.push(options); }
        });
        assert.deepEqual(waits, [RETRY_DELAY_MS]);
        assert.equal(RETRY_DELAY_MS, 10_000);
        assert.deepEqual([status.state, status.ms], ["configured", 44]);
        assert.equal(configured.length, 1);
    });

    it("gives up after the second failure, saying the reason of the last one, and does not wait again", async () => {
        const reasons = ["the first reason", "the second reason"];
        const waits: number[] = [];
        let calls = 0;
        const status = await applyDns(choice("strict"), {
            verify: async () => { calls++; return { ok: false, reason: reasons.shift()!, ms: 0 }; },
            wait: async ms => { waits.push(ms); },
            configure: () => { throw new Error("must not be called"); }
        });
        assert.equal(calls, 2);
        assert.deepEqual(waits, [RETRY_DELAY_MS]);
        assert.equal(status.state, "not-applied");
        assert.match(status.reason, /the second reason/);
        assert.doesNotMatch(status.reason, /the first reason/);
    });

    it("does not ask a second time, or wait, when the first check passes", async () => {
        let waited = false;
        let calls = 0;
        const status = await applyDns(choice("automatic"), { verify: async () => { calls++; return { ok: true, reason: "", ms: 9 }; }, wait: async () => { waited = true; }, configure: () => undefined });
        assert.equal(status.state, "configured");
        assert.deepEqual([calls, waited], [1, false]);
    });

    it("still tries again when waiting itself fails, and when the first check throws", async () => {
        let calls = 0;
        const status = await applyDns(choice("automatic"), {
            verify: async () => { calls++; if (calls === 1) throw new Error("boom"); return { ok: true, reason: "", ms: 3 }; },
            wait: async () => { throw new Error("no timer"); },
            configure: () => undefined
        });
        assert.equal(calls, 2);
        assert.equal(status.state, "configured");
    });

    it("does not fail when the check itself throws, and applies nothing", async () => {
        const t = setup(new Error("boom"));
        const status = await applyDns(choice("strict"), t.deps);
        assert.equal(status.state, "not-applied");
        assert.match(status.reason, /the check of the provider failed/);
        assert.deepEqual(t.configured, []);
    });

    it("says the provider answered but the resolver would not take the setting, when the resolver refuses", async () => {
        const t = setup({ ok: true, reason: "", ms: 21 }, () => { throw new Error("not allowed"); });
        const status = await applyDns(choice("automatic"), t.deps);
        assert.equal(status.state, "not-applied");
        assert.equal(status.inForce, "off");
        assert.equal(status.ms, 21);
        assert.match(status.reason, /resolver would not take the setting/);
        assert.doesNotMatch(status.reason, /not allowed/);
    });
});

describe("the line for the main tab", () => {
    it("says plainly what is true, and no more", () => {
        assert.equal(dnsText({ state: "configured", asked: "automatic", inForce: "automatic", provider: "Quad9", ms: 38, reason: "" }), "Configured: Quad9, automatic, answered in 38 ms");
        assert.equal(dnsText({ state: "configured", asked: "strict", inForce: "strict", provider: "Mullvad (base)", ms: 5, reason: "" }), "Configured: Mullvad (base), strict, answered in 5 ms");
        assert.equal(dnsText({ state: "not-applied", asked: "strict", inForce: "off", provider: "Quad9", ms: null, reason: "the provider could not be reached (ENOTFOUND)" }), "Not applied (Quad9, strict): the provider could not be reached (ENOTFOUND)");
        assert.equal(dnsText(dnsOff()), "Off");
    });

    it("says why it is off when a problem is the reason, and only the first", () => {
        assert.equal(dnsText(dnsOff(), ["safe mode keeps encrypted DNS off", "another"]), "Off: safe mode keeps encrypted DNS off");
        assert.equal(dnsText(dnsOff(), []), "Off");
    });

    it("never claims that all lookups are encrypted", () => {
        const lines = [
            dnsText({ state: "configured", asked: "automatic", inForce: "automatic", provider: "Quad9", ms: 38, reason: "" }),
            dnsText({ state: "not-applied", asked: "automatic", inForce: "off", provider: "Quad9", ms: null, reason: "x" }), dnsText(dnsOff())
        ];
        for (const line of lines) assert.doesNotMatch(line, /all|every|protected|secure[d]? /i);
    });
});
