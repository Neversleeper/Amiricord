/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CENSUS_MAX_ROWS, CENSUS_NAME, makeCensus, pathShape } from "../src/main/census";
import type { RequestDetails } from "../src/main/requestHub";

const get = (url: string, extra: Partial<RequestDetails> = {}): RequestDetails => ({ url, method: "GET", resourceType: "xhr", ...extra });

function setup(maxRows?: number) {
    let clock = 1000;
    const census = makeCensus({ now: () => clock, ...(maxRows === undefined ? {} : { maxRows }) });
    const see = (details: RequestDetails) => census.handler.beforeRequest!(details);
    /** What the page's request does: first the address is seen, then the headers are about to be sent. */
    const send = (details: RequestDetails) => { census.handler.beforeRequest!(details); return census.handler.beforeSendHeaders!(details); };
    return { census, see, send, tick: (ms: number) => { clock += ms; } };
}

describe("the shape of a path", () => {
    it("keeps versions and plain words, and turns everything else into a star", () => {
        assert.equal(pathShape("/api/v9/science"), "/api/v9/science");
        assert.equal(pathShape("/api/v9/channels/123456789012345678/messages"), "/api/v9/channels");
        assert.equal(pathShape("/api/v9/users/123456789012345678"), "/api/v9/users");
        assert.equal(pathShape("/users/123456789012345678/avatars"), "/users/*/avatars");
        assert.equal(pathShape("/assets/0a1b2c3d4e5f.js"), "/assets/*");
        assert.equal(pathShape("/Secret-Token_ABC"), "/*");
        assert.equal(pathShape("/"), "/");
        assert.equal(pathShape(""), "/");
    });

    it("never keeps more than three parts, and never a query or a fragment", () => {
        assert.equal(pathShape("/a/b/c/d/e"), "/a/b/c");
        assert.doesNotMatch(pathShape("/api/v9/science"), /[?#=]/);
    });

    it("does not keep a word longer than 24 letters or with digits (it could be a token)", () => {
        assert.equal(pathShape("/abcdefghijklmnopqrstuvwxy"), "/*");
        assert.equal(pathShape("/ab12"), "/*");
    });
});

describe("the census", () => {
    it("only looks: it never answers a request", () => {
        const t = setup();
        assert.equal(t.see(get("https://discord.com/api/v9/science")), undefined);
        assert.equal(t.send(get("https://discord.com/api/v9/users/@me", { requestHeaders: { Authorization: "x" } })), undefined);
        assert.equal(t.census.handler.name, CENSUS_NAME);
    });

    it("counts by method, host, shape and type, with first and last time", () => {
        const t = setup();
        t.see(get("https://discord.com/api/v9/science"));
        t.tick(500);
        t.see(get("https://discord.com/api/v9/science"));
        t.see(get("https://discord.com/api/v9/science", { method: "POST" }));
        t.see(get("https://sentry.io/api/123/envelope/"));
        const snap = t.census.snapshot();
        assert.equal(snap.total, 4);
        assert.equal(snap.rows.length, 3);
        assert.deepEqual(snap.rows[0], { method: "GET", host: "discord.com", path: "/api/v9/science", type: "xhr", count: 2, withAuth: 0, first: 1000, last: 1500 });
    });

    it("keeps no query, no id, no header and no body", () => {
        const t = setup();
        t.see(get("https://discord.com/api/v9/channels/123456789012345678/messages?token=SECRET&after=999", { requestHeaders: { Authorization: "SECRET-TOKEN" }, uploadData: [{ bytes: "SECRET-BODY" }] }));
        const text = JSON.stringify(t.census.snapshot());
        assert.doesNotMatch(text, /SECRET|123456789012345678|token|after|999|Authorization/i);
    });

    it("lowercases the host and groups different cases together", () => {
        const t = setup();
        t.see(get("https://Discord.COM/api/v9/science"));
        t.see(get("https://discord.com/api/v9/science"));
        assert.equal(t.census.snapshot().rows.length, 1);
    });

    it("tells the same address apart by the type of the request", () => {
        const t = setup();
        t.see(get("https://a.test/x", { resourceType: "xhr" }));
        t.see(get("https://a.test/x", { resourceType: "image" }));
        assert.equal(t.census.snapshot().rows.length, 2);
    });

    it("holds 300 shapes by default", () => {
        const t = setup();
        assert.equal(CENSUS_MAX_ROWS, 300);
        for (let i = 0; i < 301; i++) t.see(get(`https://h${i}.test/x`));
        const snap = t.census.snapshot();
        assert.equal(snap.rows.length, 300);
        assert.equal(snap.other, 1);
    });

    it("ignores addresses it cannot read and schemes that are not web traffic", () => {
        const t = setup();
        t.see(get("not an address"));
        t.see(get("file:///C:/secret.txt"));
        t.see(get("devtools://devtools/bundled/x.html"));
        t.see(get("data:text/plain,hello"));
        assert.deepEqual(t.census.snapshot(), { rows: [], other: 0, total: 0, authTotal: 0, authOutsideDiscord: 0 });
    });

    it("counts web sockets too", () => {
        const t = setup();
        t.see(get("wss://gateway.discord.gg/?v=9&encoding=etf", { method: "GET", resourceType: "webSocket" }));
        assert.equal(t.census.snapshot().rows[0]!.host, "gateway.discord.gg");
        assert.equal(t.census.snapshot().rows[0]!.path, "/");
    });

    it("replaces odd method and type values by a question mark, so nothing arbitrary is stored", () => {
        const t = setup();
        t.see({ url: "https://discord.com/x", method: "GET /secret?token=1", resourceType: "../etc" });
        const row = t.census.snapshot().rows[0]!;
        assert.equal(row.method, "?");
        assert.equal(row.type, "?");
        t.see({ url: "https://discord.com/y" });
        assert.equal(t.census.snapshot().rows[1]!.method, "?");
    });

    it("is bounded: new shapes past the limit are counted in `other`, known ones keep counting", () => {
        const t = setup(2);
        t.see(get("https://a.test/one"));
        t.see(get("https://b.test/one"));
        t.see(get("https://c.test/one"));
        t.see(get("https://d.test/one"));
        t.see(get("https://a.test/one"));
        const snap = t.census.snapshot();
        assert.equal(snap.rows.length, 2);
        assert.equal(snap.other, 2);
        assert.equal(snap.total, 5);
        assert.equal(snap.rows.find(row => row.host === "a.test")!.count, 2);
    });

    it("sorts the most frequent first, then by host and path", () => {
        const t = setup();
        t.see(get("https://b.test/x"));
        t.see(get("https://a.test/x"));
        t.see(get("https://c.test/x"));
        t.see(get("https://c.test/x"));
        assert.deepEqual(t.census.snapshot().rows.map(row => row.host), ["c.test", "a.test", "b.test"]);
    });

    it("hands out copies, so a reader cannot change the table", () => {
        const t = setup();
        t.see(get("https://a.test/x"));
        t.census.snapshot().rows[0]!.count = 999;
        assert.equal(t.census.snapshot().rows[0]!.count, 1);
    });
});

describe("the token census (P5a)", () => {
    const auth = (value = "NOT-A-REAL-TOKEN-123") => ({ requestHeaders: { Authorization: value, Accept: "*/*" } });

    it("counts, per row and in all, the requests that carry an Authorization header", () => {
        const t = setup();
        t.send(get("https://discord.com/api/v9/users/@me", auth()));
        t.send(get("https://discord.com/api/v9/users/@me", auth()));
        t.send(get("https://discord.com/api/v9/users/@me", { requestHeaders: { Accept: "*/*" } }));
        const snap = t.census.snapshot();
        assert.equal(snap.rows.length, 1);
        assert.equal(snap.rows[0]!.count, 3);
        assert.equal(snap.rows[0]!.withAuth, 2);
        assert.equal(snap.authTotal, 2);
        assert.equal(snap.authOutsideDiscord, 0);
    });

    it("tells the requests that carry it to a host that is not Discord's, and names that host in its row", () => {
        const t = setup();
        t.send(get("https://discord.com/api/v9/x", auth()));
        t.send(get("https://cdn.discordapp.com/x", auth()));
        t.send(get("https://example.test/api/data", auth()));
        t.send(get("https://notdiscord.com/", auth()));
        t.send(get("https://discord.com.evil.test/", auth()));
        const snap = t.census.snapshot();
        assert.equal(snap.authTotal, 5);
        assert.equal(snap.authOutsideDiscord, 3);
        assert.equal(snap.rows.find(row => row.host === "example.test")!.withAuth, 1);
    });

    it("finds the header whatever the case of its name", () => {
        const t = setup();
        for (const name of ["authorization", "AUTHORIZATION", "AuThOrIzAtIoN"]) t.send(get("https://example.test/", { requestHeaders: { [name]: "x" } }));
        assert.equal(t.census.snapshot().authTotal, 3);
    });

    it("does not count a header that only looks like it, or no header at all", () => {
        const t = setup();
        t.send(get("https://example.test/", { requestHeaders: { "X-Authorization": "x", "Proxy-Authorization": "x", Authorisation: "x" } }));
        t.send(get("https://example.test/", {}));
        t.send(get("https://example.test/", { requestHeaders: {} }));
        assert.equal(t.census.snapshot().authTotal, 0);
    });

    it("never keeps the value of the header, nor any other header", () => {
        const t = setup();
        t.send(get("https://example.test/api?q=SECRET-QUERY", { requestHeaders: { Authorization: "SECRET-TOKEN-VALUE", Cookie: "SECRET-COOKIE", "X-Super-Properties": "SECRET-PROPS" } }));
        const text = JSON.stringify(t.census.snapshot());
        assert.doesNotMatch(text, /SECRET|Cookie|Super|Authorization/i);
    });

    it("counts a request whose row did not fit in the table, but not in any row", () => {
        const t = setup(1);
        t.send(get("https://a.test/", auth()));
        t.send(get("https://b.test/", auth()));
        const snap = t.census.snapshot();
        assert.equal(snap.rows.length, 1);
        assert.equal(snap.rows[0]!.withAuth, 1);
        assert.equal(snap.authTotal, 2);
        assert.equal(snap.authOutsideDiscord, 2);
    });

    it("ignores what is not web traffic, and does not fail on odd input", () => {
        const t = setup();
        t.send(get("file:///x", auth()));
        t.send(get("not an address", auth()));
        t.send(get("wss://example.test/", auth()));
        t.send(get("data:text/plain,x", auth()));
        assert.equal(t.census.snapshot().authTotal, 1, "only the websocket address counts, like in the request census");
        assert.doesNotThrow(() => t.census.handler.beforeSendHeaders!({ url: "https://a.test/", requestHeaders: undefined } as unknown as RequestDetails));
    });

    it("does not count a request twice when its headers are asked twice", () => {
        const t = setup();
        t.see(get("https://a.test/"));
        const d = get("https://a.test/", auth());
        t.census.handler.beforeSendHeaders!(d);
        assert.equal(t.census.snapshot().rows[0]!.withAuth, 1);
        assert.equal(t.census.snapshot().rows[0]!.count, 1);
    });

    it("gives copies, so a reader cannot change the counts", () => {
        const t = setup();
        t.send(get("https://a.test/", auth()));
        const snap = t.census.snapshot();
        snap.rows[0]!.withAuth = 99;
        snap.authTotal = 99;
        assert.equal(t.census.snapshot().rows[0]!.withAuth, 1);
        assert.equal(t.census.snapshot().authTotal, 1);
    });
});
