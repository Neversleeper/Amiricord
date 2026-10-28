/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerNativeCall, hostMatches, isPlainData, type NativeEvent, NativeHost, type NativeHostApi, type NativePlugin, type NativeResponse } from "../src/main/nativeHost";

const response = (status: number, headers: Record<string, string> = {}): NativeResponse => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => "",
    json: async () => ({})
});

function setup(options: { module?: Record<string, unknown>; functions?: string[]; hosts?: string[]; answers?: Record<string, NativeResponse>; callTimeoutMs?: number; maxResultBytes?: number; hangFetch?: boolean; fetchTimeoutMs?: number; } = {}) {
    const events: NativeEvent[] = [];
    const fetched: Array<{ url: string; init: Record<string, unknown>; }> = [];
    let loads = 0;
    const entry: NativePlugin = {
        functions: options.functions ?? Object.keys(options.module ?? {}),
        hosts: options.hosts ?? ["www.pinterest.com"],
        load: () => { loads++; return options.module ?? {}; }
    };
    const host = new NativeHost({
        plugins: { Pin: entry },
        fetch: async (url, init) => {
            fetched.push({ url, init });
            if (options.hangFetch) await new Promise<void>((_, reject) => { init.signal.addEventListener("abort", () => reject(new Error("aborted"))); });
            return options.answers?.[url] ?? response(200);
        },
        onEvent: event => { events.push(event); },
        callTimeoutMs: options.callTimeoutMs ?? 50,
        fetchTimeoutMs: options.fetchTimeoutMs,
        maxResultBytes: options.maxResultBytes
    });
    return { host, events, fetched, loads: () => loads };
}

const call = (host: NativeHost, fn: string, ...args: unknown[]) => host.call({ plugin: "Pin", fn, args });

describe("isPlainData", () => {
    it("accepts text, numbers, booleans, null, undefined, arrays and plain objects", () => {
        assert.ok(isPlainData({ a: "x", b: [1, true, null, undefined], c: { d: 2 } }, 1000, false));
        assert.ok(isPlainData(Object.create(null), 1000, false));
    });

    it("refuses functions, class instances, symbols, bigints, NaN and Infinity", () => {
        assert.ok(!isPlainData({ f: () => 1 }, 1000, false));
        assert.ok(!isPlainData(new Date(), 1000, false));
        assert.ok(!isPlainData(new Map(), 1000, false));
        assert.ok(!isPlainData(Symbol("x"), 1000, false));
        assert.ok(!isPlainData(1n, 1000, false));
        assert.ok(!isPlainData(NaN, 1000, false));
        assert.ok(!isPlainData(Infinity, 1000, false));
    });

    it("refuses a cycle but accepts the same object used twice", () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        assert.ok(!isPlainData(cycle, 1000, false));
        const shared = { n: 1 };
        assert.ok(isPlainData([shared, shared], 1000, false));
    });

    it("refuses what is too deep, too wide or too big", () => {
        let deep: unknown = 1;
        for (let i = 0; i < 9; i++) deep = [deep];
        assert.ok(!isPlainData(deep, 1000, false));
        let ok: unknown = 1;
        for (let i = 0; i < 7; i++) ok = [ok];
        assert.ok(isPlainData(ok, 1000, false));
        assert.ok(!isPlainData(new Array(10_001).fill(0), 1_000_000, false));
        assert.ok(!isPlainData("x".repeat(600), 1000, false));
        assert.ok(isPlainData("x".repeat(400), 1000, false));
    });

    it("refuses the key __proto__", () => {
        assert.ok(!isPlainData(JSON.parse('{"__proto__": {"x": 1}}'), 1000, false));
    });

    it("accepts byte buffers only when binary is allowed, and counts their size", () => {
        assert.ok(!isPlainData(new ArrayBuffer(4), 1000, false));
        assert.ok(!isPlainData(new Uint8Array(4), 1000, false));
        assert.ok(isPlainData(new ArrayBuffer(4), 1000, true));
        assert.ok(isPlainData({ data: new Uint8Array(4) }, 1000, true));
        assert.ok(!isPlainData(new ArrayBuffer(2000), 1000, true));
    });
});

describe("hostMatches", () => {
    it("matches the same name in any letter case", () => {
        assert.ok(hostMatches("WWW.Pinterest.com", "www.pinterest.com"));
        assert.ok(!hostMatches("pinterest.com", "www.pinterest.com"));
        assert.ok(!hostMatches("www.pinterest.com.evil.com", "www.pinterest.com"));
    });

    it("matches subdomains for *.domain but never the bare domain or a look-alike", () => {
        assert.ok(hostMatches("a.pinimg.com", "*.pinimg.com"));
        assert.ok(hostMatches("a.b.pinimg.com", "*.pinimg.com"));
        assert.ok(!hostMatches("pinimg.com", "*.pinimg.com"));
        assert.ok(!hostMatches("evilpinimg.com", "*.pinimg.com"));
    });
});

describe("NativeHost.call", () => {
    it("runs a declared function with the arguments and gives back its answer", async () => {
        const t = setup({ module: { add: (_host: NativeHostApi, a: number, b: number) => a + b } });
        assert.deepEqual(await call(t.host, "add", 2, 3), { ok: true, value: 5 });
        assert.deepEqual(t.events, [{ type: "call", plugin: "Pin", fn: "add", ok: true }]);
    });

    it("waits for an async function, and accepts a function that answers nothing", async () => {
        const t = setup({ module: { slow: async () => "done", none: () => undefined } });
        assert.deepEqual(await call(t.host, "slow"), { ok: true, value: "done" });
        assert.deepEqual(await call(t.host, "none"), { ok: true, value: undefined });
    });

    it("loads the plugin's code at the first call only", async () => {
        const t = setup({ module: { one: () => 1 } });
        assert.equal(t.loads(), 0);
        await call(t.host, "one");
        await call(t.host, "one");
        assert.equal(t.loads(), 1);
    });

    it("never loads code for a call that is refused", async () => {
        const t = setup({ module: { one: () => 1 } });
        await call(t.host, "other");
        await t.host.call({ plugin: "Nobody", fn: "one", args: [] });
        await call(t.host, "one", () => 1);
        assert.equal(t.loads(), 0);
    });

    it("refuses malformed messages", async () => {
        const t = setup({ module: { one: () => 1 } });
        for (const bad of [null, "x", [], { plugin: "Pin", fn: "one" }, { plugin: 1, fn: "one", args: [] }, { plugin: "Pin", fn: 2, args: [] }, { plugin: "Pin", fn: "one", args: "no" }]) {
            const answer = await t.host.call(bad);
            assert.equal(answer.ok, false);
            assert.match((answer as { error: string; }).error, /malformed/);
        }
    });

    it("refuses a plugin that is not running, including names that exist on every object", async () => {
        const t = setup({ module: { one: () => 1 } });
        for (const plugin of ["Nobody", "constructor", "__proto__", "toString"]) {
            const answer = await t.host.call({ plugin, fn: "one", args: [] });
            assert.deepEqual(answer, { ok: false, error: `${plugin}: no native code is running for this plugin.` });
        }
    });

    it("refuses a function the manifest did not declare, even if the code has it", async () => {
        const t = setup({ module: { one: () => 1, secret: () => 2 }, functions: ["one"] });
        const answer = await call(t.host, "secret");
        assert.deepEqual(answer, { ok: false, error: "Pin: secret is not a declared native function." });
        assert.deepEqual(await call(t.host, "toString"), { ok: false, error: "Pin: toString is not a declared native function." });
    });

    it("tells when a declared function is missing from the code", async () => {
        const t = setup({ module: {}, functions: ["ghost"] });
        const answer = await call(t.host, "ghost");
        assert.equal(answer.ok, false);
        assert.match((answer as { error: string; }).error, /does not have it/);
    });

    it("refuses arguments that are not plain data", async () => {
        const t = setup({ module: { one: () => 1 } });
        const answer = await call(t.host, "one", { f: () => 1 });
        assert.equal(answer.ok, false);
        assert.match((answer as { error: string; }).error, /not plain data/);
        assert.equal(t.events.at(-1)?.type, "refused");
    });

    it("turns a throw, even of a non-error, into an answer and reports the failed call", async () => {
        const t = setup({ module: { boom: () => { throw new Error("it broke"); }, odd: async () => { throw "text"; } } });
        assert.deepEqual(await call(t.host, "boom"), { ok: false, error: "Pin: it broke" });
        assert.deepEqual(await call(t.host, "odd"), { ok: false, error: "Pin: text" });
        assert.deepEqual(t.events, [{ type: "call", plugin: "Pin", fn: "boom", ok: false }, { type: "call", plugin: "Pin", fn: "odd", ok: false }]);
    });

    it("answers with an error when the function does not answer in time", async () => {
        const t = setup({ module: { hang: () => new Promise(() => undefined) }, callTimeoutMs: 20 });
        const answer = await call(t.host, "hang");
        assert.deepEqual(answer, { ok: false, error: "Pin: hang did not answer in time." });
    });

    it("refuses an answer that cannot be sent to the page, or that is too big", async () => {
        const t = setup({ module: { fn: () => () => 1, big: () => new ArrayBuffer(100), ok: () => new Uint8Array(4) }, maxResultBytes: 50 });
        assert.match((await call(t.host, "fn") as { error: string; }).error, /cannot be sent/);
        assert.match((await call(t.host, "big") as { error: string; }).error, /cannot be sent/);
        assert.equal((await call(t.host, "ok")).ok, true);
    });

    it("hands the same host object to every call of a plugin, so native code may keep it, and a different one to another plugin", async () => {
        const seen: unknown[] = [];
        const host = new NativeHost({
            plugins: {
                A: { functions: ["go"], hosts: [], load: () => ({ go: (h: unknown) => { seen.push(h); } }) },
                B: { functions: ["go"], hosts: [], load: () => ({ go: (h: unknown) => { seen.push(h); } }) }
            },
            fetch: async () => response(200)
        });
        await host.call({ plugin: "A", fn: "go", args: [] });
        await host.call({ plugin: "A", fn: "go", args: [] });
        await host.call({ plugin: "B", fn: "go", args: [] });
        assert.equal(seen[0], seen[1]);
        assert.notEqual(seen[0], seen[2]);
    });

    it("gives a native function only the secrets its plugin declared, and null for anything else, without ever throwing", async () => {
        const asked: Array<[string, string]> = [];
        const host = new NativeHost({
            plugins: {
                A: { functions: ["go"], hosts: [], secrets: ["cookie"], load: () => ({ go: (h: NativeHostApi) => [h.secret("cookie"), h.secret("other"), h.secret("constructor")] }) },
                B: { functions: ["go"], hosts: [], load: () => ({ go: (h: NativeHostApi) => [h.secret("cookie")] }) }
            },
            fetch: async () => response(200),
            secret: (plugin, name) => { asked.push([plugin, name]); return name === "cookie" ? `${plugin}-value` : "leak"; }
        });
        assert.deepEqual(await host.call({ plugin: "A", fn: "go", args: [] }), { ok: true, value: ["A-value", null, null] });
        assert.deepEqual(await host.call({ plugin: "B", fn: "go", args: [] }), { ok: true, value: [null] });
        assert.deepEqual(asked, [["A", "cookie"]], "the store is asked only for declared names of the plugin itself");
    });

    it("gives null for a secret when there is no store, or the store fails", async () => {
        const plugins = { A: { functions: ["go"], hosts: [], secrets: ["cookie"], load: () => ({ go: (h: NativeHostApi) => h.secret("cookie") }) } };
        const none = new NativeHost({ plugins, fetch: async () => response(200) });
        assert.deepEqual(await none.call({ plugin: "A", fn: "go", args: [] }), { ok: true, value: null });
        const failing = new NativeHost({ plugins, fetch: async () => response(200), secret: () => { throw new Error("dpapi"); } });
        assert.deepEqual(await failing.call({ plugin: "A", fn: "go", args: [] }), { ok: true, value: null });
    });

    it("keeps working when the listener of events throws", async () => {
        const host = new NativeHost({ plugins: { Pin: { functions: ["one"], hosts: [], load: () => ({ one: () => 1 }) } }, fetch: async () => response(200), onEvent: () => { throw new Error("listener"); } });
        assert.deepEqual(await host.call({ plugin: "Pin", fn: "one", args: [] }), { ok: true, value: 1 });
    });
});

describe("host.fetch", () => {
    /** A native function that fetches and answers with the status, because an answer must be plain data. */
    const get = (url: string, init?: Record<string, unknown>) => (host: NativeHostApi) => host.fetch(url, init).then(r => r.status);

    it("fetches a declared host over https, with redirects handled by us and a time limit", async () => {
        const t = setup({ module: { go: (h: NativeHostApi) => h.fetch("https://www.pinterest.com/x", { headers: { A: "1" } }).then(r => r.status) } });
        assert.deepEqual(await call(t.host, "go"), { ok: true, value: 200 });
        assert.equal(t.fetched[0].url, "https://www.pinterest.com/x");
        assert.equal(t.fetched[0].init.redirect, "manual");
        assert.ok(t.fetched[0].init.signal instanceof AbortSignal);
        assert.deepEqual(t.fetched[0].init.headers, { A: "1" });
        assert.deepEqual(t.events[0], { type: "fetch", plugin: "Pin", host: "www.pinterest.com", allowed: true });
    });

    it("refuses an undeclared host, plain http, and a bad URL, without making the request", async () => {
        const t = setup({ module: { other: get("https://example.com/"), plain: get("http://www.pinterest.com/"), bad: get("not a url") } });
        assert.match((await call(t.host, "other") as { error: string; }).error, /example\.com is not declared/);
        assert.match((await call(t.host, "plain") as { error: string; }).error, /not declared/);
        assert.match((await call(t.host, "bad") as { error: string; }).error, /Invalid URL/);
        assert.equal(t.fetched.length, 0);
        assert.ok(t.events.some(e => e.type === "fetch" && e.host === "example.com" && !e.allowed));
    });

    it("follows a redirect inside the declared hosts and refuses one that leaves them", async () => {
        const t = setup({
            hosts: ["www.pinterest.com", "*.pinimg.com"],
            module: { good: get("https://www.pinterest.com/a"), bad: get("https://www.pinterest.com/b") },
            answers: {
                "https://www.pinterest.com/a": response(302, { location: "https://i.pinimg.com/img.jpg" }),
                "https://www.pinterest.com/b": response(301, { location: "https://evil.example/steal" })
            }
        });
        assert.equal((await call(t.host, "good")).ok, true);
        assert.deepEqual(t.fetched.map(f => f.url), ["https://www.pinterest.com/a", "https://i.pinimg.com/img.jpg"]);
        const bad = await call(t.host, "bad");
        assert.match((bad as { error: string; }).error, /evil\.example is not declared/);
        assert.equal(t.fetched.some(f => f.url.includes("evil.example")), false);
    });

    it("resolves a relative redirect against the current address", async () => {
        const t = setup({
            module: { go: get("https://www.pinterest.com/a/b") },
            answers: { "https://www.pinterest.com/a/b": response(307, { location: "/c" }) }
        });
        await call(t.host, "go");
        assert.deepEqual(t.fetched.map(f => f.url), ["https://www.pinterest.com/a/b", "https://www.pinterest.com/c"]);
    });

    it("cuts a request that takes longer than the time limit", async () => {
        const t = setup({ module: { go: get("https://www.pinterest.com/slow") }, hangFetch: true, fetchTimeoutMs: 10, callTimeoutMs: 2000 });
        const answer = await call(t.host, "go");
        assert.deepEqual(answer, { ok: false, error: "Pin: aborted" });
    });

    it("refuses a redirect without a destination and a chain that is too long", async () => {
        const loop = { "https://www.pinterest.com/loop": response(302, { location: "/loop" }) };
        const t = setup({ module: { none: get("https://www.pinterest.com/none"), loop: get("https://www.pinterest.com/loop") }, answers: { ...loop, "https://www.pinterest.com/none": response(302) } });
        assert.match((await call(t.host, "none") as { error: string; }).error, /no destination/);
        t.fetched.length = 0;
        assert.match((await call(t.host, "loop") as { error: string; }).error, /Too many redirects/);
        assert.equal(t.fetched.length, 5);
    });
});

describe("answerNativeCall", () => {
    const trusted = (url: unknown) => url === "https://discord.com/app";

    it("answers the call when the sender is Discord's page", async () => {
        const t = setup({ module: { one: () => 1 } });
        assert.deepEqual(await answerNativeCall(t.host, trusted, "https://discord.com/app", { plugin: "Pin", fn: "one", args: [] }), { ok: true, value: 1 });
    });

    it("refuses any other sender without running anything or loading the plugin", async () => {
        const t = setup({ module: { one: () => 1 } });
        for (const url of ["https://evil.example/", undefined, 5, "https://discord.com.evil.example/"]) {
            assert.deepEqual(await answerNativeCall(t.host, trusted, url, { plugin: "Pin", fn: "one", args: [] }), { ok: false, error: "The caller is not Discord's page." });
        }
        assert.equal(t.loads(), 0);
        assert.deepEqual(t.events, []);
    });
});

describe("host.fetch size limit", () => {
    /** An answer made of a stream of chunks that remembers how much was read and whether it was cancelled. */
    function streamed(chunkSizes: number[], headers: Record<string, string> = {}) {
        const state = { reads: 0, cancelled: false };
        const chunks = chunkSizes.map(size => new Uint8Array(size).fill(65));
        const answer: NativeResponse = {
            ...response(200, headers),
            body: {
                getReader: () => ({
                    read: async () => (state.reads < chunks.length ? { done: false, value: chunks[state.reads++] } : { done: true }),
                    cancel: async () => { state.cancelled = true; }
                })
            }
        };
        return { answer, state };
    }

    function run(answer: NativeResponse, init: Record<string, unknown> | undefined, options: { maxFetchBytes?: number; } = {}) {
        const host = new NativeHost({
            plugins: { Pin: { functions: ["go"], hosts: ["www.pinterest.com"], load: () => ({ go: (h: NativeHostApi) => h.fetch("https://www.pinterest.com/x", init).then(r => r.arrayBuffer()).then(b => b.byteLength) }) } },
            fetch: async () => answer,
            ...options
        });
        return host.call({ plugin: "Pin", fn: "go", args: [] });
    }

    it("refuses an answer whose declared length is over the limit before reading anything", async () => {
        const t = streamed([10], { "content-length": "999" });
        assert.deepEqual(await run(t.answer, { maxBytes: 100 }), { ok: false, error: "Pin: The answer is bigger than 100 bytes." });
        assert.equal(t.state.reads, 0);
    });

    it("stops reading, and cancels the stream, as soon as an answer with no declared length passes the limit", async () => {
        const t = streamed([40, 40, 40, 40, 40]);
        assert.deepEqual(await run(t.answer, { maxBytes: 100 }), { ok: false, error: "Pin: The answer is bigger than 100 bytes." });
        assert.equal(t.state.reads, 3, "read until the limit was passed and no further");
        assert.equal(t.state.cancelled, true);
    });

    it("gives the whole body when it fits, joined in order", async () => {
        const t = streamed([30, 30, 40]);
        assert.deepEqual(await run(t.answer, { maxBytes: 100 }), { ok: true, value: 100 });
        assert.equal(t.state.cancelled, false);
    });

    it("decodes text and json from the limited body", async () => {
        const body = new TextEncoder().encode("{\"a\":1}");
        const answer: NativeResponse = { ...response(200), body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: body })), cancel: async () => undefined }; } } };
        const host = new NativeHost({
            plugins: { Pin: { functions: ["go"], hosts: ["www.pinterest.com"], load: () => ({ go: async (h: NativeHostApi) => { const r = await h.fetch("https://www.pinterest.com/x"); return { json: await r.json() }; } }) } },
            fetch: async () => answer
        });
        assert.deepEqual(await host.call({ plugin: "Pin", fn: "go", args: [] }), { ok: true, value: { json: { a: 1 } } });
    });

    it("applies the host's own limit when the function asks for none, and never lets a function ask for more", async () => {
        const big = streamed([60, 60]);
        assert.equal((await run(big.answer, undefined, { maxFetchBytes: 100 })).ok, false);
        const bigger = streamed([60, 60]);
        assert.equal((await run(bigger.answer, { maxBytes: 1_000_000 }, { maxFetchBytes: 100 })).ok, false);
        const small = streamed([60]);
        assert.equal((await run(small.answer, { maxBytes: 50 }, { maxFetchBytes: 100 })).ok, false, "a function can ask for less");
    });

    it("ignores a limit that is not a positive number", async () => {
        for (const maxBytes of [0, -5, NaN, "9", undefined]) {
            const t = streamed([60, 60]);
            assert.equal((await run(t.answer, { maxBytes }, { maxFetchBytes: 100 })).ok, false, String(maxBytes));
        }
    });

    it("checks the whole body afterwards when the answer has no stream", async () => {
        const answer: NativeResponse = { ...response(200), arrayBuffer: async () => new ArrayBuffer(200) };
        assert.equal((await run(answer, { maxBytes: 100 })).ok, false);
        const fits: NativeResponse = { ...response(200), arrayBuffer: async () => new ArrayBuffer(50) };
        assert.deepEqual(await run(fits, { maxBytes: 100 }), { ok: true, value: 50 });
    });

    it("keeps status, headers and the address of the last request, and does not pass the limit on to the network", async () => {
        const seen: Array<Record<string, unknown>> = [];
        const host = new NativeHost({
            plugins: { Pin: { functions: ["go"], hosts: ["www.pinterest.com", "i.pinimg.com"], load: () => ({ go: async (h: NativeHostApi) => { const r = await h.fetch("https://www.pinterest.com/a", { maxBytes: 10, headers: { A: "1" } }); return { status: r.status, url: r.url, type: r.headers.get("content-type") }; } }) } },
            fetch: async (url, init) => { seen.push(init); return url.endsWith("/a") ? response(302, { location: "https://i.pinimg.com/z.jpg" }) : response(200, { "content-type": "image/jpeg" }); }
        });
        assert.deepEqual(await host.call({ plugin: "Pin", fn: "go", args: [] }), { ok: true, value: { status: 200, url: "https://i.pinimg.com/z.jpg", type: "image/jpeg" } });
        assert.equal(seen.length, 2);
        for (const init of seen) assert.equal("maxBytes" in init, false);
    });
});
