/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    addRule, FILE_SCHEMA, HOST_RULE_LIMITS, HostRule, isProtectedHost, isUnder, makeHostMatcher, normalizeHost, parseRuleFile, PROTECTED_HOSTS, removeRule, serializeRules
} from "../src/shared/hostRules";

const rule = (host: string, extra: Partial<HostRule> = {}): HostRule => ({ id: "r1", host, subdomains: true, action: "block", reason: "", created: 0, ...extra });
const file = (rules: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ schema: 1, rules, ...extra });

describe("the host name check", () => {
    it("accepts plain names, in lowercase, with the dot at the end taken off", () => {
        assert.equal(normalizeHost("m.stripe.com"), "m.stripe.com");
        assert.equal(normalizeHost("  M.Stripe.COM  "), "m.stripe.com");
        assert.equal(normalizeHost("stripe.com."), "stripe.com");
        assert.equal(normalizeHost("a-b.example.co.uk"), "a-b.example.co.uk");
        assert.equal(normalizeHost("xn--bcher-kva.example"), "xn--bcher-kva.example");
        assert.equal(normalizeHost("1.example.com"), "1.example.com");
    });

    it("refuses everything that is not a plain host name", () => {
        for (const value of [
            "", "a", "ab", "localhost", "*.stripe.com", "stripe.*", "https://stripe.com", "stripe.com/path", "stripe.com:443", "stripe.com?x=1", "stripe .com", "stripe..com",
            ".stripe.com", "-a.example.com", "a-.example.com", "a_b.example.com", "bücher.example", "例え.jp", "127.0.0.1", "10.0.0", "1.2.3.4", "[::1]", "a@b.com",
            "x".repeat(64) + ".com", "a.".repeat(130) + "com", null, undefined, 5, {}, [], true
        ]) {
            assert.equal(normalizeHost(value), null, JSON.stringify(value));
        }
    });

    it("accepts a name of exactly 253 characters and refuses 254", () => {
        const long = ["a".repeat(63), "a".repeat(63), "a".repeat(63), "a".repeat(57), "com"].join(".");
        assert.equal(long.length, 253);
        assert.notEqual(normalizeHost(long), null);
        assert.equal(normalizeHost("a" + long), null, "254 characters, and the first label is 64 long too");
        assert.equal(normalizeHost(["a".repeat(63), "a".repeat(63), "a".repeat(63), "a".repeat(58), "com"].join(".")), null, "254 characters");
    });
});

describe("the protected hosts", () => {
    it("names Discord's own hosts, and their subdomains", () => {
        assert.deepEqual([...PROTECTED_HOSTS], ["discord.com", "discordapp.com", "discordapp.net", "discord.gg", "discord.media"]);
        for (const host of ["discord.com", "canary.discord.com", "cdn.discordapp.com", "media.discordapp.net", "discord.gg", "latency.discord.media"]) assert.equal(isProtectedHost(host), true, host);
    });

    it("does not catch look-alikes", () => {
        for (const host of ["notdiscord.com", "discord.com.evil.test", "discordapp.org", "mydiscord.gg", "discord.community", "stripe.com"]) assert.equal(isProtectedHost(host), false, host);
        assert.equal(isUnder("a.b.com", "b.com"), true);
        assert.equal(isUnder("ab.com", "b.com"), false);
    });
});

describe("reading the rules file", () => {
    it("reads good rules, with the defaults for what is missing", () => {
        const parsed = parseRuleFile(file([{ host: "m.stripe.com", action: "block" }, { host: "Ads.Example.com", action: "block", subdomains: false, reason: "tracking", created: 1234.9, id: "r7" }]));
        assert.deepEqual(parsed.problems, []);
        assert.deepEqual(parsed.rules, [
            { id: "r8", host: "m.stripe.com", subdomains: true, action: "block", reason: "", created: 0 },
            { id: "r7", host: "ads.example.com", subdomains: false, action: "block", reason: "tracking", created: 1234 }
        ]);
    });

    it("gives every rule without an id (or with a repeated or odd one) the next free id", () => {
        const parsed = parseRuleFile(file([
            { host: "a.test", action: "block", id: "r2" }, { host: "b.test", action: "block", id: "r2" }, { host: "c.test", action: "block" },
            { host: "d.test", action: "block", id: "x1" }, { host: "e.test", action: "block", id: 5 }
        ]));
        assert.deepEqual(parsed.rules.map(r => r.id), ["r2", "r3", "r4", "r5", "r6"]);
        assert.equal(new Set(parsed.rules.map(r => r.id)).size, 5);
    });

    it("drops a rule that is wrong and tells why, keeping the others", () => {
        const parsed = parseRuleFile(file([
            "text", null, 3, [], { host: "good.test", action: "block" }, { host: "*.bad.test", action: "block" }, { host: "https://bad2.test/x", action: "block" },
            { host: "allowed.test", action: "allow" }, { host: "nothing.test" }, { host: 5, action: "block" }, { host: "good.test", action: "block", reason: "again" }
        ]));
        assert.deepEqual(parsed.rules.map(r => r.host), ["good.test"]);
        assert.equal(parsed.problems.length, 10);
        assert.match(parsed.problems.join("\n"), /not an object/);
        assert.match(parsed.problems.join("\n"), /\*\.bad\.test/);
        assert.match(parsed.problems.join("\n"), /allowed\.test has an action this version does not know/);
        assert.match(parsed.problems.join("\n"), /appears twice/);
    });

    it("keeps the first of two rules for the same host", () => {
        const parsed = parseRuleFile(file([{ host: "dup.test", action: "block", reason: "first" }, { host: "DUP.test", action: "block", reason: "second" }]));
        assert.equal(parsed.rules.length, 1);
        assert.equal(parsed.rules[0]!.reason, "first");
    });

    it("keeps a rule for a Discord host but warns that Discord may stop working", () => {
        const parsed = parseRuleFile(file([{ host: "cdn.discordapp.com", action: "block" }]));
        assert.equal(parsed.rules.length, 1);
        assert.match(parsed.problems[0]!, /cdn\.discordapp\.com blocks one of Discord's own hosts/);
    });

    it("cuts a long reason and ignores odd values of the optional fields", () => {
        const parsed = parseRuleFile(file([
            { host: "a.test", action: "block", reason: "x".repeat(500), created: -5 },
            { host: "b.test", action: "block", reason: 5, created: "yesterday", subdomains: "no" },
            { host: "c.test", action: "block", created: Infinity, subdomains: false }
        ]));
        assert.equal(parsed.rules[0]!.reason.length, HOST_RULE_LIMITS.reasonMax);
        assert.equal(parsed.rules[0]!.created, 0);
        assert.deepEqual([parsed.rules[1]!.reason, parsed.rules[1]!.created, parsed.rules[1]!.subdomains], ["", 0, true]);
        assert.equal(parsed.rules[2]!.created, 0);
        assert.equal(parsed.rules[2]!.subdomains, false);
    });

    it("never repeats the owner's words or a strange name in the problems", () => {
        const parsed = parseRuleFile(file([{ host: "bad host with SECRET words and a very long text that goes on and on and on forever and ever", action: "block", reason: "MY-SECRET-REASON" }, { host: "ok.test", action: "nope", reason: "MY-SECRET-REASON" }]));
        assert.doesNotMatch(parsed.problems.join("\n"), /SECRET|MY-/);
        assert.match(parsed.problems[0]!, /\(not a host name\)/);
    });

    it("says that a file is too large, and does not try to read it", () => {
        const parsed = parseRuleFile("x".repeat(HOST_RULE_LIMITS.maxFileChars + 1));
        assert.match(parsed.problems[0]!, /too large/);
        const exact = parseRuleFile(JSON.stringify({ schema: 1, rules: [], pad: "x".repeat(HOST_RULE_LIMITS.maxFileChars - 40) }));
        assert.deepEqual(exact, { rules: [], problems: [] });
    });

    it("takes a time that JSON turns into infinity as no time", () => {
        const parsed = parseRuleFile('{"schema":1,"rules":[{"host":"a.test","action":"block","created":1e999}]}');
        assert.equal(parsed.rules[0]!.created, 0);
    });

    it("never repeats the owner's words in the warning about a Discord host either", () => {
        const parsed = parseRuleFile(file([{ host: "discord.com", action: "block", reason: "MY-SECRET-REASON" }]));
        assert.equal(parsed.problems.length, 1);
        assert.doesNotMatch(parsed.problems[0]!, /SECRET/);
    });

    it("gives no rules and one problem for a file that is broken, too large or of another shape", () => {
        for (const text of ["", "not json", "[]", "null", "{}", JSON.stringify({ schema: 2, rules: [] }), JSON.stringify({ schema: 1 }), JSON.stringify({ schema: 1, rules: {} }), "x".repeat(HOST_RULE_LIMITS.maxFileChars + 1)]) {
            const parsed = parseRuleFile(text);
            assert.deepEqual(parsed.rules, [], text.slice(0, 20));
            assert.equal(parsed.problems.length, 1, text.slice(0, 20));
            assert.match(parsed.problems[0]!, /no host rule is in force/);
        }
        assert.equal(FILE_SCHEMA, 1);
    });

    it("stops at the limit of rules and says so once", () => {
        const many = Array.from({ length: HOST_RULE_LIMITS.maxRules + 5 }, (_, i) => ({ host: "h" + i + ".test", action: "block" }));
        const parsed = parseRuleFile(file(many));
        assert.equal(parsed.rules.length, HOST_RULE_LIMITS.maxRules);
        assert.equal(parsed.problems.length, 1);
        assert.match(parsed.problems[0]!, /more than 10000 rules/);
    });

    it("reports at most 20 problems", () => {
        const parsed = parseRuleFile(file(Array.from({ length: 100 }, () => 5)));
        assert.equal(parsed.problems.length, HOST_RULE_LIMITS.maxProblems);
    });

    it("does not let a rule through the prototype", () => {
        const parsed = parseRuleFile("{\"schema\":1,\"rules\":[{\"__proto__\":{\"host\":\"x.test\",\"action\":\"block\"}},{\"host\":\"ok.test\",\"action\":\"block\"}]}");
        assert.deepEqual(parsed.rules.map(r => r.host), ["ok.test"]);
    });
});

describe("writing and changing the rules", () => {
    it("writes text that reads back the same", () => {
        const rules = [rule("a.test", { id: "r1", reason: "one" }), rule("b.test", { id: "r2", subdomains: false, created: 55 })];
        const parsed = parseRuleFile(serializeRules(rules));
        assert.deepEqual(parsed, { rules, problems: [] });
        assert.match(serializeRules([]), /"rules": \[\]/);
        assert.ok(serializeRules(rules).endsWith("\n"));
    });

    it("adds a rule with the next id, the time and the defaults", () => {
        const result = addRule([rule("a.test", { id: "r4" })], { host: " B.Test ", reason: "why" }, 1500.7);
        assert.ok(result.ok);
        if (result.ok) {
            assert.deepEqual(result.rule, { id: "r5", host: "b.test", subdomains: true, action: "block", reason: "why", created: 1500 });
            assert.equal(result.rules.length, 2);
        }
        const exact = addRule([], { host: "c.test", subdomains: false }, 0);
        assert.ok(exact.ok && exact.rule.subdomains === false && exact.rule.id === "r1");
    });

    it("gives the id after the highest one, whatever the order of the rules", () => {
        const result = addRule([rule("a.test", { id: "r9" }), rule("b.test", { id: "r2" }), rule("c.test", { id: "odd" })], { host: "d.test" }, 0);
        assert.ok(result.ok && result.rule.id === "r10");
    });

    it("refuses a bad host, Discord's own hosts, a repeat, a long reason and too many rules, and changes nothing", () => {
        const base = [rule("a.test")];
        const why = (input: { host: unknown; reason?: unknown; }) => { const r = addRule(base, input, 0); return r.ok ? "ok" : r.reason; };
        assert.equal(why({ host: "*.x.test" }), "invalid-host");
        assert.equal(why({ host: "https://x.test" }), "invalid-host");
        assert.equal(why({ host: "discord.com" }), "protected-host");
        assert.equal(why({ host: "Canary.Discord.com" }), "protected-host");
        assert.equal(why({ host: "cdn.discordapp.com" }), "protected-host");
        assert.equal(why({ host: "A.TEST" }), "duplicate");
        assert.equal(why({ host: "b.test", reason: "x".repeat(201) }), "reason-too-long");
        assert.equal(why({ host: "b.test", reason: 5 }), "reason-too-long");
        assert.equal(why({ host: "b.test", reason: "x".repeat(200) }), "ok");
        const full = Array.from({ length: HOST_RULE_LIMITS.maxRules }, (_, i) => rule("h" + i + ".test", { id: "r" + (i + 1) }));
        const r = addRule(full, { host: "new.test" }, 0);
        assert.deepEqual(r.ok ? null : r.reason, "too-many");
        assert.equal(base.length, 1);
    });

    it("takes a rule out by its id, and leaves the list as it is when there is none", () => {
        const rules = [rule("a.test", { id: "r1" }), rule("b.test", { id: "r2" })];
        assert.deepEqual(removeRule(rules, "r1").map(r => r.host), ["b.test"]);
        assert.equal(removeRule(rules, "r9").length, 2);
        assert.equal(removeRule(rules, undefined).length, 2);
        assert.equal(rules.length, 2);
    });
});

describe("finding the rule that covers a host", () => {
    const match = makeHostMatcher([rule("m.stripe.com", { id: "r1" }), rule("exact.test", { id: "r2", subdomains: false }), rule("example.org", { id: "r3" })]);

    it("finds the host itself and everything under it", () => {
        assert.equal(match("m.stripe.com")?.id, "r1");
        assert.equal(match("a.m.stripe.com")?.id, "r1");
        assert.equal(match("a.b.c.m.stripe.com")?.id, "r1");
        assert.equal(match("example.org")?.id, "r3");
        assert.equal(match("www.example.org")?.id, "r3");
    });

    it("finds an exact-only rule on the exact name and nowhere else", () => {
        assert.equal(match("exact.test")?.id, "r2");
        assert.equal(match("sub.exact.test"), null);
    });

    it("does not catch the parent, a sibling or a look-alike", () => {
        for (const host of ["stripe.com", "js.stripe.com", "r.stripe.com", "notm.stripe.com", "m.stripe.com.evil.test", "xm.stripe.com", "example.org.evil.test", "badexample.org", "org", "com", "", "localhost"]) {
            assert.equal(match(host), null, host);
        }
        assert.equal(match(undefined as unknown as string), null);
    });

    it("prefers the most exact rule", () => {
        const both = makeHostMatcher([rule("stripe.com", { id: "r1" }), rule("m.stripe.com", { id: "r2" })]);
        assert.equal(both("m.stripe.com")?.id, "r2");
        assert.equal(both("x.m.stripe.com")?.id, "r2");
        assert.equal(both("js.stripe.com")?.id, "r1");
    });

    it("uses the first rule when two are for the same host", () => {
        const twice = makeHostMatcher([rule("dup.test", { id: "r1" }), rule("dup.test", { id: "r2" })]);
        assert.equal(twice("dup.test")?.id, "r1");
    });

    it("works with no rules and with many", () => {
        assert.equal(makeHostMatcher([])("a.test"), null);
        const big = makeHostMatcher(Array.from({ length: HOST_RULE_LIMITS.maxRules }, (_, i) => rule("h" + i + ".test", { id: "r" + (i + 1) })));
        assert.equal(big("x.h9999.test")?.id, "r10000");
        assert.equal(big("h10000.test"), null);
    });
});
