/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { THUMB_LIMITS, ThumbLoader } from "../src/testcordplugins/PinterestTool/thumbs";
import type { MediaResult } from "../src/testcordplugins/PinterestTool/types";

function later<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
    return { promise, resolve, reject };
}

const media = (type = "image/jpeg"): MediaResult => ({ data: new ArrayBuffer(4), type, filename: "a.jpg" });
const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });

function make() {
    const gates = new Map<string, ReturnType<typeof later<MediaResult>>>();
    const fetched: string[] = [];
    const created: string[] = [];
    const revoked: string[] = [];
    let counter = 0;
    const loader = new ThumbLoader({
        fetchMedia: url => {
            fetched.push(url);
            const gate = later<MediaResult>();
            gates.set(url, gate);
            return gate.promise;
        },
        createUrl: () => { const url = `blob:${++counter}`; created.push(url); return url; },
        revokeUrl: url => { revoked.push(url); }
    });
    return { loader, gates, fetched, created, revoked };
}

describe("Pinterest Tool window: thumbnails", () => {
    it("starts nothing new while held, lets what is in flight finish, and starts the waiting ones when released", async () => {
        const { loader, gates, fetched } = make();
        loader.request("u1", () => undefined);
        assert.deepEqual(fetched, ["u1"]);
        loader.hold(true);
        loader.request("u2", () => undefined);
        await tick();
        assert.deepEqual(fetched, ["u1"], "u2 waits while held");
        gates.get("u1")!.resolve(media());
        await tick();
        assert.deepEqual(fetched, ["u1"], "finishing one does not start the next while held");
        loader.hold(false);
        assert.deepEqual(fetched, ["u1", "u2"]);
    });

    it("fetches a picture and gives the blob address to whoever waits", async () => {
        const { loader, gates } = make();
        const got: Array<string | null> = [];
        loader.request("u1", url => got.push(url));
        gates.get("u1")!.resolve(media());
        await tick();
        assert.deepEqual(got, ["blob:1"]);
    });

    it("shares one fetch between two cards that want the same picture", async () => {
        const { loader, gates, fetched } = make();
        const got: Array<string | null> = [];
        loader.request("u1", url => got.push(url));
        loader.request("u1", url => got.push(url));
        assert.deepEqual(fetched, ["u1"]);
        gates.get("u1")!.resolve(media());
        await tick();
        assert.deepEqual(got, ["blob:1", "blob:1"]);
    });

    it("answers from the cache without a new fetch", async () => {
        const { loader, gates, fetched } = make();
        loader.request("u1", () => undefined);
        gates.get("u1")!.resolve(media());
        await tick();
        const got: Array<string | null> = [];
        loader.request("u1", url => got.push(url));
        await tick();
        assert.deepEqual(got, ["blob:1"]);
        assert.deepEqual(fetched, ["u1"]);
    });

    it("loads only a few at a time and starts the next as one ends", async () => {
        const { loader, gates, fetched } = make();
        for (let i = 0; i < THUMB_LIMITS.concurrent + 2; i++) loader.request(`u${i}`, () => undefined);
        assert.equal(fetched.length, THUMB_LIMITS.concurrent);
        gates.get("u0")!.resolve(media());
        await tick();
        assert.equal(fetched.length, THUMB_LIMITS.concurrent + 1);
        gates.get("u1")!.resolve(media());
        await tick();
        assert.equal(fetched.length, THUMB_LIMITS.concurrent + 2);
    });

    it("never fetches a picture whose card left before its turn, but keeps one that another card still wants", async () => {
        const { loader, gates, fetched } = make();
        for (let i = 0; i < THUMB_LIMITS.concurrent; i++) loader.request(`busy${i}`, () => undefined);
        const cancelGone = loader.request("gone", () => undefined);
        const cancelA = loader.request("shared", () => undefined);
        loader.request("shared", () => undefined);
        cancelGone();
        cancelA();
        for (let i = 0; i < THUMB_LIMITS.concurrent; i++) gates.get(`busy${i}`)!.resolve(media());
        await tick();
        assert.equal(fetched.includes("gone"), false);
        assert.equal(fetched.includes("shared"), true);
    });

    it("a card that left while its picture is on the way is not called, and the picture is still kept", async () => {
        const { loader, gates } = make();
        const got: Array<string | null> = [];
        const cancel = loader.request("u1", url => got.push(url));
        cancel();
        gates.get("u1")!.resolve(media());
        await tick();
        assert.deepEqual(got, [], "canceling a request that already started removes only the waiting card");
        const again: Array<string | null> = [];
        loader.request("u1", url => again.push(url));
        await tick();
        assert.deepEqual(again, ["blob:1"]);
    });

    it("a card that leaves while its picture is on the way does not make another card start a second fetch", async () => {
        const { loader, gates, fetched } = make();
        const cancel = loader.request("u1", () => undefined);
        cancel();
        const got: Array<string | null> = [];
        loader.request("u1", url => got.push(url));
        assert.deepEqual(fetched, ["u1"]);
        gates.get("u1")!.resolve(media());
        await tick();
        assert.deepEqual([...got], ["blob:1"]);
    });

    it("answers null for a failed fetch and does not try that picture again", async () => {
        const { loader, gates, fetched } = make();
        const got: Array<string | null> = [];
        loader.request("bad", url => got.push(url));
        gates.get("bad")!.reject(new Error("down"));
        await tick();
        assert.deepEqual([...got], [null]);
        loader.request("bad", url => got.push(url));
        await tick();
        assert.deepEqual(got, [null, null]);
        assert.deepEqual(fetched, ["bad"]);
    });

    it("refuses an answer that is not a picture or has no bytes", async () => {
        const { loader, gates, created } = make();
        const got: Array<string | null> = [];
        loader.request("html", url => got.push(url));
        gates.get("html")!.resolve(media("text/html"));
        loader.request("nodata", url => got.push(url));
        gates.get("nodata")!.resolve({ data: "not bytes", type: "image/png", filename: "x" } as unknown as MediaResult);
        loader.request("notype", url => got.push(url));
        gates.get("notype")!.resolve({ data: new ArrayBuffer(1), type: undefined, filename: "x" } as unknown as MediaResult);
        await tick();
        assert.deepEqual(got, [null, null, null]);
        assert.deepEqual(created, []);
    });

    it("lets go of the oldest address when the cache is full, and a used one counts as new", async () => {
        const { loader, gates, revoked } = make();
        const ask = async (url: string) => {
            loader.request(url, () => undefined);
            gates.get(url)!.resolve(media());
            await tick();
        };
        await ask("keep");
        for (let i = 0; i < THUMB_LIMITS.cached - 1; i++) await ask(`f${i}`);
        assert.deepEqual(revoked, []);
        loader.request("keep", () => undefined);
        await ask("overflow");
        assert.equal(revoked.length, 1);
        assert.equal(revoked[0], "blob:2", "the oldest after `keep` was used again is f0");
    });

    it("on dispose takes every address back, starts nothing more, and answers null", async () => {
        const { loader, gates, fetched, revoked } = make();
        loader.request("u1", () => undefined);
        gates.get("u1")!.resolve(media());
        await tick();
        for (let i = 0; i < THUMB_LIMITS.concurrent; i++) loader.request(`w${i}`, () => undefined);
        loader.request("queued", () => undefined);
        loader.dispose();
        assert.deepEqual(revoked, ["blob:1"]);
        const got: Array<string | null> = [];
        loader.request("after", url => got.push(url));
        await tick();
        assert.deepEqual(got, [null]);
        for (let i = 0; i < THUMB_LIMITS.concurrent; i++) gates.get(`w${i}`)!.resolve(media());
        await tick();
        assert.equal(fetched.includes("queued"), false);
        assert.equal(fetched.includes("after"), false);
        assert.equal(revoked.length, 1 + THUMB_LIMITS.concurrent, "a picture that arrives after the close is taken back at once");
    });

    it("a card that throws when told does not stop the others", async () => {
        const { loader, gates } = make();
        const got: Array<string | null> = [];
        loader.request("u1", () => { throw new Error("bad card"); });
        loader.request("u1", url => got.push(url));
        gates.get("u1")!.resolve(media());
        await tick();
        assert.deepEqual(got, ["blob:1"]);
    });
});
