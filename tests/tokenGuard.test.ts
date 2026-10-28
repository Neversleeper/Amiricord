/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RequestDetails } from "../src/main/requestHub";
import { makeTokenGuard, TOKEN_GUARD_NAME, TOKEN_LOG_ENTRIES } from "../src/main/tokenGuard";

const get = (url: string, headers: Record<string, string> | undefined, extra: Partial<RequestDetails> = {}): RequestDetails => ({ url, method: "GET", resourceType: "xhr", ...(headers ? { requestHeaders: headers } : {}), ...extra });
const TOKEN = "NOT-A-REAL-TOKEN-0123456789";

function setup(patterns: readonly string[] | (() => readonly string[]) = [], maxLog?: number) {
    let clock = 9000;
    const guard = makeTokenGuard({ now: () => clock, tokenHosts: typeof patterns === "function" ? patterns : () => patterns, ...(maxLog === undefined ? {} : { maxLog }) });
    const run = (details: RequestDetails) => guard.handler.beforeSendHeaders!(details);
    return { guard, run, tick: (ms: number) => { clock += ms; } };
}

describe("the token guard", () => {
    it("is a handler of the hub that only answers before headers are sent", () => {
        const t = setup();
        assert.equal(t.guard.handler.name, TOKEN_GUARD_NAME);
        assert.equal(t.guard.handler.beforeRequest, undefined);
    });

    it("keeps the header for Discord's own hosts and their subdomains", () => {
        const t = setup();
        for (const url of ["https://discord.com/api/v9/users/@me", "https://canary.discord.com/api/v9/x", "https://ptb.discord.com/", "https://cdn.discordapp.com/x", "https://media.discordapp.net/x", "https://discord.gg/x", "https://latency.discord.media/x"]) {
            assert.equal(t.run(get(url, { Authorization: TOKEN })), undefined, url);
        }
        assert.deepEqual(t.guard.status(), { inspected: 7, kept: 7, stripped: 0 });
    });

    it("removes the header, and nothing else, for any other host, and lets the request go on", () => {
        const t = setup();
        const answer = t.run(get("https://example.test/api", { Authorization: TOKEN, Accept: "*/*", "X-Other": "keep me" }));
        assert.deepEqual(answer, { requestHeaders: { Accept: "*/*", "X-Other": "keep me" } });
        assert.deepEqual(t.guard.status(), { inspected: 1, kept: 0, stripped: 1 });
    });

    it("does not change the headers it was given", () => {
        const t = setup();
        const headers = { Authorization: TOKEN, Accept: "*/*" };
        t.run(get("https://example.test/", headers));
        assert.deepEqual(headers, { Authorization: TOKEN, Accept: "*/*" });
    });

    it("finds the header whatever the case, and removes every spelling of it", () => {
        const t = setup();
        for (const name of ["authorization", "AUTHORIZATION", "AuThOrIzAtIoN"]) {
            const answer = t.run(get("https://example.test/", { [name]: TOKEN, Accept: "x" }));
            assert.deepEqual(answer, { requestHeaders: { Accept: "x" } }, name);
        }
        const twice = t.run(get("https://example.test/", { Authorization: TOKEN, authorization: TOKEN, Accept: "x" }));
        assert.deepEqual(twice, { requestHeaders: { Accept: "x" } });
    });

    it("does not touch a header that only looks like it", () => {
        const t = setup();
        const others: Array<Record<string, string>> = [{ "X-Authorization": "x" }, { "Proxy-Authorization": "x" }, { Authorisation: "x" }, { Cookie: "x" }, {}];
        for (const headers of others) {
            assert.equal(t.run(get("https://example.test/", headers)), undefined);
        }
        assert.equal(t.guard.status().inspected, 0);
    });

    it("keeps the header for a host an enabled token plugin declared, exact or under a star domain", () => {
        const t = setup(["api.plugin.test", "*.cdn.plugin.test"]);
        for (const url of ["https://api.plugin.test/x", "https://a.cdn.plugin.test/x", "https://a.b.cdn.plugin.test/x"]) assert.equal(t.run(get(url, { Authorization: TOKEN })), undefined, url);
        for (const url of ["https://other.plugin.test/x", "https://x.api.plugin.test/x", "https://cdn.plugin.test/x", "https://api.plugin.test.evil.test/x", "https://notapi.plugin.test/x"]) {
            assert.ok(t.run(get(url, { Authorization: TOKEN })), url);
        }
        assert.deepEqual(t.guard.status(), { inspected: 8, kept: 3, stripped: 5 });
    });

    it("asks for the declared hosts each time, so a change of settings is felt at once", () => {
        let patterns: string[] = [];
        const t = setup(() => patterns);
        assert.ok(t.run(get("https://plugin.test/", { Authorization: TOKEN })));
        patterns = ["plugin.test"];
        assert.equal(t.run(get("https://plugin.test/", { Authorization: TOKEN })), undefined);
    });

    it("does not mistake look-alikes of Discord's hosts for them", () => {
        const t = setup();
        for (const url of ["https://notdiscord.com/", "https://discord.com.evil.test/", "https://discordapp.org/", "https://discord.community/", "https://evil.test/discord.com", "https://discord.com@evil.test/", "https://mydiscord.gg/"]) {
            assert.ok(t.run(get(url, { Authorization: TOKEN })), url);
        }
        assert.equal(t.guard.status().stripped, 7);
    });

    it("only judges web addresses with headers, and never fails on odd input", () => {
        const t = setup();
        for (const details of [get("wss://example.test/", { Authorization: TOKEN }), get("file:///x", { Authorization: TOKEN }), get("not an address", { Authorization: TOKEN }), get("https://example.test/", undefined), get("", { Authorization: TOKEN })]) {
            assert.equal(t.run(details), undefined);
        }
        assert.equal(t.guard.status().inspected, 0);
    });

    it("removes the token from a stranger, and keeps it for Discord, when it cannot tell what is allowed", () => {
        const t = setup(() => { throw new Error("no registry"); });
        assert.ok(t.run(get("https://example.test/", { Authorization: TOKEN })));
        assert.equal(t.run(get("https://discord.com/api", { Authorization: TOKEN })), undefined);
        assert.deepEqual(t.guard.status(), { inspected: 2, kept: 1, stripped: 1 });
    });

    it("counts without keeping a value, a query or an id, and logs only the time, the method, the host and the shape of the path", () => {
        const t = setup();
        t.tick(300);
        t.run(get("https://evil.test/api/v9/users/123456789012345678/x?token=SECRET#frag", { Authorization: TOKEN, Cookie: "SECRET-COOKIE" }, { method: "post" }));
        assert.deepEqual(t.guard.log(), [{ at: 9300, method: "POST", host: "evil.test", path: "/api/v9/users" }]);
        assert.doesNotMatch(JSON.stringify(t.guard.log()) + JSON.stringify(t.guard.status()), /SECRET|NOT-A-REAL|123456789012345678|Cookie/);
    });

    it("does not log what it kept", () => {
        const t = setup();
        t.run(get("https://discord.com/api", { Authorization: TOKEN }));
        assert.deepEqual(t.guard.log(), []);
    });

    it("stores only a plain word as the method, and cuts a long host", () => {
        const t = setup();
        t.run(get("https://" + "a".repeat(60) + "." + "b".repeat(60) + ".test/", { Authorization: TOKEN }, { method: "GET /x?y=1" }));
        const [entry] = t.guard.log();
        assert.equal(entry!.method, "?");
        assert.equal(entry!.host.length, 100);
    });

    it("keeps a bounded log: the oldest entries go, the counter keeps counting", () => {
        const t = setup([], 3);
        for (let i = 0; i < 10; i++) { t.tick(1); t.run(get("https://h" + i + ".test/", { Authorization: TOKEN })); }
        assert.deepEqual(t.guard.log().map(entry => entry.host), ["h7.test", "h8.test", "h9.test"]);
        assert.equal(t.guard.status().stripped, 10);
    });

    it("keeps 500 entries by default and at least one", () => {
        assert.equal(TOKEN_LOG_ENTRIES, 500);
        const t = setup();
        for (let i = 0; i < 501; i++) t.run(get("https://x.test/", { Authorization: TOKEN }));
        assert.equal(t.guard.log().length, 500);
        const small = setup([], 0);
        small.run(get("https://x.test/", { Authorization: TOKEN }));
        small.run(get("https://x.test/", { Authorization: TOKEN }));
        assert.equal(small.guard.log().length, 1);
    });

    it("hands out copies of its status and its log", () => {
        const t = setup();
        t.run(get("https://x.test/", { Authorization: TOKEN }));
        t.guard.status().stripped = 99;
        t.guard.log()[0]!.host = "changed";
        assert.equal(t.guard.status().stripped, 1);
        assert.equal(t.guard.log()[0]!.host, "x.test");
    });

    it("can say what it would do without counting anything", () => {
        const t = setup();
        assert.deepEqual(t.guard.judge(get("https://x.test/", { Authorization: TOKEN, A: "1" })), { requestHeaders: { A: "1" } });
        assert.equal(t.guard.judge(get("https://discord.com/", { Authorization: TOKEN })), undefined);
        assert.equal(t.guard.judge(get("https://x.test/", {})), undefined);
        assert.deepEqual(t.guard.status(), { inspected: 0, kept: 0, stripped: 0 });
        assert.deepEqual(t.guard.log(), []);
    });
});
