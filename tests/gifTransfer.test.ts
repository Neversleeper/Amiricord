/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildExport, isRateLimit, makeTransfer, type NewGif, parseExport, type TransferDeps, type TransferOptions, verifyFile
} from "../src/testcordplugins/GifTransfer/transfer";

const OPTIONS: TransferOptions = {
    skipDuplicates: true, delayBetweenImports: 100, autoIncreaseDelay: true, ensureCompleteImport: false,
    maxRetryPasses: 2, retryPassDelay: 50, settleWatch: false, settleWatchDuration: 1000
};

const gif = (url: string, extra: Record<string, unknown> = {}) => ({ url, src: `${url}.src`, width: 10, height: 20, format: 1, order: 1, ...extra });
const file = (...gifs: unknown[]) => JSON.stringify({ version: 2, exportedAt: "x", totalGifs: gifs.length, gifs });

function setup(options: Partial<TransferOptions> = {}, start: Record<string, Record<string, unknown>> = {}) {
    const favourites: Record<string, Record<string, unknown>> = { ...start };
    let clock = 0;
    const world = {
        favourites,
        added: [] as NewGif[],
        slept: [] as number[],
        toasts: [] as Array<[string, string | undefined]>,
        logs: [] as string[],
        warns: [] as string[],
        /** What `add` does for an address: nothing special by default; a function can throw or change the list. */
        onAdd: (_gif: NewGif, _attempt: number): void => undefined,
        attempts: new Map<string, number>(),
        removed: [] as string[],
        asked: [] as number[],
        answer: true,
        /** What `remove` does for an address: nothing special by default; a function can throw or change the list. */
        onRemove: (_url: string, _attempt: number): void => undefined,
        removeAttempts: new Map<string, number>()
    };
    const deps: TransferDeps = {
        current: () => favourites,
        add: async gifToAdd => {
            const attempt = (world.attempts.get(gifToAdd.url) ?? 0) + 1;
            world.attempts.set(gifToAdd.url, attempt);
            world.onAdd(gifToAdd, attempt);
            world.added.push(gifToAdd);
            favourites[gifToAdd.url] = { src: gifToAdd.src };
        },
        remove: async url => {
            const attempt = (world.removeAttempts.get(url) ?? 0) + 1;
            world.removeAttempts.set(url, attempt);
            world.onRemove(url, attempt);
            world.removed.push(url);
            delete favourites[url];
        },
        confirm: count => { world.asked.push(count); return world.answer; },
        sleep: async ms => { world.slept.push(ms); clock += ms; },
        now: () => clock,
        toast: (message, kind) => { world.toasts.push([message, kind]); },
        log: message => { world.logs.push(message); },
        warn: message => { world.warns.push(message); },
        options: () => ({ ...OPTIONS, ...options })
    };
    return Object.assign(world, { deps, transfer: makeTransfer(deps) });
}

const rateLimit = () => Object.assign(new Error("slow down"), { status: 429 });

describe("GifTransfer: the file", () => {
    it("builds the export with defaults for what is missing, and nothing when there are no favourites", () => {
        assert.equal(buildExport({}, "now"), null);
        const built = buildExport({ "https://a": { src: "https://a.src", width: 5, height: "6", format: 3, order: 9 }, "https://b": {} }, "2026-01-01")!;
        assert.equal(built.version, 2);
        assert.equal(built.exportedAt, "2026-01-01");
        assert.equal(built.totalGifs, 2);
        assert.deepEqual(built.gifs[0], { url: "https://a", src: "https://a.src", width: 5, height: 6, format: 3, order: 9 });
        assert.deepEqual(built.gifs[1], { url: "https://b", src: "https://b", width: 498, height: 280, format: 2, order: 0 });
    });

    it("reads a file only when it holds a list of GIFs", () => {
        assert.equal(parseExport("not json"), null);
        assert.equal(parseExport("null"), null);
        assert.equal(parseExport("{\"gifs\":5}"), null);
        assert.equal(parseExport("{}"), null);
        assert.deepEqual(parseExport(file(gif("a")))!.gifs.length, 1);
    });

    it("tells which GIFs of a file are missing and which are repeated", () => {
        const report = verifyFile(parseExport(file(gif("a"), gif("b"), gif("a"), gif("c")))!, { a: {}, c: {} });
        assert.deepEqual(report, { total: 4, found: 3, missing: ["b"], duplicates: 1 });
    });

    it("knows a rate limit by its status, its text or its retry-after", () => {
        assert.equal(isRateLimit({ status: 429 }), true);
        assert.equal(isRateLimit({ text: "You are hitting a rate limit" }), true);
        assert.equal(isRateLimit({ body: { retry_after: 2 } }), true);
        for (const other of [new Error("x"), { status: 500 }, { text: 5 }, { text: "something else" }, { body: {} }, { body: { retry_after: 0 } }, null, undefined]) assert.equal(isRateLimit(other), false);
    });
});

describe("GifTransfer: verify", () => {
    it("says what is missing and points at the console, or that all are there", () => {
        const some = setup({}, { a: {} });
        some.transfer.verifyText(file(gif("a"), gif("b")));
        assert.deepEqual(some.toasts, [["Missing 1 GIFs. Press Import again to retry. Check console for details.", "failure"]]);
        assert.match(some.logs[0], /Total in file: 2[\s\S]*Found in favorites: 1[\s\S]*Missing from favorites: 1[\s\S]*Missing GIFs:\nb/);
        const all = setup({}, { a: {} });
        all.transfer.verifyText(file(gif("a")));
        assert.deepEqual(all.toasts, [["All 1 GIFs verified! No missing GIFs.", "success"]]);
        assert.match(all.logs[0], /All GIFs are present/);
    });

    it("lists ten missing GIFs and counts the rest", () => {
        const world = setup();
        world.transfer.verifyText(file(...Array.from({ length: 13 }, (_, i) => gif(`u${i}`))));
        assert.match(world.logs[0], /u9\n\.\.\.and 3 more/);
        assert.doesNotMatch(world.logs[0], /u10/);
    });

    it("refuses a file that is not an export", () => {
        const world = setup();
        world.transfer.verifyText("{}");
        assert.deepEqual(world.toasts, [["Invalid file format.", "failure"]]);
    });
});

describe("GifTransfer: import", () => {
    it("adds each new GIF with Discord's size defaults, skips the ones already there, and waits between them", async () => {
        const world = setup({}, { have: {} });
        await world.transfer.importText(file(gif("have"), gif("new1", { width: 0, height: undefined, format: "x", src: undefined }), gif("new2"), gif("new1")));
        assert.deepEqual(world.added.map(item => item.url), ["new1", "new2"]);
        assert.deepEqual(world.added[0], { url: "new1", src: "new1", width: 498, height: 280, format: 2 });
        assert.deepEqual(world.added[1], { url: "new2", src: "new2.src", width: 10, height: 20, format: 1 });
        assert.deepEqual(world.slept, [100, 100]);
        assert.equal(world.toasts[0][0], "Importing 2 GIFs... (1 skipped as duplicates)");
        assert.deepEqual(world.toasts[1], ["Import complete! 2 GIFs added, 1 duplicates skipped, 0 errors.", "success"]);
    });

    it("says there is nothing to do when everything is already there", async () => {
        const world = setup({}, { a: {} });
        await world.transfer.importText(file(gif("a")));
        assert.deepEqual(world.toasts, [["All GIFs are already in your favorites. Nothing to import.", undefined]]);
        assert.equal(world.added.length, 0);
    });

    it("adds the ones already there too when it was told not to skip them", async () => {
        const world = setup({ skipDuplicates: false }, { a: {} });
        await world.transfer.importText(file(gif("a")));
        assert.deepEqual(world.added.map(item => item.url), ["a"]);
        assert.match(world.toasts[0][0], /\(0 skipped as duplicates\)/);
    });

    it("leaves out entries without an address and repeated addresses, and says so in the log", async () => {
        const world = setup();
        await world.transfer.importText(file(gif("a"), { src: "no url" }, { url: "" }, { url: 5 }, null, gif("a"), gif("a")));
        assert.deepEqual(world.added.map(item => item.url), ["a"]);
        assert.ok(world.logs.some(line => line === "Removed 2 duplicate URLs from import file."));
        assert.ok(world.logs.some(line => line === "Skipped 4 entries without a URL."));
    });

    it("refuses a file that is not an export", async () => {
        const world = setup();
        await world.transfer.importText("nope");
        assert.deepEqual(world.toasts, [["Invalid file format.", "failure"]]);
    });

    it("counts a GIF Discord refuses as an error and goes on with the next", async () => {
        const world = setup();
        world.onAdd = added => { if (added.url === "bad") throw new Error("refused"); };
        await world.transfer.importText(file(gif("bad"), gif("good")));
        assert.deepEqual(world.added.map(item => item.url), ["good"]);
        assert.equal(world.warns.length, 1);
        assert.deepEqual(world.toasts.at(-1), ["Import complete! 1 GIFs added, 0 duplicates skipped, 1 errors.", "success"]);
    });

    it("says it failed when nothing was added", async () => {
        const world = setup();
        world.onAdd = () => { throw new Error("refused"); };
        await world.transfer.importText(file(gif("a")));
        assert.deepEqual(world.toasts.at(-1), ["Import complete! 0 GIFs added, 0 duplicates skipped, 1 errors.", "failure"]);
    });

    it("slows down and tries again when Discord says slow down, up to three times, never past the limit", async () => {
        const world = setup({ delayBetweenImports: 1000 });
        world.onAdd = (_added, attempt) => { if (attempt <= 3) throw rateLimit(); };
        await world.transfer.importText(file(gif("a")));
        assert.equal(world.attempts.get("a"), 4);
        assert.deepEqual(world.slept, [4000, 8000, 10_000, 5000]);
        assert.equal(world.toasts.filter(([, kind]) => kind === "failure").length, 3);
        assert.deepEqual(world.toasts.at(-1), ["Import complete! 1 GIFs added, 0 duplicates skipped, 0 errors.", "success"]);
    });

    it("gives up on a GIF after three slow-downs, and does not slow down when it was told not to", async () => {
        const stubborn = setup();
        stubborn.onAdd = () => { throw rateLimit(); };
        await stubborn.transfer.importText(file(gif("a")));
        assert.equal(stubborn.attempts.get("a"), 4);
        assert.equal(stubborn.warns.length, 1);
        const fixed = setup({ autoIncreaseDelay: false });
        fixed.onAdd = () => { throw rateLimit(); };
        await fixed.transfer.importText(file(gif("a")));
        assert.equal(fixed.attempts.get("a"), 1);
        assert.deepEqual(fixed.slept, [100]);
    });

    it("writes its progress to the log every fifty GIFs", async () => {
        const world = setup({ delayBetweenImports: 0 });
        await world.transfer.importText(file(...Array.from({ length: 100 }, (_, i) => gif(`u${i}`))));
        assert.deepEqual(world.logs.filter(line => line.startsWith("Progress")).map(line => line.split(" |")[0]), ["Progress: 50/100", "Progress: 100/100"]);
    });
});

describe("GifTransfer: making sure the import is complete", () => {
    it("checks after the import and is done when everything is there", async () => {
        const world = setup({ ensureCompleteImport: true });
        await world.transfer.importText(file(gif("a"), gif("b")));
        assert.deepEqual(world.toasts.at(-1), ["All 2 GIFs are now in your favorites.", "success"]);
        assert.deepEqual(world.slept, [100, 100, 50]);
    });

    it("puts back what Discord took away, in passes, and reports it", async () => {
        const world = setup({ ensureCompleteImport: true });
        // Discord drops "b" right after it was added, once.
        const originalAdd = world.deps.add;
        world.deps.add = async added => { await originalAdd(added); if (added.url === "b" && world.attempts.get("b") === 1) delete world.favourites.b; };
        await world.transfer.importText(file(gif("a"), gif("b")));
        assert.equal(world.attempts.get("b"), 2);
        assert.ok(world.toasts.some(([message]) => message === "Verifying import, pass 1: re-adding 1 missing GIFs..."));
        assert.deepEqual(world.toasts.at(-1), ["All 2 GIFs are now in your favorites.", "success"]);
    });

    it("slows down during a pass too, and counts a failed re-add as an error", async () => {
        const world = setup({ ensureCompleteImport: true, maxRetryPasses: 1 });
        const originalAdd = world.deps.add;
        world.deps.add = async added => {
            await originalAdd(added);
            if (world.attempts.get(added.url) === 1) delete world.favourites[added.url];
        };
        world.onAdd = (_added, attempt) => { if (attempt === 2) throw rateLimit(); };
        await world.transfer.importText(file(gif("a")));
        // The re-add of "a" is refused with a slow-down, so it is still missing at the end.
        assert.deepEqual(world.toasts.at(-1), ["Import finished with 1 GIFs still missing. Run Import again to retry.", "failure"]);
        assert.ok(world.slept.includes(400), "waited twice the doubled delay");
        assert.equal(world.warns.length, 0);
    });

    it("warns when a re-add fails for another reason", async () => {
        const world = setup({ ensureCompleteImport: true, maxRetryPasses: 1 });
        const originalAdd = world.deps.add;
        world.deps.add = async added => { await originalAdd(added); if (world.attempts.get(added.url) === 1) delete world.favourites[added.url]; };
        world.onAdd = (_added, attempt) => { if (attempt === 2) throw new Error("refused"); };
        await world.transfer.importText(file(gif("a")));
        assert.equal(world.warns.length, 1);
        assert.match(world.logs.at(-1)!, /Still missing:\na/);
    });

    it("does no passes when it was told none, and checks once more at the end", async () => {
        const world = setup({ ensureCompleteImport: true, maxRetryPasses: 0 });
        await world.transfer.importText(file(gif("a")));
        assert.deepEqual(world.slept, [100, 50]);
        assert.deepEqual(world.toasts.at(-1), ["All 1 GIFs are now in your favorites.", "success"]);
    });
});

describe("GifTransfer: deleting all the favourites", () => {
    const three = { a: {}, b: {}, c: {} };

    it("asks first with the number there are, then deletes each one with the wait between them, and says all were deleted", async () => {
        const world = setup({ settleWatch: false }, { ...three });
        await world.transfer.clearAll();
        assert.deepEqual(world.asked, [3]);
        assert.deepEqual(world.removed, ["a", "b", "c"]);
        assert.deepEqual(world.slept, [100, 100, 100]);
        assert.deepEqual(world.toasts, [["Deleting 3 favorite GIFs...", undefined], ["Deleted all 3 favorite GIFs.", "success"]]);
    });

    it("says there is nothing to delete, without asking, when there are no favourites", async () => {
        const world = setup();
        await world.transfer.clearAll();
        assert.deepEqual(world.asked, []);
        assert.deepEqual(world.toasts, [["You have no favorite GIFs to delete.", undefined]]);
    });

    it("deletes nothing, and says nothing, when the person says no", async () => {
        const world = setup({}, { ...three });
        world.answer = false;
        await world.transfer.clearAll();
        assert.deepEqual(world.asked, [3]);
        assert.deepEqual(world.removed, []);
        assert.deepEqual(world.toasts, []);
        assert.deepEqual(Object.keys(world.favourites), ["a", "b", "c"]);
    });

    it("slows down and tries again when Discord says slow down, never past the limit, and gives up on one after three", async () => {
        const world = setup({ delayBetweenImports: 1000 }, { a: {} });
        world.onRemove = (_url, attempt) => { if (attempt <= 3) throw rateLimit(); };
        await world.transfer.clearAll();
        assert.equal(world.removeAttempts.get("a"), 4);
        assert.deepEqual(world.slept, [4000, 8000, 10_000, 5000]);
        assert.deepEqual(world.toasts.at(-1), ["Deleted all 1 favorite GIFs.", "success"]);
        const stubborn = setup({}, { a: {} });
        stubborn.onRemove = () => { throw rateLimit(); };
        await stubborn.transfer.clearAll();
        assert.equal(stubborn.removeAttempts.get("a"), 4 + 4 + 4, "four tries in each of the three rounds");
        const fixed = setup({ autoIncreaseDelay: false, maxRetryPasses: 0 }, { a: {} });
        fixed.onRemove = () => { throw rateLimit(); };
        await fixed.transfer.clearAll();
        assert.equal(fixed.removeAttempts.get("a"), 1);
    });

    it("tries again in rounds for what is still there, and reports what could not be deleted", async () => {
        const world = setup({ maxRetryPasses: 2, retryPassDelay: 50 }, { ...three });
        world.onRemove = url => { if (url === "b") throw new Error("refused"); };
        await world.transfer.clearAll();
        assert.equal(world.removeAttempts.get("b"), 3, "the first round and two more");
        assert.equal(world.removeAttempts.get("a"), 1, "what went is not asked again");
        assert.equal(world.warns.length, 3);
        assert.deepEqual(world.slept.filter(ms => ms === 50), [50, 50]);
        assert.deepEqual(world.toasts.at(-1), ["Deleted 2 of 3 favorite GIFs; 1 are still there (3 failed). Press Delete all again to retry.", "failure"]);
    });

    it("takes out again what Discord put back, and does no rounds when told none", async () => {
        const world = setup({ maxRetryPasses: 1 }, { a: {} });
        const original = world.deps.remove;
        world.deps.remove = async url => { await original(url); if (world.removeAttempts.get(url) === 1) world.favourites[url] = {}; };
        await world.transfer.clearAll();
        assert.equal(world.removeAttempts.get("a"), 2);
        assert.deepEqual(world.toasts.at(-1), ["Deleted all 1 favorite GIFs.", "success"]);
        const none = setup({ maxRetryPasses: 0 }, { a: {} });
        none.onRemove = () => { throw new Error("refused"); };
        await none.transfer.clearAll();
        assert.equal(none.removeAttempts.get("a"), 1);
        assert.deepEqual(none.slept.filter(ms => ms === 2000), [], "no wait for a round that does not happen");
    });
});

describe("GifTransfer: how long it waits and how often it checks", () => {
    it("rounds a fractional number of passes down, and never does fewer than none or waits a negative time", async () => {
        const fractional = setup({ ensureCompleteImport: true, maxRetryPasses: 1.9, retryPassDelay: 50 });
        const addOnce = fractional.deps.add;
        fractional.deps.add = async added => { await addOnce(added); if (fractional.attempts.get(added.url) === 1) delete fractional.favourites[added.url]; };
        fractional.onAdd = (_added, attempt) => { if (attempt >= 2) throw new Error("refused"); };
        await fractional.transfer.importText(file(gif("a")));
        assert.equal(fractional.attempts.get("a"), 2, "one pass, not two");
        const negative = setup({ ensureCompleteImport: true, maxRetryPasses: -3, retryPassDelay: -5 });
        await negative.transfer.importText(file(gif("a")));
        assert.deepEqual(negative.slept, [100, 0]);
    });

    it("starts the watch again after it put something back, so it keeps watching the full time", async () => {
        const world = setup({ settleWatch: true, settleWatchDuration: 2000 });
        let tick = 0;
        const originalSleep = world.deps.sleep;
        world.deps.sleep = async ms => { await originalSleep(ms); if (ms === 1000 && ++tick === 2) delete world.favourites.a; };
        await world.transfer.importText(file(gif("a")));
        assert.equal(world.slept.filter(ms => ms === 1000).length, 4, "two checks, then the full time again");
    });

    it("watches after a first-pass or a last-pass complete import, when it was told to", async () => {
        const first = setup({ ensureCompleteImport: true, settleWatch: true, settleWatchDuration: 1000 });
        await first.transfer.importText(file(gif("a")));
        assert.ok(first.toasts.some(([message]) => message.startsWith("Watching")));
        assert.deepEqual(first.toasts.at(-1), ["All 1 GIFs stayed in your favorites.", "success"]);
        const last = setup({ ensureCompleteImport: true, maxRetryPasses: 0, settleWatch: true, settleWatchDuration: 1000 });
        await last.transfer.importText(file(gif("a")));
        assert.ok(last.toasts.some(([message]) => message.startsWith("Watching")));
    });

    it("lists ten missing GIFs and says how many more when there are eleven", () => {
        const world = setup();
        world.transfer.verifyText(file(...Array.from({ length: 11 }, (_, i) => gif(`u${i}`))));
        assert.match(world.logs[0], /u9\n\.\.\.and 1 more/);
    });
});

describe("GifTransfer: watching after the import", () => {
    it("watches for the time asked and says all stayed when none went", async () => {
        const world = setup({ settleWatch: true, settleWatchDuration: 3000 });
        await world.transfer.importText(file(gif("a")));
        assert.ok(world.toasts.some(([message]) => message === "Watching favorites for 3s to catch GIFs Discord removes..."));
        assert.deepEqual(world.toasts.at(-1), ["All 1 GIFs stayed in your favorites.", "success"]);
        assert.deepEqual(world.slept.filter(ms => ms === 1000).length, 3);
    });

    it("puts back what Discord removes while it watches, and starts the watch again", async () => {
        const world = setup({ settleWatch: true, settleWatchDuration: 3000 });
        let dropped = false;
        const originalSleep = world.deps.sleep;
        world.deps.sleep = async ms => { await originalSleep(ms); if (ms === 1000 && !dropped) { dropped = true; delete world.favourites.a; } };
        await world.transfer.importText(file(gif("a")));
        assert.equal(world.attempts.get("a"), 2);
        assert.ok(world.toasts.some(([message]) => message === "Discord removed 1 GIFs, re-adding..."));
        assert.deepEqual(world.toasts.at(-1), ["All 1 GIFs stayed in your favorites.", "success"]);
    });

    it("gives up after five rounds of the same GIF disappearing and says so", async () => {
        const world = setup({ settleWatch: true, settleWatchDuration: 60_000 });
        const originalAdd = world.deps.add;
        world.deps.add = async added => { await originalAdd(added); if ((world.attempts.get(added.url) ?? 0) > 1) delete world.favourites[added.url]; };
        const originalSleep = world.deps.sleep;
        world.deps.sleep = async ms => { await originalSleep(ms); if (ms === 1000) delete world.favourites.a; };
        await world.transfer.importText(file(gif("a")));
        assert.ok(world.logs.some(line => /Settle watch stopped after 5 re-add rounds with 1 still missing/.test(line)));
        assert.equal(world.attempts.get("a"), 6, "the first add and five re-adds");
        assert.deepEqual(world.toasts.at(-1), ["1 GIFs disappeared again. Run Import again to retry.", "failure"]);
    });

    it("slows down while watching when Discord says slow down, and warns when a re-add fails otherwise", async () => {
        const slow = setup({ settleWatch: true, settleWatchDuration: 2000 });
        let attempt = 0;
        const slowAdd = slow.deps.add;
        slow.deps.add = async added => { attempt++; if (attempt === 2) throw rateLimit(); await slowAdd(added); };
        const slowSleep = slow.deps.sleep;
        let dropped = false;
        slow.deps.sleep = async ms => { await slowSleep(ms); if (ms === 1000 && !dropped) { dropped = true; delete slow.favourites.a; } };
        await slow.transfer.importText(file(gif("a")));
        assert.ok(slow.slept.includes(400), "waited twice the doubled delay");
        const failing = setup({ settleWatch: true, settleWatchDuration: 2000 });
        let tries = 0;
        const failAdd = failing.deps.add;
        failing.deps.add = async added => { tries++; if (tries === 2) throw new Error("refused"); await failAdd(added); };
        const failSleep = failing.deps.sleep;
        let gone = false;
        failing.deps.sleep = async ms => { await failSleep(ms); if (ms === 1000 && !gone) { gone = true; delete failing.favourites.a; } };
        await failing.transfer.importText(file(gif("a")));
        assert.equal(failing.warns.length, 1);
    });

    it("does not watch when it was told not to, or for no time, and never longer than two minutes", async () => {
        const off = setup({ settleWatch: false });
        await off.transfer.importText(file(gif("a")));
        assert.ok(!off.toasts.some(([message]) => message.startsWith("Watching")));
        const none = setup({ settleWatch: true, settleWatchDuration: 0 });
        await none.transfer.importText(file(gif("a")));
        assert.ok(!none.toasts.some(([message]) => message.startsWith("Watching")));
        const long = setup({ settleWatch: true, settleWatchDuration: 10_000_000 });
        await long.transfer.importText(file(gif("a")));
        assert.ok(long.toasts.some(([message]) => message === "Watching favorites for 120s to catch GIFs Discord removes..."));
    });

    it("does not watch when nothing was added", async () => {
        const world = setup({ settleWatch: true });
        world.onAdd = () => { throw new Error("refused"); };
        await world.transfer.importText(file(gif("a")));
        assert.ok(!world.toasts.some(([message]) => message.startsWith("Watching")));
    });
});
