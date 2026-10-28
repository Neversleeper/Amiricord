/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type WreqLike, WreqView } from "../src/renderer/wreqView";

function viewOver(modules: Record<string, unknown>, cache?: WreqLike["c"]) {
    const view = new WreqView();
    const wreq = ((id: string) => id) as unknown as WreqLike;
    wreq.m = modules;
    if (cache) wreq.c = cache;
    view.wreq = wreq;
    return view;
}

const factory = (text: string) => ({ toString: () => text });

describe("searching the source of the modules", () => {
    it("says whether each module of a hit has already run: noted by the wrapper, or present in the module cache", () => {
        const view = viewOver({ a: factory("var x='NEEDLE'"), b: factory("var y='NEEDLE'"), c: factory("var z='NEEDLE'") }, { c: { exports: {} } });
        view.record("a", {});
        const hits = view.searchSources(["NEEDLE"]).NEEDLE;
        assert.deepEqual(hits.map(hit => [hit.id, hit.loaded]), [["a", true], ["b", false], ["c", true]]);
    });

    it("finds a module that is registered and has not run, and knows nothing of one that is not registered", () => {
        const view = viewOver({ a: factory("'NEEDLE'") });
        assert.equal(view.searchSources(["NEEDLE"]).NEEDLE[0].loaded, false);
        assert.deepEqual(view.searchSources(["OTHER"]).OTHER, []);
    });

    it("answers an empty list per needle when there is no instance, and skips a module whose source cannot be read", () => {
        assert.deepEqual(new WreqView().searchSources(["A", "B"]), { A: [], B: [] });
        const view = viewOver({ bad: { toString: () => { throw new Error("no"); } }, good: factory("'NEEDLE'") });
        assert.deepEqual(view.searchSources(["NEEDLE"]).NEEDLE.map(hit => hit.id), ["good"]);
    });

    it("keeps at most maxHits per needle and a snippet of the asked size around the text", () => {
        const view = viewOver({ a: factory("0123456789NEEDLE0123456789"), b: factory("NEEDLE"), c: factory("NEEDLE") });
        const hits = view.searchSources(["NEEDLE"], 2, 3).NEEDLE;
        assert.equal(hits.length, 2);
        assert.equal(hits[0].snippet, "789NEE", "from `context` before the text to `context` after where it starts");
        assert.equal(hits[0].length, 26);
    });
});
