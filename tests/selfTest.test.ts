/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SelfTestOptions, SelfTestResult, startSelfTest, WebSocketLike } from "../src/renderer/selfTest";
import { FLAG_KEY } from "../src/shared/modFlag";

/** A WebSocket class whose send records what it was given. */
function fakeSocket() {
    const sent: unknown[] = [];
    class Socket {
        send(this: unknown, data: unknown) { sent.push(data); return "returned by the original"; }
    }
    return { Socket: Socket as unknown as WebSocketLike, sent, original: Socket.prototype.send };
}

/** A clock and a list of delayed work that the test runs by hand. */
function clock() {
    let time = 0;
    const queue: Array<{ at: number; work: () => void; }> = [];
    return {
        now: () => time,
        later: (work: () => void, ms: number) => { queue.push({ at: time + ms, work }); },
        advance(ms: number) {
            const end = time + ms;
            for (;;) {
                queue.sort((a, b) => a.at - b.at);
                const next = queue[0];
                if (!next || next.at > end) break;
                queue.shift();
                time = next.at;
                next.work();
            }
            time = end;
        }
    };
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const identify = (value: "true" | "false") => `{"op":2,"d":{"properties":{"os":"Windows","${FLAG_KEY}":${value}}}}`;

function setup(options: Partial<SelfTestOptions> = {}) {
    const socket = fakeSocket();
    const time = clock();
    const results: SelfTestResult[] = [];
    const test = startSelfTest({
        webSocket: socket.Socket,
        getSuperProperties: () => undefined,
        report: r => { results.push(r); },
        now: time.now,
        later: time.later,
        ...options
    });
    const instance = new (socket.Socket as unknown as new () => { send(data: unknown): unknown; })();
    return { ...socket, time, results, test, send: (data: unknown) => instance.send(data), proto: socket.Socket.prototype };
}

describe("the gateway watcher", () => {
    it("passes every message through unchanged, with the same result, while it watches", () => {
        const t = setup();
        assert.notEqual(t.proto.send, t.original, "it is wrapped");
        assert.equal(t.send("hello"), "returned by the original");
        assert.deepEqual(t.sent, ["hello"]);
    });

    it("reports a pass for the first message that carries the key set to false, and puts send back", () => {
        const t = setup();
        t.send('{"op":1,"d":null}');
        t.time.advance(250);
        t.send(identify("false"));
        const gateway = t.results.filter(r => r.name === "first-gateway-message");
        assert.equal(gateway.length, 1);
        assert.equal(gateway[0].status, "pass");
        assert.match(gateway[0].detail, /send number 2/);
        assert.equal(gateway[0].ms, 250);
        assert.equal(t.proto.send, t.original, "send is back as it was");
    });

    it("reports a failure when the key is true", () => {
        const t = setup();
        t.send(identify("true"));
        const gateway = t.results.find(r => r.name === "first-gateway-message")!;
        assert.equal(gateway.status, "fail");
        assert.match(gateway.detail, /TRUE/);
    });

    it("reads binary messages too", () => {
        const t = setup();
        const bytes = Buffer.concat([Buffer.from("xx"), Buffer.from(FLAG_KEY), Buffer.from([100, 0, 5]), Buffer.from("false")]);
        t.send(new Uint8Array(bytes));
        assert.equal(t.results.find(r => r.name === "first-gateway-message")!.status, "pass");
    });

    it("says not seen after 40 sends without the key, and never calls that a pass", () => {
        const t = setup();
        for (let i = 0; i < 40; i++) t.send(`{"op":1,"n":${i}}`);
        const gateway = t.results.find(r => r.name === "first-gateway-message")!;
        assert.equal(gateway.status, "not-seen");
        assert.match(gateway.detail, /first 40 gateway sends/);
        assert.equal(t.proto.send, t.original);
        t.send(identify("false"));
        assert.equal(t.results.filter(r => r.name === "first-gateway-message").length, 1, "nothing is reported after it is done");
    });

    it("says not seen when the time runs out, and puts send back", () => {
        const t = setup();
        t.send("{}");
        t.time.advance(60_000);
        const gateway = t.results.find(r => r.name === "first-gateway-message")!;
        assert.equal(gateway.status, "not-seen");
        assert.match(gateway.detail, /60 seconds \(1 sends seen\)/);
        assert.equal(t.proto.send, t.original);
    });

    it("counts a message it cannot read as such, and a key with an unreadable value is not a pass", () => {
        const t = setup({ maxSends: 3 });
        t.send(new Blob(["x"]));
        t.send(`{"${FLAG_KEY}":"maybe"}`);
        t.send("{}");
        const gateway = t.results.find(r => r.name === "first-gateway-message")!;
        assert.equal(gateway.status, "not-seen");
        assert.match(gateway.detail, /send number 2 but its value could not be read/);
    });

    it("stays out of the way when someone else wrapped send over it, and says so", () => {
        const t = setup();
        const ours = t.proto.send;
        const theirs = function (this: unknown, ...args: unknown[]) { return Reflect.apply(ours, this, args); };
        t.proto.send = theirs as typeof t.proto.send;
        t.send(identify("false"));
        const gateway = t.results.find(r => r.name === "first-gateway-message")!;
        assert.equal(gateway.status, "pass");
        assert.match(gateway.detail, /could not be removed/);
        assert.equal(t.proto.send, theirs, "their wrapper is left in place");
        t.send("later");
        assert.equal(t.sent.at(-1), "later", "messages still go through");
    });

    it("never changes what the original returns or throws", () => {
        class Throwing { send() { throw new Error("socket closed"); } }
        const time = clock();
        startSelfTest({ webSocket: Throwing as unknown as WebSocketLike, report: () => undefined, now: time.now, later: time.later });
        assert.throws(() => new Throwing().send(), /socket closed/);
    });

    it("keeps working when the report function throws", () => {
        const socket = fakeSocket();
        const time = clock();
        startSelfTest({ webSocket: socket.Socket, report: () => { throw new Error("report broke"); }, now: time.now, later: time.later });
        const instance = new (socket.Socket as unknown as new () => { send(data: unknown): unknown; })();
        assert.doesNotThrow(() => instance.send(identify("false")));
    });

    it("says there is nothing to watch when the page has no WebSocket", () => {
        const results: SelfTestResult[] = [];
        const time = clock();
        startSelfTest({ report: r => { results.push(r); }, now: time.now, later: time.later });
        assert.equal(results.find(r => r.name === "first-gateway-message")!.status, "not-seen");
        assert.match(results.find(r => r.name === "first-gateway-message")!.detail, /no WebSocket/);
    });

    it("stores nothing but the verdict, a number and a time: no content of any message", () => {
        const t = setup();
        t.send(`{"op":2,"d":{"token":"SECRET-TOKEN-VALUE","properties":{"${FLAG_KEY}":false}}}`);
        assert.ok(!JSON.stringify(t.results).includes("SECRET"));
        assert.ok(!JSON.stringify(t.test.results()).includes("SECRET"));
    });
});

describe("the properties check", () => {
    it("passes once Discord's properties can be read and say false", () => {
        let raw: unknown = undefined;
        const t = setup({ getSuperProperties: () => raw });
        assert.equal(t.results.find(r => r.name === "super-properties"), undefined, "nothing yet");
        t.time.advance(3000);
        raw = b64('{"os":"Windows","has_client_mods":false}');
        t.time.advance(1000);
        const properties = t.results.find(r => r.name === "super-properties")!;
        assert.equal(properties.status, "pass");
        assert.equal(properties.ms, 4000);
    });

    it("fails when the properties say true", () => {
        const t = setup({ getSuperProperties: () => b64('{"has_client_mods":true}') });
        assert.equal(t.results.find(r => r.name === "super-properties")!.status, "fail");
    });

    it("is not seen when the properties hold no readable flag", () => {
        const t = setup({ getSuperProperties: () => b64('{"os":"Windows"}') });
        assert.equal(t.results.find(r => r.name === "super-properties")!.status, "not-seen");
    });

    it("is not seen after a minute if Discord's module never shows up, and keeps trying until then", () => {
        let calls = 0;
        const t = setup({ getSuperProperties: () => { calls++; return undefined; } });
        t.time.advance(30_000);
        assert.ok(calls > 20, "it keeps asking about every second");
        assert.equal(t.results.find(r => r.name === "super-properties"), undefined);
        t.time.advance(30_000);
        const properties = t.results.find(r => r.name === "super-properties")!;
        assert.equal(properties.status, "not-seen");
        assert.match(properties.detail, /not found within 60 seconds/);
        const asked = calls;
        t.time.advance(10_000);
        assert.equal(calls, asked, "it stops asking");
    });

    it("keeps trying when asking throws, and says there is no way to read when no reader was given", () => {
        let first = true;
        const t = setup({ getSuperProperties: () => { if (first) { first = false; throw new Error("not ready"); } return b64('{"has_client_mods":false}'); } });
        t.time.advance(1000);
        assert.equal(t.results.find(r => r.name === "super-properties")!.status, "pass");

        const none = setup({ getSuperProperties: undefined });
        assert.match(none.results.find(r => r.name === "super-properties")!.detail, /no way to read/);
    });

    it("gives back copies of its results", () => {
        const t = setup({ getSuperProperties: () => b64('{"has_client_mods":false}') });
        const copy = t.test.results();
        copy[0].status = "fail";
        assert.notEqual(t.test.results()[0].status, "fail");
    });
});
