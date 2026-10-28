/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStorage, STORAGE_LIMITS, type StorageBackend } from "../src/api/storage";

function memory(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    const backend: StorageBackend = {
        get: async key => data.get(key),
        set: async (key, text) => { data.set(key, text); },
        delete: async key => { data.delete(key); },
        keys: async () => [...data.keys()]
    };
    return { backend, data };
}

describe("buildStorage", () => {
    it("saves plain data and reads it back", async () => {
        const m = memory();
        const storage = buildStorage("Pin", m.backend);
        await storage.set("favourites", { AVATAR: [{ id: "1", n: 2.5, ok: true, none: null }] });
        assert.deepEqual(await storage.get("favourites"), { AVATAR: [{ id: "1", n: 2.5, ok: true, none: null }] });
        assert.deepEqual([...m.data.keys()], ["Pin/favourites"], "stored under the plugin's own prefix");
    });

    it("gives undefined for what is not there, and for what cannot be read", async () => {
        const m = memory({ "Pin/broken": "{not json", "Pin/odd": "\"fine\"" });
        const storage = buildStorage("Pin", m.backend);
        assert.equal(await storage.get("missing"), undefined);
        assert.equal(await storage.get("broken"), undefined);
        assert.equal(await storage.get("odd"), "fine");
    });

    it("keeps each plugin's data apart", async () => {
        const m = memory();
        const a = buildStorage("A", m.backend);
        const b = buildStorage("B", m.backend);
        await a.set("k", 1);
        await b.set("k", 2);
        assert.equal(await a.get("k"), 1);
        assert.equal(await b.get("k"), 2);
        assert.deepEqual(await a.keys(), ["k"]);
        await a.delete("k");
        assert.equal(await a.get("k"), undefined);
        assert.equal(await b.get("k"), 2);
    });

    it("lists only its own keys, sorted, and does not mistake a plugin whose id starts the same", async () => {
        const m = memory({ "Pin/b": "1", "Pin/a": "2", "PinX/c": "3", "Other/d": "4" });
        assert.deepEqual(await buildStorage("Pin", m.backend).keys(), ["a", "b"]);
    });

    it("refuses keys that are not plain names", async () => {
        const storage = buildStorage("Pin", memory().backend);
        for (const key of ["", " ", "a b", "a/b", "../x", "x".repeat(129), "-start", "é", 5 as unknown as string]) {
            await assert.rejects(storage.set(key, 1), /not a valid storage key/, String(key));
            await assert.rejects(storage.get(key), /not a valid storage key/);
            await assert.rejects(storage.delete(key), /not a valid storage key/);
        }
        await storage.set("a.b_c:d-1", 1);
    });

    it("refuses values that are not plain data or are too big", async () => {
        const m = memory();
        const storage = buildStorage("Pin", m.backend);
        for (const value of [() => 1, undefined, NaN, new Date(), new Map(), Symbol("x")]) await assert.rejects(storage.set("k", value as never), /not plain data/);
        await assert.rejects(storage.set("k", "x".repeat(STORAGE_LIMITS.maxValueChars)), /too big/);
        await storage.set("k", "x".repeat(STORAGE_LIMITS.maxValueChars - 2));
        assert.equal(m.data.size, 1);
    });

    it("fails clearly, only for its own calls, when the page has no storage", async () => {
        const storage = buildStorage("Pin", undefined);
        await assert.rejects(storage.get("k"), /Pin: storage is not available in this page/);
        await assert.rejects(storage.set("k", 1), /not available/);
        await assert.rejects(storage.delete("k"), /not available/);
        await assert.rejects(storage.keys(), /not available/);
    });

    it("passes on what the backend says when it fails", async () => {
        const broken: StorageBackend = { get: async () => { throw new Error("quota"); }, set: async () => { throw new Error("quota"); }, delete: async () => undefined, keys: async () => [] };
        const storage = buildStorage("Pin", broken);
        await assert.rejects(storage.set("k", 1), { message: "quota" });
        await assert.rejects(storage.get("k"), { message: "quota" });
    });
});
