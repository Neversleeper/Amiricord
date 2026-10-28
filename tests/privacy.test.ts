/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePrivacyAnswer, parseProviderTest, PRIVACY_MAX_PROVIDERS, PRIVACY_MAX_RULES } from "../src/shared/privacy";
import { emptyNetworkCounts } from "../src/shared/shields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests reach into made-up answers and break them on purpose
type Loose = Record<string, any>;

const good = (): Loose => ({
    cancelled: { ...emptyNetworkCounts(), metrics: 2 },
    dns: { line: "Off", mode: "off", provider: "", saved: { mode: "off", provider: "" }, pending: false },
    telemetry: { usage: true, crash: false },
    logVersion: 7,
    pause: null,
    rules: [{ id: "r1", host: "m.stripe.com", subdomains: true, reason: "payment fingerprint" }],
    ruleCount: 1,
    providers: [{ id: "quad9", name: "Quad9", host: "dns.quad9.net", filters: "malware", note: "A note." }]
});

describe("reading the snapshot of the main process", () => {
    it("rebuilds a good answer field by field", () => {
        assert.deepEqual(parsePrivacyAnswer(good()), {
            counts: { ...emptyNetworkCounts(), metrics: 2 },
            dns: { line: "Off", mode: "off", provider: "", saved: { mode: "off", provider: "" }, pending: false },
            telemetry: { usage: true, crash: false },
            logVersion: 7,
            pause: null,
            rules: [{ id: "r1", host: "m.stripe.com", subdomains: true, reason: "payment fingerprint" }],
            ruleCount: 1,
            providers: [{ id: "quad9", name: "Quad9", host: "dns.quad9.net", filters: "malware", note: "A note." }]
        });
    });

    it("keeps a running pause as its time left, rebuilt from that number alone", () => {
        const input = good();
        input.pause = { remainingMs: 90_000, until: 5, note: "x" };
        assert.deepEqual(parsePrivacyAnswer(input)!.pause, { remainingMs: 90_000 });
    });

    it("refuses the whole answer when the pause is not null or a whole number of milliseconds up to ten minutes", () => {
        for (const bad of [undefined, { remainingMs: -1 }, { remainingMs: 600_001 }, { remainingMs: 0.5 }, { remainingMs: "9" }, { remainingMs: NaN }, {}, 7, "on", true, []]) {
            const input = good();
            input.pause = bad;
            assert.equal(parsePrivacyAnswer(input), null, JSON.stringify(bad));
        }
        const input = good();
        delete input.pause;
        assert.equal(parsePrivacyAnswer(input), null, "a missing pause is not the same as no pause");
    });

    it("drops fields it does not know, so an address or a path cannot ride along", () => {
        const input = good();
        input.secret = "x";
        input.providers[0].address = "https://dns.quad9.net/dns-query";
        input.rules[0].path = "C:\\Users";
        const answer = parsePrivacyAnswer(input)!;
        assert.deepEqual(Object.keys(answer).sort(), ["counts", "dns", "logVersion", "pause", "providers", "ruleCount", "rules", "telemetry"]);
        assert.deepEqual(Object.keys(answer.providers[0]!).sort(), ["filters", "host", "id", "name", "note"]);
        assert.deepEqual(Object.keys(answer.rules[0]!).sort(), ["host", "id", "reason", "subdomains"]);
    });

    it("gives null for anything that is not the expected shape", () => {
        for (const value of [null, undefined, 5, "x", [], {}]) assert.equal(parsePrivacyAnswer(value), null, JSON.stringify(value));
        const bad = (change: (input: Loose) => void) => { const input = good(); change(input); return parsePrivacyAnswer(input); };
        assert.equal(bad(i => { i.cancelled = { metrics: -1 }; }), null, "counters");
        assert.equal(bad(i => { delete i.dns; }), null, "no dns");
        assert.equal(bad(i => { i.dns = []; }), null, "dns an array");
        assert.equal(bad(i => { i.dns.mode = "maybe"; }), null, "mode");
        assert.equal(bad(i => { i.dns.provider = "Has Spaces"; }), null, "provider id");
        assert.equal(bad(i => { i.dns.provider = 5; }), null, "provider not text");
        assert.equal(bad(i => { delete i.dns.saved; }), null, "no saved choice");
        assert.equal(bad(i => { i.dns.saved = []; }), null, "saved not a record");
        assert.equal(bad(i => { i.dns.saved.mode = "maybe"; }), null, "saved mode");
        assert.equal(bad(i => { i.dns.saved.provider = "A B"; }), null, "saved provider");
        assert.equal(bad(i => { i.dns.saved.provider = 5; }), null, "saved provider type");
        assert.equal(bad(i => { i.dns.pending = "no"; }), null, "pending type");
        assert.equal(bad(i => { delete i.dns.pending; }), null, "no pending");
        assert.equal(bad(i => { delete i.telemetry; }), null, "no telemetry");
        assert.equal(bad(i => { i.telemetry = []; }), null, "telemetry not a record");
        assert.equal(bad(i => { i.telemetry.usage = 1; }), null, "usage type");
        assert.equal(bad(i => { i.telemetry.crash = "yes"; }), null, "crash type");
        assert.equal(bad(i => { i.rules = "x"; }), null, "rules not a list");
        assert.equal(bad(i => { i.providers = {}; }), null, "providers not a list");
        assert.equal(bad(i => { i.ruleCount = "1"; }), null, "ruleCount type");
        assert.equal(bad(i => { i.ruleCount = 0; }), null, "ruleCount below the list");
        assert.equal(bad(i => { i.ruleCount = 1.5; }), null, "ruleCount fraction");
        assert.equal(bad(i => { i.rules[0].host = "Has Space.com"; }), null, "rule host");
        assert.equal(bad(i => { i.rules[0].subdomains = "yes"; }), null, "rule flag");
        assert.equal(bad(i => { i.rules[0].id = 5; }), null, "rule id");
        assert.equal(bad(i => { i.rules[0].reason = 5; }), null, "rule reason");
        assert.equal(bad(i => { i.providers[0].filters = "ads"; }), null, "provider filters");
        assert.equal(bad(i => { i.providers[0].id = "A B"; }), null, "provider id form");
        assert.equal(bad(i => { i.providers[0].name = 5; }), null, "provider name");
        assert.equal(bad(i => { i.providers[0].note = 5; }), null, "provider note");
        assert.equal(bad(i => { delete i.providers[0].host; }), null, "provider host missing");
        assert.equal(bad(i => { i.providers[0].host = "https://dns.quad9.net/dns-query"; }), null, "provider host is an address");
        assert.equal(bad(i => { i.providers[0].host = "Dns.Quad9.net"; }), null, "provider host upper");
        assert.equal(bad(i => { i.providers[0].host = ""; }), null, "provider host empty");
        assert.equal(bad(i => { i.providers[0].host = "a".repeat(254); }), null, "provider host too long");
        assert.equal(bad(i => { i.rules = [null]; }), null, "rule not an object");
        assert.equal(bad(i => { i.providers = [null]; }), null, "provider not an object");
    });

    it("accepts a host and an id only in their plain form, at their longest", () => {
        const host = (name: string) => { const input = good(); input.rules[0].host = name; return parsePrivacyAnswer(input); };
        assert.notEqual(host("a".repeat(253)), null);
        assert.equal(host("a".repeat(254)), null);
        assert.equal(host("Upper.test"), null);
        assert.equal(host("a b.test"), null);
        assert.equal(host(""), null);
        const id = (name: string) => { const input = good(); input.rules[0].id = name; return parsePrivacyAnswer(input)!.rules[0]!.id; };
        assert.equal(id("i".repeat(40)), "i".repeat(40));
        assert.equal(id("i".repeat(41)), "i".repeat(40));
        const provider = (id: string) => { const input = good(); input.providers[0].id = id; return parsePrivacyAnswer(input); };
        assert.notEqual(provider("a".repeat(40)), null);
        assert.equal(provider("a".repeat(41)), null);
        assert.equal(provider("Quad9"), null);
        assert.equal(provider(""), null);
        const dns = (id: string) => { const input = good(); input.dns.provider = id; return parsePrivacyAnswer(input); };
        assert.notEqual(dns("b".repeat(40)), null);
        assert.equal(dns("b".repeat(41)), null);
    });

    it("keeps what is saved, whether a restart is pending, and the two switches", () => {
        const input = good();
        input.dns.saved = { mode: "strict", provider: "quad9" };
        input.dns.pending = true;
        input.telemetry = { usage: false, crash: true };
        const answer = parsePrivacyAnswer(input)!;
        assert.deepEqual(answer.dns.saved, { mode: "strict", provider: "quad9" });
        assert.equal(answer.dns.pending, true);
        assert.deepEqual(answer.telemetry, { usage: false, crash: true });
        input.dns.saved = { mode: "automatic", provider: "" };
        assert.deepEqual(parsePrivacyAnswer(input)!.dns.saved, { mode: "automatic", provider: "" });
    });

    it("keeps the number that says the list of blocks changed, and refuses one that is not a whole number from zero", () => {
        assert.equal(parsePrivacyAnswer(good())!.logVersion, 7);
        const version = (value: unknown) => { const input = good(); input.logVersion = value; return parsePrivacyAnswer(input); };
        assert.equal(version(0)!.logVersion, 0);
        for (const value of [-1, 1.5, "7", null, undefined, NaN, Infinity]) assert.equal(version(value), null, String(value));
        const input = good();
        delete input.logVersion;
        assert.equal(parsePrivacyAnswer(input), null);
    });

    it("keeps the three modes and the custom provider", () => {
        for (const mode of ["off", "automatic", "strict"]) {
            const input = good();
            input.dns.mode = mode;
            assert.equal(parsePrivacyAnswer(input)!.dns.mode, mode);
        }
        const input = good();
        input.dns.provider = "custom";
        assert.equal(parsePrivacyAnswer(input)!.dns.provider, "custom");
    });

    it("limits how many rules and providers it accepts, and says how many rules there are in all", () => {
        const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, host: "a.test", subdomains: false, reason: "" }));
        const input = good();
        input.rules = many(PRIVACY_MAX_RULES);
        input.ruleCount = 5000;
        assert.equal(parsePrivacyAnswer(input)!.ruleCount, 5000);
        input.rules = many(PRIVACY_MAX_RULES + 1);
        input.ruleCount = PRIVACY_MAX_RULES + 1;
        assert.equal(parsePrivacyAnswer(input), null);
        const providers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: "P", host: "p.test", filters: "none", note: "" }));
        const second = good();
        second.providers = providers(PRIVACY_MAX_PROVIDERS);
        assert.equal(parsePrivacyAnswer(second)!.providers.length, PRIVACY_MAX_PROVIDERS);
        second.providers = providers(PRIVACY_MAX_PROVIDERS + 1);
        assert.equal(parsePrivacyAnswer(second), null);
    });

    it("strips control characters and cuts long texts", () => {
        const input = good();
        input.rules[0].reason = "a\u0000b\nc" + "x".repeat(500);
        input.providers[0].note = "n\u0007" + "y".repeat(500);
        input.providers[0].name = "N".repeat(100);
        input.rules[1] = { id: "r2", host: "b.test", subdomains: false, reason: "delete" };
        input.ruleCount = 2;
        input.dns.line = "ok\u0000 line";
        const answer = parsePrivacyAnswer(input)!;
        assert.equal(answer.rules[0]!.reason.length, 200);
        assert.ok(answer.rules[0]!.reason.startsWith("abcxxx"));
        assert.equal(answer.providers[0]!.note.length, 200);
        assert.ok(answer.providers[0]!.note.startsWith("nyyy"));
        assert.equal(answer.providers[0]!.name.length, 60);
        assert.equal(answer.dns.line, "ok line");
        assert.equal(answer.rules[1]!.reason, "delete");
    });

    it("accepts an empty list of rules", () => {
        const input = good();
        input.rules = [];
        input.ruleCount = 0;
        assert.deepEqual(parsePrivacyAnswer(input)!.rules, []);
    });
});

describe("reading the answer to Test now", () => {
    it("rebuilds a pass and a failure", () => {
        assert.deepEqual(parseProviderTest({ ok: true, reason: "", ms: 38.6, extra: 1 }), { ok: true, reason: "", ms: 39 });
        assert.deepEqual(parseProviderTest({ ok: false, reason: "did not answer", ms: null }), { ok: false, reason: "did not answer", ms: null });
    });

    it("accepts a time of zero", () => {
        assert.deepEqual(parseProviderTest({ ok: true, reason: "", ms: 0 }), { ok: true, reason: "", ms: 0 });
    });

    it("gives null for anything else", () => {
        const values = [null, 1, "x", [], {}, { ok: "yes", reason: "", ms: 1 }, { ok: true, reason: 5, ms: 1 }, { ok: true, reason: "", ms: "1" }, { ok: true, reason: "", ms: -1 }, { ok: true, reason: "", ms: Infinity }, { ok: true, reason: "" }];
        for (const value of values) assert.equal(parseProviderTest(value), null, JSON.stringify(value));
    });

    it("strips control characters and cuts the reason", () => {
        assert.equal(parseProviderTest({ ok: false, reason: "a\u0000b" + "z".repeat(400), ms: null })!.reason.length, 200);
        assert.equal(parseProviderTest({ ok: false, reason: "a\u0000b", ms: null })!.reason, "ab");
    });
});
