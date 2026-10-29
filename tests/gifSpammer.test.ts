/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { delayOf, favouriteUrls } from "../src/testcordplugins/GifSpammer/index";

describe("GifSpammer: the favourites it sends", () => {
    it("gives the address of each favourite GIF in the order Discord keeps them", () => {
        const store = { frecencyWithoutFetchingLatest: { favoriteGifs: { gifs: { "https://a/1.gif": { src: "https://cdn/1.gif" }, "https://a/2.gif": { src: "https://cdn/2.gif" } } } } };
        assert.deepEqual(favouriteUrls(store), ["https://cdn/1.gif", "https://cdn/2.gif"]);
    });

    it("falls back to the key of an entry that has no address, and leaves out an empty one", () => {
        const store = { frecencyWithoutFetchingLatest: { favoriteGifs: { gifs: { "https://a/1.gif": {}, "": undefined } } } };
        assert.deepEqual(favouriteUrls(store), ["https://a/1.gif"]);
    });

    it("gives nothing when the settings are not there", () => {
        assert.deepEqual(favouriteUrls(undefined), []);
        assert.deepEqual(favouriteUrls({}), []);
        assert.deepEqual(favouriteUrls({ frecencyWithoutFetchingLatest: {} }), []);
    });
});

describe("GifSpammer: the delay between messages", () => {
    it("uses the number given, rounded down, from 0 up", () => {
        assert.equal(delayOf(500), 500);
        assert.equal(delayOf(0), 0);
        assert.equal(delayOf(1500.9), 1500);
    });

    it("uses 2000 when none was given or what was given is not a usable number", () => {
        for (const value of [undefined, null, "500", -1, Number.NaN, Number.POSITIVE_INFINITY, {}]) assert.equal(delayOf(value), 2000, String(value));
    });
});
