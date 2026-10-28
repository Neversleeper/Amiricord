/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type FluxDispatcherLike, type FluxHandlers, subscribeFlux } from "../src/api/flux";

/** A dispatcher that keeps its subscribers and lets the test fire an event. */
function fakeDispatcher() {
    const subscribers: Array<{ type: string; callback: (event: unknown) => void; }> = [];
    const dispatcher: FluxDispatcherLike = {
        subscribe: (type, callback) => { subscribers.push({ type, callback }); },
        unsubscribe: (type, callback) => { const i = subscribers.findIndex(s => s.type === type && s.callback === callback); if (i >= 0) subscribers.splice(i, 1); }
    };
    const fire = (type: string, event: unknown) => { for (const s of [...subscribers]) if (s.type === type) s.callback(event); };
    return { dispatcher, subscribers, fire };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe("subscribeFlux", () => {
    it("subscribes one callback per event type and passes the event to the handler", () => {
        const { dispatcher, subscribers, fire } = fakeDispatcher();
        const seen: unknown[] = [];
        subscribeFlux(dispatcher, { A: (e: { n: number; }) => { seen.push(["A", e.n]); }, B: () => { seen.push(["B"]); } }, () => undefined);
        assert.deepEqual(subscribers.map(s => s.type), ["A", "B"]);
        fire("A", { n: 1 });
        fire("B", {});
        fire("C", {});
        assert.deepEqual(seen, [["A", 1], ["B"]]);
    });

    it("takes every subscription back, once, when the undo runs", () => {
        const { dispatcher, subscribers, fire } = fakeDispatcher();
        let calls = 0;
        const undo = subscribeFlux(dispatcher, { A: () => { calls++; }, B: () => { calls++; } }, () => undefined);
        undo();
        assert.deepEqual(subscribers, []);
        fire("A", {});
        assert.equal(calls, 0);
        assert.doesNotThrow(undo);
    });

    it("reports a handler that throws, with the event type, and keeps the other handlers working", () => {
        const { dispatcher, fire } = fakeDispatcher();
        const reported: Array<[string, string]> = [];
        let ok = 0;
        subscribeFlux(dispatcher, { Bad() { throw new Error("boom"); }, Good() { ok++; } }, (type, error) => { reported.push([type, (error as Error).message]); });
        assert.doesNotThrow(() => fire("Bad", {}));
        fire("Good", {});
        assert.deepEqual(reported, [["Bad", "boom"]]);
        assert.equal(ok, 1);
    });

    it("reports an async handler that rejects, and never lets the rejection escape", async () => {
        const { dispatcher, fire } = fakeDispatcher();
        const reported: string[] = [];
        subscribeFlux(dispatcher, { Late: async () => { await tick(); throw new Error("late boom"); } }, (type, error) => { reported.push(`${type}:${(error as Error).message}`); });
        fire("Late", {});
        await tick();
        await tick();
        assert.deepEqual(reported, ["Late:late boom"]);
    });

    it("survives a report function that throws", () => {
        const { dispatcher, fire } = fakeDispatcher();
        subscribeFlux(dispatcher, { Bad() { throw new Error("x"); } }, () => { throw new Error("reporting failed"); });
        assert.doesNotThrow(() => fire("Bad", {}));
    });

    it("ignores an entry that is not a function and survives a dispatcher that cannot unsubscribe", () => {
        const subscribed: string[] = [];
        const dispatcher: FluxDispatcherLike = { subscribe: type => { subscribed.push(type); }, unsubscribe: () => { throw new Error("gone"); } };
        const undo = subscribeFlux(dispatcher, { Real() { /* nothing */ }, Fake: 5 as unknown as FluxHandlers[string] }, () => undefined);
        assert.deepEqual(subscribed, ["Real"]);
        assert.doesNotThrow(undo);
    });
});
