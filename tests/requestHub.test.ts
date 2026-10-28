/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HEADER_CHECK_MAX_MS, makeHeaderCheck } from "../src/main/headerCheck";
import { matchesPattern, RequestDetails, RequestHandler, RequestHub, WebRequestLike } from "../src/main/requestHub";
import type { HealthEvent } from "../src/shared/health";

type Callback = (answer: Record<string, unknown>) => void;
type Listener = (details: RequestDetails, callback: Callback) => void;

/** A stand-in for Electron's webRequest: only the last listener of each event is kept, like the real one. */
function fakeWebRequest() {
    const registered: { beforeRequest?: { filter: unknown; listener: Listener; }; beforeSendHeaders?: { filter: unknown; listener: Listener; }; } = {};
    const calls = { beforeRequest: 0, beforeSendHeaders: 0 };
    const webRequest = {
        onBeforeRequest(...args: unknown[]) { calls.beforeRequest++; registered.beforeRequest = args.length > 1 ? { filter: args[0], listener: args[1] as Listener } : { filter: null, listener: args[0] as Listener }; },
        onBeforeSendHeaders(...args: unknown[]) { calls.beforeSendHeaders++; registered.beforeSendHeaders = args.length > 1 ? { filter: args[0], listener: args[1] as Listener } : { filter: null, listener: args[0] as Listener }; }
    };
    const request = (details: RequestDetails) => new Promise<Record<string, unknown>>(resolve => { registered.beforeRequest!.listener(details, resolve); });
    const headers = (details: RequestDetails) => new Promise<Record<string, unknown>>(resolve => { registered.beforeSendHeaders!.listener(details, resolve); });
    return { webRequest: webRequest as unknown as WebRequestLike, registered, calls, request, headers, raw: webRequest };
}

function setup() {
    const fake = fakeWebRequest();
    const errors: string[] = [];
    const hub = new RequestHub(fake.webRequest, { onError: name => { errors.push(name); } });
    hub.install();
    return { ...fake, hub, errors };
}

const get = (url: string, extra: Partial<RequestDetails> = {}): RequestDetails => ({ url, method: "GET", resourceType: "xhr", ...extra });

describe("the hub", () => {
    it("registers one listener per event, for every address, and only once", () => {
        const t = setup();
        assert.equal(t.calls.beforeRequest, 1);
        assert.equal(t.calls.beforeSendHeaders, 1);
        assert.deepEqual(t.registered.beforeRequest!.filter, { urls: ["<all_urls>"] });
        t.hub.install();
        assert.equal(t.calls.beforeRequest, 1, "a second install does nothing");
        assert.equal(t.hub.status().installed, true);
    });

    it("does not mistake its own dispatcher for Discord's listener when installed twice", async () => {
        const t = setup();
        let discordCalls = 0;
        t.raw.onBeforeRequest((_d: RequestDetails, cb: Callback) => { discordCalls++; cb({}); });
        t.hub.install();
        assert.deepEqual(await t.request(get("https://x.test/")), {});
        assert.equal(discordCalls, 1, "Discord's listener is still the one that runs, once");
    });

    it("lets a request through when no handler has anything to say", async () => {
        const t = setup();
        t.hub.add({ name: "quiet", beforeRequest: () => undefined });
        assert.deepEqual(await t.request(get("https://discord.com/api/v9/x")), {});
    });

    it("runs handlers in the order they were added, and the first cancel ends the chain", async () => {
        const t = setup();
        const log: string[] = [];
        t.hub.add({ name: "a", beforeRequest: () => { log.push("a"); } });
        t.hub.add({ name: "b", beforeRequest: () => { log.push("b"); return { cancel: true }; } });
        t.hub.add({ name: "c", beforeRequest: () => { log.push("c"); } });
        assert.deepEqual(await t.request(get("https://x.test/")), { cancel: true });
        assert.deepEqual(log, ["a", "b"]);
    });

    it("answers a redirect, and a redirect ends the chain too", async () => {
        const t = setup();
        t.hub.add({ name: "r", beforeRequest: () => ({ redirectURL: "https://clean.test/" }) });
        t.hub.add({ name: "after", beforeRequest: () => { throw new Error("never reached"); } });
        assert.deepEqual(await t.request(get("https://x.test/?utm_source=a")), { redirectURL: "https://clean.test/" });
        assert.deepEqual(t.hub.status().errors, {});
    });

    it("passes header changes from one handler to the next and answers with the result", async () => {
        const t = setup();
        let seen: Record<string, string> | undefined;
        t.hub.add({ name: "strip", beforeSendHeaders: d => ({ requestHeaders: { ...d.requestHeaders, Authorization: "" } }) });
        t.hub.add({ name: "look", beforeSendHeaders: d => { seen = d.requestHeaders; } });
        const answer = await t.headers(get("https://x.test/", { requestHeaders: { Authorization: "secret", Accept: "*/*" } }));
        assert.deepEqual(seen, { Authorization: "", Accept: "*/*" });
        assert.deepEqual(answer, { requestHeaders: { Authorization: "", Accept: "*/*" } });
    });

    it("skips a handler that throws, counts it by name, and goes on with the rest", async () => {
        const t = setup();
        t.hub.add({ name: "broken", beforeRequest: () => { throw new Error("boom"); } });
        t.hub.add({ name: "good", beforeRequest: () => ({ cancel: true }) });
        assert.deepEqual(await t.request(get("https://x.test/")), { cancel: true });
        assert.deepEqual(t.hub.status().errors, { broken: 1 });
        assert.deepEqual(t.errors, ["broken"]);
    });

    it("survives an error listener that throws", async () => {
        const fake = fakeWebRequest();
        const hub = new RequestHub(fake.webRequest, { onError: () => { throw new Error("listener broke"); } });
        hub.install();
        hub.add({ name: "broken", beforeRequest: () => { throw new Error("boom"); } });
        assert.deepEqual(await fake.request(get("https://x.test/")), {});
    });

    it("removes a handler with the function add gives back, and lists the handlers by name", async () => {
        const t = setup();
        const remove = t.hub.add({ name: "gone", beforeRequest: () => ({ cancel: true }) });
        assert.deepEqual(t.hub.status().handlers, ["gone"]);
        remove();
        remove();
        assert.deepEqual(t.hub.status().handlers, []);
        assert.deepEqual(await t.request(get("https://x.test/")), {});
    });

    it("lets a handler remove itself in the middle of a request", async () => {
        const t = setup();
        const handler: RequestHandler = { name: "once", beforeRequest: () => { remove(); return { cancel: true }; } };
        const remove = t.hub.add(handler);
        assert.deepEqual(await t.request(get("https://x.test/")), { cancel: true });
        assert.deepEqual(await t.request(get("https://x.test/")), {});
    });
});

describe("Discord's own listener", () => {
    it("is kept instead of replacing ours, and called after our handlers", async () => {
        const t = setup();
        const seen: string[] = [];
        t.hub.add({ name: "ours", beforeRequest: d => { seen.push("ours " + d.url); } });
        t.raw.onBeforeRequest({ urls: ["*://*.discord.com/*"] }, (d: RequestDetails, cb: Callback) => { seen.push("discord " + d.url); cb({ cancel: false }); });
        assert.equal(t.calls.beforeRequest, 1, "Electron still has only our listener");
        assert.deepEqual(await t.request(get("https://canary.discord.com/api/x")), { cancel: false });
        assert.deepEqual(seen, ["ours https://canary.discord.com/api/x", "discord https://canary.discord.com/api/x"]);
        assert.equal(t.hub.status().host.beforeRequest, true);
    });

    it("is not called when our handler cancels, nor when its filter does not cover the address", async () => {
        const t = setup();
        let called = 0;
        t.raw.onBeforeRequest({ urls: ["*://*.discord.com/*"] }, (_d: RequestDetails, cb: Callback) => { called++; cb({}); });
        assert.deepEqual(await t.request(get("https://other.test/")), {});
        assert.equal(called, 0);
        const remove = t.hub.add({ name: "block", beforeRequest: () => ({ cancel: true }) });
        assert.deepEqual(await t.request(get("https://discord.com/api")), { cancel: true });
        assert.equal(called, 0);
        remove();
        await t.request(get("https://discord.com/api"));
        assert.equal(called, 1);
    });

    it("is called for everything when it gave no filter, and is dropped by registering null", async () => {
        const t = setup();
        let called = 0;
        t.raw.onBeforeRequest((_d: RequestDetails, cb: Callback) => { called++; cb({}); });
        await t.request(get("https://anything.test/"));
        assert.equal(called, 1);
        t.raw.onBeforeRequest(null);
        await t.request(get("https://anything.test/"));
        assert.equal(called, 1);
        assert.equal(t.hub.status().host.beforeRequest, false);
    });

    it("gets the headers our handlers made, and our changes survive when it does not set headers itself", async () => {
        const t = setup();
        let seenByDiscord: Record<string, string> | undefined;
        t.hub.add({ name: "strip", beforeSendHeaders: d => ({ requestHeaders: { ...d.requestHeaders, Authorization: "" } }) });
        t.raw.onBeforeSendHeaders((d: RequestDetails, cb: Callback) => { seenByDiscord = d.requestHeaders; cb({}); });
        const answer = await t.headers(get("https://x.test/", { requestHeaders: { Authorization: "secret" } }));
        assert.deepEqual(seenByDiscord, { Authorization: "" });
        assert.deepEqual(answer, { requestHeaders: { Authorization: "" } });
    });

    it("has the last word on headers when it sets them", async () => {
        const t = setup();
        t.hub.add({ name: "ours", beforeSendHeaders: d => ({ requestHeaders: { ...d.requestHeaders, A: "1" } }) });
        t.raw.onBeforeSendHeaders((_d: RequestDetails, cb: Callback) => { cb({ requestHeaders: { B: "2" } }); });
        assert.deepEqual(await t.headers(get("https://x.test/", { requestHeaders: {} })), { requestHeaders: { B: "2" } });
    });

    it("never leaves a request waiting when its listener throws", async () => {
        const t = setup();
        t.raw.onBeforeRequest(() => { throw new Error("discord listener broke"); });
        assert.deepEqual(await t.request(get("https://x.test/")), {});
        t.hub.add({ name: "strip", beforeSendHeaders: () => ({ requestHeaders: { Y: "1" } }) });
        t.raw.onBeforeSendHeaders(() => { throw new Error("discord listener broke"); });
        assert.deepEqual(await t.headers(get("https://x.test/", { requestHeaders: {} })), { requestHeaders: { Y: "1" } });
    });

    it("works without chaining when the methods cannot be replaced, and says so", async () => {
        const fake = fakeWebRequest();
        Object.freeze(fake.raw);
        const hub = new RequestHub(fake.webRequest);
        hub.install();
        assert.equal(hub.status().chaining, false);
        hub.add({ name: "block", beforeRequest: () => ({ cancel: true }) });
        assert.deepEqual(await fake.request(get("https://x.test/")), { cancel: true });
    });
});

describe("match patterns", () => {
    it("understands all urls, wildcard schemes and hosts, and paths", () => {
        assert.equal(matchesPattern("https://a.test/x", "<all_urls>"), true);
        assert.equal(matchesPattern("data:text/plain,x", "<all_urls>"), false);
        assert.equal(matchesPattern("https://canary.discord.com/api/v9/a?b=1", "*://*.discord.com/*"), true);
        assert.equal(matchesPattern("https://discord.com/", "*://*.discord.com/*"), true);
        assert.equal(matchesPattern("https://notdiscord.com/", "*://*.discord.com/*"), false);
        assert.equal(matchesPattern("https://discord.com.evil.test/", "*://*.discord.com/*"), false);
        assert.equal(matchesPattern("http://discord.com/a", "https://discord.com/*"), false);
        assert.equal(matchesPattern("ftp://a.test/x", "*://*/*"), false, "a wildcard scheme means http, https, ws and wss only");
        assert.equal(matchesPattern("wss://gateway.discord.gg/?v=9", "*://*/*"), true);
        assert.equal(matchesPattern("https://discord.com/api/v9/x", "https://discord.com/api/*"), true);
        assert.equal(matchesPattern("https://discord.com/other", "https://discord.com/api/*"), false);
        assert.equal(matchesPattern("https://a.test/x", "*://*/*"), true);
        assert.equal(matchesPattern("not a url", "*://*/*"), false);
        assert.equal(matchesPattern("https://a.test/", "garbage"), false);
    });
});

describe("check A of the privacy self-test (the first properties header)", () => {
    const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

    function setupCheck() {
        const reported: HealthEvent[] = [];
        let time = 0;
        let removed = 0;
        let timerWork: (() => void) | undefined;
        let timerCancelled = false;
        const check = makeHeaderCheck({
            report: e => { reported.push(e); },
            now: () => time,
            after: work => { timerWork = work; return () => { timerCancelled = true; }; },
            remove: () => { removed++; }
        });
        return { check, reported, removed: () => removed, advance: (ms: number) => { time += ms; }, expire: () => timerWork?.(), timerCancelled: () => timerCancelled };
    }
    const api = (header: string, key = "X-Super-Properties") => ({ url: "https://discord.com/api/v9/users/@me", requestHeaders: { [key]: header, Authorization: "SECRET" } });

    it("reports a pass for the first request to Discord's API that carries the header, then removes itself", () => {
        const t = setupCheck();
        t.advance(1200);
        assert.equal(t.check.handler.beforeSendHeaders!(api(b64('{"os":"Windows","has_client_mods":false}'))), undefined);
        assert.equal(t.reported.length, 1);
        const event = t.reported[0];
        assert.ok(event.type === "self-test" && event.name === "request-header" && event.status === "pass" && event.ms === 1200);
        assert.equal(t.removed(), 1);
        assert.equal(t.check.done(), true);
        assert.equal(t.timerCancelled(), true);
        t.check.handler.beforeSendHeaders!(api(b64('{"has_client_mods":true}')));
        assert.equal(t.reported.length, 1, "nothing after it is done");
    });

    it("reports a failure when the header says true", () => {
        const t = setupCheck();
        t.check.handler.beforeSendHeaders!(api(b64('{"has_client_mods":true}'), "x-super-properties"));
        const event = t.reported[0];
        assert.ok(event.type === "self-test" && event.status === "fail");
    });

    it("says not seen when the header holds no readable flag", () => {
        const t = setupCheck();
        t.check.handler.beforeSendHeaders!(api(b64('{"os":"Windows"}')));
        const event = t.reported[0];
        assert.ok(event.type === "self-test" && event.status === "not-seen");
    });

    it("ignores other hosts, other paths, non-https and requests without the header", () => {
        const t = setupCheck();
        const handler = t.check.handler.beforeSendHeaders!;
        handler({ url: "https://example.com/api/x", requestHeaders: { "X-Super-Properties": b64('{"has_client_mods":false}') } });
        handler({ url: "https://discord.com.evil.test/api/x", requestHeaders: { "X-Super-Properties": b64('{"has_client_mods":false}') } });
        handler({ url: "https://discord.com/assets/x.js", requestHeaders: { "X-Super-Properties": b64('{"has_client_mods":false}') } });
        handler({ url: "http://discord.com/api/x", requestHeaders: { "X-Super-Properties": b64('{"has_client_mods":false}') } });
        handler({ url: "https://discord.com/api/x", requestHeaders: { Accept: "*/*" } });
        handler({ url: "https://discord.com/api/x" });
        handler({ url: "not a url", requestHeaders: {} });
        assert.equal(t.reported.length, 0);
        assert.equal(t.check.done(), false);
    });

    it("says not seen after a minute with no such request, and removes itself", () => {
        const t = setupCheck();
        t.advance(HEADER_CHECK_MAX_MS);
        t.expire();
        const event = t.reported[0];
        assert.ok(event.type === "self-test" && event.status === "not-seen" && event.ms === HEADER_CHECK_MAX_MS);
        assert.match(event.detail, /within 60 seconds/);
        assert.equal(t.removed(), 1);
    });

    it("keeps no part of the header and never changes the request", () => {
        const t = setupCheck();
        const answer = t.check.handler.beforeSendHeaders!(api(b64('{"os":"Windows","token":"SECRET-VALUE","has_client_mods":false}')));
        assert.equal(answer, undefined);
        assert.ok(!JSON.stringify(t.reported).includes("SECRET"));
    });

    it("works inside the hub, next to other handlers, without stopping them", async () => {
        const fake = fakeWebRequest();
        const hub = new RequestHub(fake.webRequest);
        hub.install();
        const reported: HealthEvent[] = [];
        let remove = () => { /* set below */ };
        const check = makeHeaderCheck({ report: e => { reported.push(e); }, now: () => 0, after: () => () => undefined, remove: () => { remove(); } });
        remove = hub.add(check.handler);
        hub.add({ name: "other", beforeSendHeaders: d => ({ requestHeaders: { ...d.requestHeaders, Extra: "1" } }) });
        const answer = await fake.headers({ url: "https://discord.com/api/v9/x", requestHeaders: { "X-Super-Properties": b64('{"has_client_mods":false}') } });
        assert.equal(reported.length, 1);
        assert.deepEqual(hub.status().handlers, ["other"]);
        assert.ok((answer.requestHeaders as Record<string, string>).Extra === "1");
    });
});
