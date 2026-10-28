/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildQuery, MAX_ANSWER_BYTES } from "../src/main/dns/message";
import { FetchLike, FetchResponse, VERIFY_NAME, VERIFY_TIMEOUT_MS, verifyProvider } from "../src/main/dns/verify";

const GOOD = Uint8Array.from([
    0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0,
    7, ...[..."discord"].map(c => c.charCodeAt(0)), 3, ...[..."com"].map(c => c.charCodeAt(0)), 0, 0, 1, 0, 1,
    0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 162, 159, 135, 232
]);

const respond = (body: Uint8Array | null, extra: { status?: number; type?: string | null; chunks?: number; } = {}): FetchResponse => {
    const chunks: Uint8Array[] = [];
    if (body) {
        const size = Math.max(1, Math.ceil(body.length / (extra.chunks ?? 1)));
        for (let at = 0; at < body.length; at += size) chunks.push(body.subarray(at, at + size));
    }
    let index = 0;
    let cancelled = false;
    return {
        status: extra.status ?? 200,
        headers: { get: name => (name.toLowerCase() === "content-type" ? (extra.type === undefined ? "application/dns-message" : extra.type) : null) },
        body: body === null ? null : {
            getReader: () => ({
                read: async () => (cancelled || index >= chunks.length ? { done: true } : { done: false, value: chunks[index++] }),
                cancel: async () => { cancelled = true; }
            })
        }
    };
};

function setup(fetch: FetchLike, timeoutMs?: number) {
    let clock = 1000;
    const calls: Array<{ url: string; init: Parameters<FetchLike>[1]; }> = [];
    let fire: () => void = () => undefined;
    let cancelled = false;
    const deps = {
        fetch: (async (url: string, init: Parameters<FetchLike>[1]) => { calls.push({ url, init }); clock += 38; return fetch(url, init); }) as FetchLike,
        now: () => clock,
        after: (work: () => void) => { fire = work; return () => { cancelled = true; }; },
        ...(timeoutMs === undefined ? {} : { timeoutMs })
    };
    return { deps, calls, timeout: () => { fire(); }, timerCancelled: () => cancelled, tick: (ms: number) => { clock += ms; } };
}

describe("checking a provider", () => {
    it("asks for discord.com in the standard binary format, with a POST, no redirects, and says how long it took", async () => {
        const t = setup(async () => respond(GOOD));
        const result = await verifyProvider("https://dns.example.org/dns-query", t.deps);
        assert.deepEqual(result, { ok: true, reason: "", ms: 38 });
        assert.equal(t.calls.length, 1);
        const { url, init } = t.calls[0]!;
        assert.equal(url, "https://dns.example.org/dns-query");
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "error");
        assert.equal(init.headers["content-type"], "application/dns-message");
        assert.equal(init.headers.accept, "application/dns-message");
        assert.deepEqual([...init.body], [...buildQuery(VERIFY_NAME)]);
        assert.ok(init.signal instanceof AbortSignal);
    });

    it("takes the template ending off the address it posts to", async () => {
        const t = setup(async () => respond(GOOD));
        await verifyProvider("https://dns.example.org/dns-query{?dns}", t.deps);
        assert.equal(t.calls[0]!.url, "https://dns.example.org/dns-query");
    });

    it("accepts the content type with a parameter and in capitals, and an answer that arrives in pieces", async () => {
        for (const type of ["application/dns-message; charset=binary", "Application/DNS-Message"]) {
            assert.equal((await verifyProvider("https://a.test/q", setup(async () => respond(GOOD, { type, chunks: 5 })).deps)).ok, true, type);
        }
    });

    it("refuses another HTTP code, saying which", async () => {
        for (const status of [403, 404, 500, 204]) {
            const result = await verifyProvider("https://a.test/q", setup(async () => respond(GOOD, { status })).deps);
            assert.equal(result.ok, false);
            assert.match(result.reason, new RegExp(`HTTP code ${status}, not 200`));
        }
    });

    it("refuses an answer that is not in the DNS format, and says it may need another address", async () => {
        for (const type of ["application/dns-json", "text/html", "application/json", "", null]) {
            const result = await verifyProvider("https://a.test/q", setup(async () => respond(GOOD, { type })).deps);
            assert.equal(result.ok, false, String(type));
            assert.match(result.reason, /standard DNS format/);
        }
    });

    it("refuses what the DNS reader refuses, with its reason", async () => {
        const noRecords = Uint8Array.from(GOOD.subarray(0, 12)); // header only
        const result = await verifyProvider("https://a.test/q", setup(async () => respond(noRecords)).deps);
        assert.equal(result.ok, false);
        assert.ok(result.reason.length > 10);
        const refused = Uint8Array.from(GOOD); refused[3] = 0x85;
        assert.match((await verifyProvider("https://a.test/q", setup(async () => respond(refused)).deps)).reason, /refused/);
        assert.match((await verifyProvider("https://a.test/q", setup(async () => respond(null)).deps)).reason, /too short/);
    });

    it("refuses an answer larger than 4 KB without reading the rest", async () => {
        const big = new Uint8Array(MAX_ANSWER_BYTES + 100);
        const result = await verifyProvider("https://a.test/q", setup(async () => respond(big, { chunks: 4 })).deps);
        assert.equal(result.ok, false);
        assert.match(result.reason, /too large/);
    });

    /** An answer to the question with one text record padded so that the whole message has exactly `total` bytes. */
    const padded = (total: number) => {
        const head = GOOD.subarray(0, GOOD.length - 16);
        const room = total - head.length - 12;
        return Uint8Array.from([...head, 0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60, room >> 8, room & 0xff, ...new Array<number>(room).fill(65)]);
    };

    it("accepts an answer of exactly 4096 bytes and refuses one of 4097", async () => {
        const exact = padded(MAX_ANSWER_BYTES);
        assert.equal(exact.length, MAX_ANSWER_BYTES);
        assert.equal((await verifyProvider("https://a.test/q", setup(async () => respond(exact, { chunks: 3 })).deps)).ok, true);
        const over = await verifyProvider("https://a.test/q", setup(async () => respond(padded(MAX_ANSWER_BYTES + 1), { chunks: 3 })).deps);
        assert.equal(over.ok, false);
        assert.match(over.reason, /too large/);
    });

    it("stops reading a too large answer as soon as it is too large, and closes the body", async () => {
        let reads = 0;
        let cancelled = false;
        const chunk = new Uint8Array(1500);
        const endless: FetchResponse = {
            status: 200,
            headers: { get: () => "application/dns-message" },
            body: { getReader: () => ({ read: async () => { reads++; return reads > 50 ? { done: true } : { done: false, value: chunk }; }, cancel: async () => { cancelled = true; } }) }
        };
        const result = await verifyProvider("https://a.test/q", setup(async () => endless).deps);
        assert.equal(result.ok, false);
        assert.ok(reads <= 4, "it read " + reads + " pieces");
        assert.equal(cancelled, true);
    });

    it("reports the time rounded to whole milliseconds and never below zero", async () => {
        const times = [100, 138.6];
        const forward = { ...setup(async () => respond(GOOD)).deps, now: () => times.shift() ?? 138.6 };
        assert.equal((await verifyProvider("https://a.test/q", forward)).ms, 39);
        const backwards = [500, 100];
        const odd = { ...setup(async () => respond(GOOD)).deps, now: () => backwards.shift() ?? 100 };
        assert.equal((await verifyProvider("https://a.test/q", odd)).ms, 0);
    });

    it("says it could not reach the provider, with a short error code at most, never the text of the error", async () => {
        const secret = Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443 token=SECRET"), { cause: { code: "ECONNREFUSED" } });
        const refused = await verifyProvider("https://a.test/q", setup(async () => { throw secret; }).deps);
        assert.deepEqual([refused.ok, refused.reason], [false, "the provider could not be reached (ECONNREFUSED)"]);
        for (const error of [new Error("SECRET text"), "SECRET string", null, undefined, { code: "lowercase" }, { cause: { code: "X".repeat(50) } }]) {
            const result = await verifyProvider("https://a.test/q", setup(async () => { throw error; }).deps);
            assert.equal(result.reason, "the provider could not be reached", String(error));
            assert.doesNotMatch(result.reason, /SECRET/);
        }
    });

    it("gives up after the time limit, aborts the request and says how long it waited", async () => {
        let aborted = false;
        const hanging: FetchLike = (_url, init) => new Promise<FetchResponse>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
        });
        const t = setup(hanging);
        const pending = verifyProvider("https://a.test/q", t.deps);
        await Promise.resolve();
        t.timeout();
        const result = await pending;
        assert.equal(aborted, true);
        assert.deepEqual([result.ok, result.reason], [false, "the provider did not answer within 3 seconds"]);
        assert.equal(VERIFY_TIMEOUT_MS, 3000);
    });

    it("uses the limit it is given", async () => {
        const t = setup(async () => respond(GOOD), 5000);
        let seen = 0;
        const result = await verifyProvider("https://a.test/q", { ...t.deps, after: (work, ms) => { seen = ms; void work; return () => undefined; } });
        assert.equal(seen, 5000);
        assert.equal(result.ok, true);
        const t2 = setup(async () => respond(GOOD));
        await verifyProvider("https://a.test/q", { ...t2.deps, after: (_w, ms) => { seen = ms; return () => undefined; } });
        assert.equal(seen, 3000);
    });

    it("always cancels its timer, whatever happened", async () => {
        const ok = setup(async () => respond(GOOD));
        await verifyProvider("https://a.test/q", ok.deps);
        assert.equal(ok.timerCancelled(), true);
        const bad = setup(async () => { throw new Error("x"); });
        await verifyProvider("https://a.test/q", bad.deps);
        assert.equal(bad.timerCancelled(), true);
    });

    it("never throws, even when the reader of the body fails", async () => {
        const broken: FetchResponse = { status: 200, headers: { get: () => "application/dns-message" }, body: { getReader: () => ({ read: async () => { throw new Error("body failed"); }, cancel: async () => undefined }) } };
        const result = await verifyProvider("https://a.test/q", setup(async () => broken).deps);
        assert.equal(result.ok, false);
        assert.equal(result.reason, "the provider could not be reached");
    });
});
