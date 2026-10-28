/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fingerprint, parseResolutionCache, ResolutionCache } from "../src/webpack/resolutionCache";

const entry = { moduleId: "12", path: "default", fingerprint: "abc-3" };

describe("fingerprint", () => {
    it("is stable and changes with any edit of the source", () => {
        assert.equal(fingerprint("function(){}"), fingerprint("function(){}"));
        assert.notEqual(fingerprint("function(){a}"), fingerprint("function(){b}"));
        assert.notEqual(fingerprint("ab"), fingerprint("ba"));
    });
});

describe("ResolutionCache", () => {
    it("marks itself dirty only when something really changes", () => {
        const cache = new ResolutionCache(100);
        assert.equal(cache.dirty, false);
        cache.set("k", entry);
        assert.equal(cache.dirty, true);
        cache.serialize();
        assert.equal(cache.dirty, false);
        cache.set("k", { ...entry });
        assert.equal(cache.dirty, false);
        cache.set("k", { ...entry, moduleId: "13" });
        assert.equal(cache.dirty, true);
    });

    it("serializes the same content to the same text whatever the insertion order", () => {
        const a = new ResolutionCache(1);
        a.set("b", entry);
        a.set("a", entry);
        const b = new ResolutionCache(1);
        b.set("a", entry);
        b.set("b", entry);
        assert.equal(a.serialize(), b.serialize());
    });

    it("round-trips", () => {
        const cache = new ResolutionCache(7);
        cache.set("k", entry);
        cache.set("n", { ...entry, path: null });
        const { cache: back, problems } = parseResolutionCache(cache.serialize(), 7);
        assert.deepEqual(problems, []);
        assert.deepEqual(back.get("k"), entry);
        assert.equal(back.get("n")?.path, null);
        assert.equal(back.dirty, false);
    });
});

describe("parseResolutionCache", () => {
    it("starts empty with no file, without a problem", () => {
        const { cache, problems } = parseResolutionCache(null, 5);
        assert.equal(cache.size, 0);
        assert.deepEqual(problems, []);
    });

    it("never throws on damaged text and says so", () => {
        for (const text of ["", "{", "[]", "null", "{\"entries\":1}", "\"x\""]) {
            const { cache, problems } = parseResolutionCache(text, 5);
            assert.equal(cache.size, 0, text);
            assert.equal(problems.length, 1, text);
        }
    });

    it("drops everything from another build without a problem", () => {
        const old = new ResolutionCache(4);
        old.set("k", entry);
        const { cache, problems } = parseResolutionCache(old.serialize(), 5);
        assert.equal(cache.size, 0);
        assert.deepEqual(problems, []);
    });

    it("trusts nothing when the current build is unknown", () => {
        const old = new ResolutionCache(null);
        old.set("k", entry);
        assert.equal(parseResolutionCache(old.serialize(), null).cache.size, 0);
    });

    it("keeps good entries and drops bad ones", () => {
        const text = JSON.stringify({ build: 5, entries: { good: entry, bad: { moduleId: 1 }, worse: "x" } });
        const { cache, problems } = parseResolutionCache(text, 5);
        assert.equal(cache.size, 1);
        assert.deepEqual(cache.get("good"), entry);
        assert.equal(problems.length, 2);
    });
});
