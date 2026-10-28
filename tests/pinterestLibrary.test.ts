/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStorage, type StorageBackend } from "../src/api/storage";
import { EXPORT_FORMAT, EXPORT_VERSION, Library, LIBRARY_LIMITS, recentEntry, sanitizeFavourite } from "../src/testcordplugins/PinterestTool/library";
import type { PinterestImageResult } from "../src/testcordplugins/PinterestTool/types";

function setup(options: { initial?: Record<string, unknown>; now?: () => number; failWrites?: boolean; } = {}) {
    const data = new Map<string, string>(Object.entries(options.initial ?? {}).map(([key, value]) => [`PinterestTool/${key}`, JSON.stringify(value)]));
    const backend: StorageBackend = {
        get: async key => data.get(key),
        set: async (key, text) => { if (options.failWrites) throw new Error("disk full"); data.set(key, text); },
        delete: async key => { data.delete(key); },
        keys: async () => [...data.keys()]
    };
    let clock = 1000;
    const now = options.now ?? (() => clock++);
    return { library: new Library(buildStorage("PinterestTool", backend), now), data, raw: (key: string) => JSON.parse(data.get(`PinterestTool/${key}`) ?? "null") as unknown };
}

const result = (id: string, extra: Partial<PinterestImageResult> = {}): PinterestImageResult => ({
    id, title: `Title ${id}`, description: "", url: `https://i.pinimg.com/originals/${id}.jpg`, width: 600, height: 800, dominantColor: "#aabbcc", pinterestUrl: `https://www.pinterest.com/pin/${id}/`,
    isGif: false, thumbUrl: `https://i.pinimg.com/474x/${id}.jpg`, source: "PINTEREST", ...extra
});

describe("sanitizeFavourite", () => {
    it("keeps a good entry with only the known fields, and gives it the target and a time", () => {
        const kept = sanitizeFavourite({ ...result("a1"), evil: "x", extra: { deep: 1 } }, "AVATAR", 99);
        assert.deepEqual(kept, { ...result("a1"), target: "AVATAR", savedAt: 99 });
        assert.equal("evil" in (kept as object), false);
    });

    it("needs an id, an image address on Pinterest's image servers over https, and a size", () => {
        const bad: unknown[] = [null, "x", [], {}, result("a", { id: "" }), result("a", { id: "has space" }), result("a", { id: "x".repeat(65) }),
            result("a", { url: "http://i.pinimg.com/a.jpg" }), result("a", { url: "https://evil.example/a.jpg" }), result("a", { url: "https://i.pinimg.com.evil.example/a.jpg" }),
            result("a", { url: "https://www.pinterest.com/a.jpg" }), result("a", { url: "https://user:pw@i.pinimg.com/a.jpg" }), result("a", { url: "not a url" }),
            result("a", { url: `https://i.pinimg.com/${"x".repeat(700)}.jpg` }), result("a", { width: 0 }), result("a", { height: -1 }), result("a", { width: 1.5 }),
            result("a", { width: 20_001 }), result("a", { width: "600" as unknown as number }), { ...result("a"), id: 5 }];
        for (const item of bad) assert.equal(sanitizeFavourite(item, "AVATAR", 1), null, JSON.stringify(item).slice(0, 80));
        assert.ok(sanitizeFavourite(result("a", { url: "https://s.pinimg.com/a.jpg" }), "AVATAR", 1));
    });

    it("drops optional fields that do not look right instead of refusing the entry", () => {
        const kept = sanitizeFavourite(result("a", {
            thumbUrl: "https://evil.example/t.jpg", fallbackUrl: "javascript:alert(1)", pinterestUrl: "https://evil.example/pin/1", authorUrl: "https://example.com/u",
            dominantColor: "red", author: "   "
        }), "BANNER", 5)!;
        assert.equal("thumbUrl" in kept, false);
        assert.equal("fallbackUrl" in kept, false);
        assert.equal(kept.pinterestUrl, null);
        assert.equal("authorUrl" in kept, false);
        assert.equal(kept.dominantColor, null);
        assert.equal("author" in kept, false);
        assert.equal(kept.target, "BANNER");
    });

    it("cuts long texts, removes control characters, lower-cases the colour and keeps a real time", () => {
        const kept = sanitizeFavourite(result("a", { title: `a\n\tb${"x".repeat(400)}`, description: "d".repeat(1000), dominantColor: "#AABBCC", author: "Someone", authorUrl: "https://www.pinterest.com/someone/" }), "AVATAR", 5)!;
        assert.equal(kept.title.length, 300);
        assert.equal(/[\u0000-\u001f]/.test(kept.title), false);
        assert.equal(kept.description.length, 600);
        assert.equal(kept.dominantColor, "#aabbcc");
        assert.equal(kept.author, "Someone");
        assert.equal(kept.authorUrl, "https://www.pinterest.com/someone/");
        assert.equal(sanitizeFavourite({ ...result("a"), savedAt: 42 }, "AVATAR", 5)?.savedAt, 42);
        for (const bad of [0, -1, NaN, Infinity, "5", null]) assert.equal(sanitizeFavourite({ ...result("a"), savedAt: bad }, "AVATAR", 5)?.savedAt, 5, String(bad));
    });

    it("always says Pinterest was the source, whatever the entry said", () => {
        assert.equal(sanitizeFavourite({ ...result("a"), source: "DEVIANTART" }, "AVATAR", 1)?.source, "PINTEREST");
    });
});

describe("recentEntry", () => {
    it("cleans a search and refuses an empty or long one", () => {
        assert.equal(recentEntry("  cute \n cats  "), "cute cats");
        assert.equal(recentEntry(""), null);
        assert.equal(recentEntry("   "), null);
        assert.equal(recentEntry("x".repeat(LIBRARY_LIMITS.recentChars)), "x".repeat(LIBRARY_LIMITS.recentChars));
        assert.equal(recentEntry("x".repeat(LIBRARY_LIMITS.recentChars + 1)), null);
        assert.equal(recentEntry(5), null);
    });
});

describe("Library: favourites", () => {
    it("saves a favourite, finds it, lists it newest first and removes it", async () => {
        const t = setup();
        assert.equal(await t.library.addFavourite(result("a"), "AVATAR"), "added");
        assert.equal(await t.library.addFavourite(result("b"), "AVATAR"), "added");
        assert.equal(await t.library.addFavourite(result("c"), "BANNER"), "added");
        assert.equal(await t.library.isFavourite(result("a"), "AVATAR"), true);
        assert.equal(await t.library.isFavourite(result("a"), "BANNER"), false, "a kind has its own list");
        assert.deepEqual((await t.library.favourites("AVATAR")).map(f => f.id), ["b", "a"]);
        assert.deepEqual((await t.library.favourites()).map(f => f.id), ["c", "b", "a"]);
        assert.equal(await t.library.removeFavourite(result("a"), "AVATAR"), true);
        assert.equal(await t.library.removeFavourite(result("a"), "AVATAR"), false);
        assert.deepEqual((await t.library.favourites("AVATAR")).map(f => f.id), ["b"]);
    });

    it("says it exists when it is already saved, and does not move it", async () => {
        const t = setup();
        await t.library.addFavourite(result("a"), "AVATAR");
        await t.library.addFavourite(result("b"), "AVATAR");
        assert.equal(await t.library.addFavourite(result("a"), "AVATAR"), "exists");
        assert.deepEqual((await t.library.favourites("AVATAR")).map(f => f.id), ["b", "a"]);
    });

    it("saves with the time of saving, not the time the result carried", async () => {
        const t = setup({ now: () => 5000 });
        await t.library.addFavourite({ ...result("a"), savedAt: 1 } as PinterestImageResult, "AVATAR");
        assert.equal((await t.library.favourites("AVATAR"))[0].savedAt, 5000);
    });

    it("stops at the limit of a kind", async () => {
        const t = setup();
        for (let i = 0; i < LIBRARY_LIMITS.favouritesPerKind; i++) assert.equal(await t.library.addFavourite(result(`p${i}`), "AVATAR"), "added");
        assert.equal(await t.library.addFavourite(result("extra"), "AVATAR"), "full");
        assert.equal(await t.library.addFavourite(result("extra"), "BANNER"), "added", "the other kind has room");
        assert.equal((await t.library.favourites("AVATAR")).length, LIBRARY_LIMITS.favouritesPerKind);
    });

    it("refuses an image that cannot be a favourite", async () => {
        const t = setup();
        await assert.rejects(t.library.addFavourite(result("a", { url: "https://evil.example/a.jpg" }), "AVATAR"), /cannot be saved as a favourite/);
        assert.equal(t.data.size, 0);
    });

    it("keeps both of two quick saves", async () => {
        const t = setup();
        await Promise.all([t.library.addFavourite(result("a"), "AVATAR"), t.library.addFavourite(result("b"), "AVATAR"), t.library.addFavourite(result("c"), "AVATAR")]);
        assert.deepEqual((await t.library.favourites("AVATAR")).map(f => f.id).sort(), ["a", "b", "c"]);
    });

    it("keeps working after a save that failed", async () => {
        const failing = setup({ failWrites: true });
        await assert.rejects(failing.library.addFavourite(result("a"), "AVATAR"), /disk full/);
        await assert.rejects(failing.library.addFavourite(result("b"), "AVATAR"), /disk full/);
        const ok = setup();
        const first = ok.library.addFavourite(result("a"), "AVATAR");
        assert.equal(await first, "added");
    });

    it("reads a damaged list as what is usable in it: no repeats, no foreign addresses, no more than the limit", async () => {
        const t = setup({ initial: { "favourites-avatar": [result("a"), result("a"), { id: "b", url: "https://evil.example/b.jpg", width: 1, height: 1 }, "junk", result("c")], "favourites-banner": "not a list" } });
        assert.deepEqual((await t.library.favourites("AVATAR")).map(f => f.id).sort(), ["a", "c"]);
        assert.deepEqual(await t.library.favourites("BANNER"), []);
        const many = setup({ initial: { "favourites-avatar": Array.from({ length: 500 }, (_, i) => result(`p${i}`)) } });
        assert.equal((await many.library.favourites("AVATAR")).length, LIBRARY_LIMITS.favouritesPerKind);
    });
});

describe("Library: recent searches", () => {
    it("remembers the newest first, without repeats in another letter case, at most ten", async () => {
        const t = setup();
        for (const query of ["a", "b", "A", "c", "d", "e", "f", "g", "h", "i", "j", "k"]) await t.library.rememberSearch(query);
        const recent = await t.library.recent();
        assert.equal(recent.length, LIBRARY_LIMITS.recent);
        assert.deepEqual(recent, ["k", "j", "i", "h", "g", "f", "e", "d", "c", "A"]);
        assert.deepEqual(t.raw("recent-searches"), recent, "what is saved is the same short list, without repeats, not only what is read from it");
    });

    it("gives back the new list when a search is remembered, with the repeat moved to the top", async () => {
        const t = setup();
        await t.library.rememberSearch("cats");
        await t.library.rememberSearch("dogs");
        assert.deepEqual(await t.library.rememberSearch("CATS"), ["CATS", "dogs"]);
        assert.deepEqual(t.raw("recent-searches"), ["CATS", "dogs"]);
    });

    it("ignores an empty or long search and gives the list as it was", async () => {
        const t = setup();
        await t.library.rememberSearch("cats");
        assert.deepEqual(await t.library.rememberSearch("   "), ["cats"]);
        assert.deepEqual(await t.library.rememberSearch("x".repeat(81)), ["cats"]);
    });

    it("clears the list", async () => {
        const t = setup();
        await t.library.rememberSearch("cats");
        await t.library.clearRecent();
        assert.deepEqual(await t.library.recent(), []);
    });

    it("reads a damaged list as what is usable in it", async () => {
        const t = setup({ initial: { "recent-searches": ["ok", 5, "", "OK", "x".repeat(200), "other"] } });
        assert.deepEqual(await t.library.recent(), ["ok", "other"]);
        assert.deepEqual(await setup({ initial: { "recent-searches": "no" } }).library.recent(), []);
    });
});

describe("Library: export and import", () => {
    it("exports the favourites and the recent searches in a labelled format, and never anything else", async () => {
        const t = setup({ now: () => 7 });
        await t.library.addFavourite(result("a"), "AVATAR");
        await t.library.addFavourite(result("b"), "BANNER");
        await t.library.rememberSearch("cats");
        const exported = await t.library.exportData();
        assert.equal(exported.format, EXPORT_FORMAT);
        assert.equal(exported.version, EXPORT_VERSION);
        assert.equal(exported.exportedAt, 7);
        assert.deepEqual(exported.favourites.AVATAR.map(f => f.id), ["a"]);
        assert.deepEqual(exported.favourites.BANNER.map(f => f.id), ["b"]);
        assert.deepEqual(exported.recent, ["cats"]);
        assert.deepEqual(Object.keys(exported).sort(), ["exportedAt", "favourites", "format", "recent", "version"]);
        assert.equal(JSON.parse(await t.library.exportText()).format, EXPORT_FORMAT);
    });

    it("reads its own export back into an empty library, from the text or from the object", async () => {
        const from = setup();
        await from.library.addFavourite(result("a"), "AVATAR");
        await from.library.addFavourite(result("b"), "BANNER");
        await from.library.rememberSearch("cats");
        const text = await from.library.exportText();

        const into = setup();
        const report = await into.library.importData(text);
        assert.deepEqual(report, { addedFavourites: 2, alreadyThere: 0, refused: 0, overLimit: 0, addedRecent: 1 });
        assert.deepEqual((await into.library.favourites()).map(f => f.id).sort(), ["a", "b"]);
        assert.deepEqual(await into.library.recent(), ["cats"]);

        const again = await setup().library.importData(JSON.parse(text));
        assert.equal(again.addedFavourites, 2);
    });

    it("adds to what is there without replacing or removing anything, and counts repeats", async () => {
        const t = setup();
        await t.library.addFavourite(result("keep"), "AVATAR");
        await t.library.rememberSearch("mine");
        const file = { format: EXPORT_FORMAT, version: 1, favourites: { AVATAR: [result("keep"), result("new")], BANNER: [] }, recent: ["mine", "theirs"] };
        assert.deepEqual(await t.library.importData(file), { addedFavourites: 1, alreadyThere: 1, refused: 0, overLimit: 0, addedRecent: 1 });
        assert.deepEqual((await t.library.favourites("AVATAR")).map(f => f.id).sort(), ["keep", "new"]);
        assert.deepEqual(await t.library.recent(), ["mine", "theirs"]);
    });

    it("refuses unusable entries one by one and says how many, keeping the good ones", async () => {
        const t = setup();
        const file = { format: EXPORT_FORMAT, version: 1, favourites: { AVATAR: [result("good"), { id: "x", url: "https://evil.example/x.jpg", width: 5, height: 5 }, "junk", null, 5], BANNER: "not a list" } };
        assert.deepEqual(await t.library.importData(file), { addedFavourites: 1, alreadyThere: 0, refused: 4, overLimit: 0, addedRecent: 0 });
        assert.deepEqual((await t.library.favourites()).map(f => f.id), ["good"]);
    });

    it("rebuilds every imported favourite from the whitelist, so nothing extra gets in", async () => {
        const t = setup();
        await t.library.importData({ format: EXPORT_FORMAT, version: 1, favourites: { AVATAR: [{ ...result("a"), __proto__: { polluted: true }, script: "x", target: "BANNER" }] } });
        const [saved] = await t.library.favourites("AVATAR");
        assert.equal("script" in saved, false);
        assert.equal(saved.target, "AVATAR", "the kind comes from where it is in the file, not from the entry");
        assert.equal(({} as Record<string, unknown>).polluted, undefined);
    });

    it("leaves out what does not fit in a full kind", async () => {
        const t = setup({ initial: { "favourites-avatar": Array.from({ length: LIBRARY_LIMITS.favouritesPerKind - 1 }, (_, i) => result(`p${i}`)) } });
        const file = { format: EXPORT_FORMAT, version: 1, favourites: { AVATAR: [result("n1"), result("n2"), result("n3")] } };
        assert.deepEqual(await t.library.importData(file), { addedFavourites: 1, alreadyThere: 0, refused: 0, overLimit: 2, addedRecent: 0 });
        assert.equal((await t.library.favourites("AVATAR")).length, LIBRARY_LIMITS.favouritesPerKind);
    });

    it("does not look at more than a few times the limit of a huge file", async () => {
        const t = setup();
        const file = { format: EXPORT_FORMAT, version: 1, favourites: { AVATAR: Array.from({ length: LIBRARY_LIMITS.favouritesPerKind * 2 + 50 }, (_, i) => result(`p${i}`)) } };
        const report = await t.library.importData(file);
        assert.equal(report.addedFavourites, LIBRARY_LIMITS.favouritesPerKind);
        assert.equal(report.overLimit, LIBRARY_LIMITS.favouritesPerKind);
        assert.equal(report.refused, 50);
    });

    it("keeps the recent searches within their limit when importing", async () => {
        const t = setup();
        const recent = Array.from({ length: 30 }, (_, i) => `search ${i}`);
        const report = await t.library.importData({ format: EXPORT_FORMAT, version: 1, recent });
        assert.equal(report.addedRecent, LIBRARY_LIMITS.recent);
        assert.equal((await t.library.recent()).length, LIBRARY_LIMITS.recent);
    });

    it("says plainly when the file is not an export, is another version, is not JSON or is too big, and changes nothing", async () => {
        const t = setup();
        await assert.rejects(t.library.importData("not json"), /not valid JSON/);
        await assert.rejects(t.library.importData("[]"), /not a Pinterest Tool export/);
        await assert.rejects(t.library.importData({ format: "something-else", version: 1 }), /not a Pinterest Tool export/);
        await assert.rejects(t.library.importData(5), /not a Pinterest Tool export/);
        await assert.rejects(t.library.importData({ format: EXPORT_FORMAT, version: 2 }), /version 2; this one reads version 1/);
        await assert.rejects(t.library.importData({ format: EXPORT_FORMAT }), /version undefined/);
        await assert.rejects(t.library.importData("x".repeat(LIBRARY_LIMITS.importChars + 1)), /too big/);
        assert.equal(t.data.size, 0);
    });

    it("works with an export that has nothing in it", async () => {
        const t = setup();
        assert.deepEqual(await t.library.importData({ format: EXPORT_FORMAT, version: 1 }), { addedFavourites: 0, alreadyThere: 0, refused: 0, overLimit: 0, addedRecent: 0 });
    });
});
