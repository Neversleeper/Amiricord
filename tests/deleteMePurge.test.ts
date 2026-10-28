/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DELETABLE_TYPES, purge, type PurgeDeps, type PurgeOptions, type RawMessage, retryWait, scanOwn } from "../src/testcordplugins/DeleteMe/purge";

const ME = "me";
const mine = (id: string, extra: Partial<RawMessage> = {}): RawMessage => ({ id, author: { id: ME }, content: `text ${id}`, type: 0, ...extra });
const theirs = (id: string): RawMessage => ({ id, author: { id: "other" }, content: "no", type: 0 });

function setup(pages: RawMessage[][], options: Partial<PurgeOptions> = {}) {
    const asked: Array<string | undefined> = [];
    const slept: number[] = [];
    const removed: string[] = [];
    const world = {
        asked, slept, removed,
        /** What `remove` does for an id: nothing by default. */
        onRemove: (_id: string, _attempt: number): void => undefined,
        attempts: new Map<string, number>()
    };
    let page = 0;
    const deps: PurgeDeps = {
        me: ME,
        list: async before => { asked.push(before); return pages[page++] ?? []; },
        remove: async id => {
            const attempt = (world.attempts.get(id) ?? 0) + 1;
            world.attempts.set(id, attempt);
            world.onRemove(id, attempt);
            removed.push(id);
        },
        sleep: async ms => { slept.push(ms); },
        options: () => ({ delayMs: 100, skipPinned: true, ...options })
    };
    return Object.assign(world, { deps });
}

const never = () => false;
const full = (from: number, mineEvery = 1): RawMessage[] => Array.from({ length: 100 }, (_, i) => (i % mineEvery === 0 ? mine(`m${from + i}`) : theirs(`o${from + i}`)));

describe("DeleteMe: the scan", () => {
    it("keeps only what this account wrote, and reads on from the last message of each full page", async () => {
        const world = setup([full(0, 2), [mine("last"), theirs("x")]]);
        const result = await scanOwn(world.deps, never);
        assert.equal(result.own.length, 100 / 2 + 1);
        assert.equal(result.scanned, 100 + 2);
        assert.equal(result.complete, true);
        assert.deepEqual(world.asked, [undefined, `o${100 - 1}`.replace("o", 100 % 2 === 0 ? "o" : "m")]);
        assert.deepEqual(world.slept, [300], "a short wait between pages, none after the last");
    });

    it("stops at an empty page, and at a page that is not full", async () => {
        assert.deepEqual(await scanOwn(setup([[]]).deps, never), { own: [], scanned: 0, complete: true, others: 0, unusable: 0, pinned: 0 });
        const half = setup([Array.from({ length: 50 }, (_, i) => mine(`h${i}`)), [mine("never")]]);
        assert.equal((await scanOwn(half.deps, never)).own.length, 50);
        assert.equal(half.asked.length, 1, "a page of fifty is the last one");
        const short = setup([[mine("a")], [mine("never")]]);
        const result = await scanOwn(short.deps, never);
        assert.deepEqual(result.own.map(item => item.id), ["a"]);
        assert.equal(short.asked.length, 1);
    });

    it("leaves out messages that cannot be deleted, system messages, and pinned ones unless told otherwise", async () => {
        const types = [0, 19, 20, 23, 1, 7, 21];
        const pages = [[...types.map((type, i) => mine(`t${i}`, { type })), mine("pin", { pinned: true }), mine("notype", { type: undefined })]];
        const kept = await scanOwn(setup(pages).deps, never);
        assert.deepEqual(kept.own.map(item => item.id), ["t0", "t1", "t2", "t3", "notype"]);
        assert.deepEqual(DELETABLE_TYPES, [0, 19, 20, 23]);
        const all = await scanOwn(setup(pages, { skipPinned: false }).deps, never);
        assert.deepEqual(all.own.map(item => item.id), ["t0", "t1", "t2", "t3", "pin", "notype"]);
    });

    it("counts what it left out, so a scan that finds nothing can say why", async () => {
        const pages = [[mine("a"), { id: "o1", author: { id: "other" }, type: 0 }, { id: "o2", author: { id: "other" }, type: 0 }, mine("join", { type: 7 }), mine("pin", { pinned: true })]];
        const result = await scanOwn(setup(pages).deps, never);
        assert.deepEqual([result.scanned, result.own.length, result.others, result.unusable, result.pinned], [5, 1, 2, 1, 1]);
    });

    it("counts a repeated message once and ignores a message without an author", async () => {
        const result = await scanOwn(setup([[mine("a"), mine("a"), { id: "b", type: 0 }, { id: "c", author: {}, type: 0 }]]).deps, never);
        assert.deepEqual(result.own.map(item => item.id), ["a"]);
        assert.equal(result.scanned, 4);
    });

    it("shows a short one-line preview of each message", async () => {
        const long = "x".repeat(80 + 20);
        const result = await scanOwn(setup([[mine("a", { content: "  hello \n\n  there  " }), mine("b", { content: "" }), mine("c", { content: undefined }), mine("d", { content: long }), mine("e", { content: "y".repeat(80) })]]).deps, never);
        assert.deepEqual(result.own.map(item => item.content), ["hello there", "(no text)", "(no text)", `${"x".repeat(80 - 1)}…`, "y".repeat(80)]);
    });

    it("tells the progress after each page, and stops when asked, saying the scan is not complete", async () => {
        const world = setup([full(0), full(100), [mine("z")]]);
        const progress: Array<[number, number]> = [];
        let stop = false;
        const result = await scanOwn(world.deps, () => stop, (scanned, found) => { progress.push([scanned, found]); stop = progress.length === 2; });
        assert.deepEqual(progress, [[100, 100], [100 * 2, 100 * 2]]);
        assert.equal(result.complete, false);
        assert.equal(result.own.length, 100 * 2);
        assert.equal(world.asked.length, 2);
    });

    it("does not read at all when it is stopped before the first page", async () => {
        const world = setup([[mine("a")]]);
        assert.deepEqual(await scanOwn(world.deps, () => true), { own: [], scanned: 0, complete: false, others: 0, unusable: 0, pinned: 0 });
        assert.equal(world.asked.length, 0);
    });

    it("gives up after a very long channel, saying it did not reach the start", async () => {
        let counter = 0;
        const deps = setup([]).deps;
        deps.list = async () => { counter++; return Array.from({ length: 100 }, (_, i) => theirs(`p${counter}-${i}`)); };
        const result = await scanOwn(deps, never);
        assert.equal(counter, 500);
        assert.equal(result.complete, false);
        assert.equal(result.scanned, 500 * 100);
    });

    it("lets a failure of Discord's list go to the caller", async () => {
        const deps = setup([]).deps;
        deps.list = async () => { throw new Error("offline"); };
        await assert.rejects(scanOwn(deps, never), /offline/);
    });
});

describe("DeleteMe: the deleting", () => {
    const own = (...ids: string[]) => ids.map(id => ({ id, content: `text ${id}` }));
    const record = () => {
        const events = { deleted: [] as string[], failed: [] as Array<[string, string]> };
        return { events, handlers: { deleted: (m: { id: string; }) => { events.deleted.push(m.id); }, failed: (m: { id: string; }, reason: string) => { events.failed.push([m.id, reason]); } } };
    };

    it("deletes each message in order and waits between them", async () => {
        const world = setup([], { delayMs: 777 });
        const seen = record();
        const result = await purge(world.deps, own("a", "b", "c"), never, seen.handlers);
        assert.deepEqual(result, { deleted: 3, failed: 0 });
        assert.deepEqual(world.removed, ["a", "b", "c"]);
        assert.deepEqual(seen.events.deleted, ["a", "b", "c"]);
        assert.deepEqual(world.slept, [777, 777, 777]);
    });

    it("counts a message that is already gone as deleted", async () => {
        const world = setup([]);
        world.onRemove = id => { if (id === "a") throw Object.assign(new Error("gone"), { status: 404 }); };
        const seen = record();
        const result = await purge(world.deps, own("a"), never, seen.handlers);
        assert.deepEqual(result, { deleted: 1, failed: 0 });
        assert.deepEqual(seen.events.deleted, ["a"]);
        assert.deepEqual(world.removed, [], "nothing was removed by the call that failed");
    });

    it("a message that was already gone clears the count of failures in a row", async () => {
        const world = setup([]);
        world.onRemove = id => { if (id === "m9") throw { status: 404 }; else throw { status: 500 }; };
        const ids = Array.from({ length: 18 }, (_, i) => `m${i}`);
        const result = await purge(world.deps, own(...ids), never, record().handlers);
        assert.equal(result.ended, undefined, "nine failures, one that was gone, eight more: never ten in a row");
        assert.deepEqual([result.deleted, result.failed], [1, 17]);
    });

    it("waits as long as Discord asks, then tries the same message again", async () => {
        const world = setup([], { delayMs: 50 });
        world.onRemove = (_id, attempt) => { if (attempt === 1) throw { status: 429, body: { retry_after: 1.2 } }; };
        const result = await purge(world.deps, own("a"), never, record().handlers);
        assert.deepEqual(result, { deleted: 1, failed: 0 });
        assert.equal(world.attempts.get("a"), 2);
        assert.deepEqual(world.slept, [1200, 50]);
    });

    it("gives up on a message after five slow-downs and goes on with the next", async () => {
        const world = setup([]);
        world.onRemove = id => { if (id === "a") throw { status: 429 }; };
        const seen = record();
        const result = await purge(world.deps, own("a", "b"), never, seen.handlers);
        assert.equal(world.attempts.get("a"), 5 + 1);
        assert.deepEqual(result, { deleted: 1, failed: 1 });
        assert.deepEqual(seen.events.failed, [["a", "error 429"]]);
        assert.deepEqual(world.slept.slice(0, 5), Array(5).fill(2000));
    });

    it("works out how long to wait from what Discord says, never more than a minute", () => {
        assert.equal(retryWait({ body: { retry_after: 2 } }), 2000);
        assert.equal(retryWait({ body: { retry_after: 0.0001 } }), 1);
        assert.equal(retryWait({ body: { retry_after: 9999 } }), 60000);
        for (const odd of [null, undefined, {}, { body: {} }, { body: { retry_after: "soon" } }, { body: { retry_after: -3 } }, { body: { retry_after: 0 } }, { body: { retry_after: Infinity } }]) {
            assert.equal(retryWait(odd), 2000, JSON.stringify(odd));
        }
    });

    it("stops waiting for a slow-down when asked to stop", async () => {
        const world = setup([]);
        world.onRemove = () => { throw { status: 429 }; };
        let stop = false;
        world.deps.sleep = async () => { stop = true; };
        const result = await purge(world.deps, own("a", "b"), () => stop, record().handlers);
        assert.deepEqual(result, { deleted: 0, failed: 0, ended: "stopped" });
        assert.equal(world.attempts.get("a"), 1);
    });

    it("counts a refusal as failed with the reason Discord gave, and goes on", async () => {
        const world = setup([]);
        const reasons: Record<string, unknown> = {
            a: { status: 403, body: { message: "Missing Permissions" } },
            b: Object.assign(new Error("network down"), { status: 0 }),
            c: { status: 500, text: "server error" },
            d: { status: 400 },
            e: "text only"
        };
        world.onRemove = id => { if (id in reasons) throw reasons[id]; };
        const seen = record();
        const result = await purge(world.deps, own("a", "b", "c", "d", "e", "f"), never, seen.handlers);
        assert.deepEqual(result, { deleted: 1, failed: 5 });
        assert.deepEqual(seen.events.failed, [["a", "Missing Permissions"], ["b", "network down"], ["c", "server error"], ["d", "error 400"], ["e", "error unknown"]]);
    });

    it("cuts a very long reason", async () => {
        const world = setup([]);
        world.onRemove = () => { throw { status: 500, text: "z".repeat(500) }; };
        const seen = record();
        await purge(world.deps, own("a"), never, seen.handlers);
        assert.equal(seen.events.failed[0][1].length, 120);
    });

    it("gives up when ten in a row fail, but not when successes come between", async () => {
        const failing = setup([]);
        failing.onRemove = () => { throw { status: 500 }; };
        const ids = Array.from({ length: 10 + 3 }, (_, i) => `m${i}`);
        const result = await purge(failing.deps, own(...ids), never, record().handlers);
        assert.deepEqual(result, { deleted: 0, failed: 10, ended: "failing" });
        assert.equal(failing.slept.length, 10 - 1, "no wait after the last one it tried");

        const mixed = setup([]);
        mixed.onRemove = id => { if (Number(id.slice(1)) % 2 === 0) throw { status: 500 }; };
        const long = Array.from({ length: 40 }, (_, i) => `m${i}`);
        const done = await purge(mixed.deps, own(...long), never, record().handlers);
        assert.deepEqual(done, { deleted: 20, failed: 20 });
        const reset = setup([]);
        reset.onRemove = id => { if (Number(id.slice(1)) % 10 !== 0) throw { status: 500 }; };
        const spaced = await purge(reset.deps, own(...Array.from({ length: 10 * 3 }, (_, i) => `m${i}`)), never, record().handlers);
        assert.equal(spaced.ended, undefined, "a success clears the count of failures in a row");
    });

    it("stops when asked and says it was asked, without deleting more", async () => {
        const world = setup([]);
        let stop = false;
        const seen = record();
        const result = await purge(world.deps, own("a", "b", "c"), () => stop, { deleted: message => { seen.handlers.deleted(message); stop = true; }, failed: seen.handlers.failed });
        assert.deepEqual(result, { deleted: 1, failed: 0, ended: "stopped" });
        assert.deepEqual(world.removed, ["a"]);
    });

    it("reads the wait between deletions again for every message, so it can change while running", async () => {
        const world = setup([]);
        let delay = 100;
        world.deps.options = () => ({ delayMs: delay += 100, skipPinned: true });
        await purge(world.deps, own("a", "b"), never, record().handlers);
        assert.deepEqual(world.slept, [200, 300]);
    });
});
