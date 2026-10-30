/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addGif, cleanName, COLLECTION_PREFIX, createCollection, deleteCollection, EMPTY_PICTURE, exportText, extensionOf, Format, formatOf, type Gif, gifAddress, isCdnUrlExpired, MAX_GIFS_PER_COLLECTION, moveGif, readCollections, readExport, removeGif, renameCollection, sortCollections, withRefreshed } from "../src/equicordplugins/GifCollections/model";

const gif = (id: string, extra: Partial<Gif> = {}): Gif => ({ id, src: `https://media.discordapp.net/${id}.gif`, url: `https://tenor.com/view/${id}`, width: 100, height: 80, ...extra });

describe("GifCollections: reading the saved list", () => {
    it("keeps well-formed collections and GIFs only, with unique names and ids", () => {
        const saved = [
            { name: `${COLLECTION_PREFIX}A`, gifs: [gif("1"), gif("1"), { id: "2", src: "http://x/a.gif", url: "https://x/a" }, null, gif("3", { width: -5 })], createdAt: 5, lastUpdated: 6 },
            { name: `${COLLECTION_PREFIX}A`, gifs: [] },
            { name: "no prefix", gifs: [] },
            "text", null
        ];
        const list = readCollections(saved);
        assert.deepEqual(list.map(c => c.name), [`${COLLECTION_PREFIX}A`]);
        assert.deepEqual(list[0]!.gifs.map(g => g.id), ["1", "3"]);
        assert.equal(list[0]!.gifs[1]!.width, 100);
        assert.equal(list[0]!.src, gif("3").src);
        assert.deepEqual(readCollections("nope"), []);
    });

    it("shows the empty picture for a collection with no GIFs", () => {
        assert.equal(readCollections([{ name: `${COLLECTION_PREFIX}E`, gifs: [] }])[0]!.src, EMPTY_PICTURE);
    });
});

describe("GifCollections: changes", () => {
    const now = 1000;
    const base = () => {
        const made = createCollection([], "Cats", [gif("1")], now);
        assert.ok(made.ok);
        return made.ok ? made.list : [];
    };

    it("creates, refuses an empty or repeated name, and cleans the name", () => {
        assert.equal(createCollection([], "  ", [], now).ok, false);
        assert.equal(createCollection(base(), "Cats", [], now).ok, false);
        assert.equal(cleanName("  a\u0007b  "), "a b");
        assert.equal(base()[0]!.name, `${COLLECTION_PREFIX}Cats`);
    });

    it("adds, refuses duplicates when asked, and limits a collection", () => {
        const list = base();
        const added = addGif(list, `${COLLECTION_PREFIX}Cats`, gif("2"), 2000, false);
        assert.ok(added.ok && added.list[0]!.gifs.length === 2 && added.list[0]!.src === gif("2").src && added.list[0]!.lastUpdated === 2000);
        assert.equal(addGif(list, `${COLLECTION_PREFIX}Cats`, gif("9", { url: gif("1").url }), now, true).ok, false);
        assert.equal(addGif(list, `${COLLECTION_PREFIX}Nope`, gif("2"), now, false).ok, false);
        const full = [{ ...list[0]!, gifs: Array.from({ length: MAX_GIFS_PER_COLLECTION }, (_, i) => gif(`g${i}`)) }];
        assert.equal(addGif(full, `${COLLECTION_PREFIX}Cats`, gif("x"), now, false).ok, false);
    });

    it("removes, moves, renames and deletes", () => {
        const two = createCollection(base(), "Dogs", [], now);
        assert.ok(two.ok);
        const list = two.ok ? two.list : [];
        const moved = moveGif(list, "1", `${COLLECTION_PREFIX}Dogs`, 3000);
        assert.ok(moved.ok && moved.list[0]!.gifs.length === 0 && moved.list[1]!.gifs[0]!.id === "1" && moved.list[0]!.src === EMPTY_PICTURE);
        const removed = removeGif(list, "1", now);
        assert.ok(removed.ok && removed.list[0]!.gifs.length === 0);
        assert.equal(removeGif(list, "zzz", now).ok, false);
        const renamed = renameCollection(list, `${COLLECTION_PREFIX}Cats`, "Kittens", now);
        assert.ok(renamed.ok && renamed.list[0]!.name === `${COLLECTION_PREFIX}Kittens`);
        assert.equal(renameCollection(list, `${COLLECTION_PREFIX}Cats`, "Dogs", now).ok, false);
        assert.deepEqual(deleteCollection(list, `${COLLECTION_PREFIX}Cats`).map(c => c.name), [`${COLLECTION_PREFIX}Dogs`]);
        assert.equal(withRefreshed(list, "1", "https://a/b", "https://a/c")[0]!.gifs[0]!.src, "https://a/b");
    });

    it("sorts by name, creation and modification, both ways", () => {
        const a = createCollection([], "B", [], 1);
        const b = a.ok ? createCollection(a.list, "A", [], 2) : a;
        assert.ok(b.ok);
        const list = b.ok ? b.list : [];
        assert.deepEqual(sortCollections(list, "name", "asc").map(c => c.name), [`${COLLECTION_PREFIX}A`, `${COLLECTION_PREFIX}B`]);
        assert.deepEqual(sortCollections(list, "created", "desc").map(c => c.name), [`${COLLECTION_PREFIX}A`, `${COLLECTION_PREFIX}B`]);
        assert.deepEqual(sortCollections(list, "modified", "asc").map(c => c.name), [`${COLLECTION_PREFIX}B`, `${COLLECTION_PREFIX}A`]);
    });
});

describe("GifCollections: addresses and the export file", () => {
    it("tells videos from pictures and finds the extension", () => {
        assert.equal(extensionOf("https://a/b/c.MP4?x=1"), "mp4");
        assert.equal(formatOf("https://a/c.webm"), Format.VIDEO);
        assert.equal(formatOf("https://a/c.gif"), Format.IMAGE);
        assert.equal(formatOf("nope"), Format.IMAGE);
    });

    it("knows an expired Discord picture address, and no other", () => {
        const at = Date.parse("2026-10-29T00:00:00Z");
        assert.equal(isCdnUrlExpired(`https://cdn.discordapp.com/a.png?ex=${Math.floor((at - 1000) / 1000).toString(16)}`, at), true);
        assert.equal(isCdnUrlExpired(`https://cdn.discordapp.com/a.png?ex=${Math.floor((at + 100000) / 1000).toString(16)}`, at), false);
        assert.equal(isCdnUrlExpired("https://example.com/a.png?ex=1", at), false);
        assert.equal(isCdnUrlExpired("https://cdn.discordapp.com/a.png?ex=zz", at), false);
    });

    it("saves the GIF site's page for a clicked picture, else the picture", () => {
        assert.equal(gifAddress("https://media.tenor.com/a.gif", "https://tenor.com/view/x-1"), "https://tenor.com/view/x-1");
        assert.equal(gifAddress("https://a/b.gif", "https://evil.example/x"), "https://a/b.gif");
        assert.equal(gifAddress("https://a/b.gif", undefined), "https://a/b.gif");
    });

    it("exports and reads back, and refuses what is not an export", () => {
        const made = createCollection([], "Cats", [gif("1")], 5);
        const list = made.ok ? made.list : [];
        assert.deepEqual(readExport(exportText(list))?.map(c => c.name), [`${COLLECTION_PREFIX}Cats`]);
        assert.equal(readExport("nope"), undefined);
        assert.equal(readExport("{\"format\":\"x\"}"), undefined);
    });
});
