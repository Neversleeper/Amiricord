/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AddResult, Favourite, FavouriteKind } from "../src/testcordplugins/PinterestTool/library";
import type { PinterestImageResult, PinterestSearchPayload, SearchOptions } from "../src/testcordplugins/PinterestTool/types";
import { describeFailure, saveKinds, type SessionLibrary, WINDOW_LIMITS, WindowSession } from "../src/testcordplugins/PinterestTool/windowSession";

const pin = (id: string): PinterestImageResult => ({ id, title: `t${id}`, description: "", url: `https://i.pinimg.com/originals/${id}.jpg`, width: 10, height: 10, dominantColor: null, pinterestUrl: null, isGif: false });
const page = (ids: string[], bookmark: string[] | null, guides: Array<{ label: string; query: string; }> = []): PinterestSearchPayload => ({ query: "q", guides, results: ids.map(pin), bookmark });

/** A promise that the test settles by hand, so it can decide which answer arrives first. */
function later<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
    return { promise, resolve, reject };
}

function fakeLibrary(initial: { AVATAR?: string[]; BANNER?: string[]; recent?: string[]; } = {}) {
    const store: Record<FavouriteKind, Favourite[]> = {
        AVATAR: (initial.AVATAR ?? []).map(id => ({ ...pin(id), target: "AVATAR", savedAt: 1 }) as Favourite),
        BANNER: (initial.BANNER ?? []).map(id => ({ ...pin(id), target: "BANNER", savedAt: 1 }) as Favourite)
    };
    let recent = initial.recent ?? [];
    const calls: string[] = [];
    let addAnswer: AddResult = "added";
    let failOn: string | undefined;
    const check = (name: string) => { if (failOn === name) throw new Error(`${name} broke`); };
    const library: SessionLibrary = {
        favourites: async kind => { calls.push(`favourites:${kind}`); check("favourites"); return store[kind!]; },
        addFavourite: async (result, kind) => {
            calls.push(`add:${kind}:${result.id}`);
            check("add");
            if (addAnswer === "added") store[kind] = [{ ...result, target: kind, savedAt: 2 } as Favourite, ...store[kind]];
            return addAnswer;
        },
        removeFavourite: async (result, kind) => { calls.push(`remove:${kind}:${result.id}`); check("remove"); store[kind] = store[kind].filter(item => item.id !== result.id); return true; },
        recent: async () => { check("recent"); return recent; },
        rememberSearch: async query => { calls.push(`remember:${query}`); check("remember"); recent = [query, ...recent.filter(item => item !== query)]; return recent; },
        clearRecent: async () => { calls.push("clearRecent"); check("clearRecent"); recent = []; }
    };
    return { library, store, calls, setAdd: (answer: AddResult) => { addAnswer = answer; }, failOn: (name: string | undefined) => { failOn = name; } };
}

function make(answers: Array<(options: SearchOptions) => Promise<PinterestSearchPayload>>, libraryOptions?: Parameters<typeof fakeLibrary>[0], randomize = false) {
    const lib = fakeLibrary(libraryOptions);
    const asked: SearchOptions[] = [];
    let at = 0;
    const session = new WindowSession({
        search: options => { asked.push(options); return answers[at++](options); },
        library: lib.library,
        randomize: () => randomize
    });
    return { session, asked, lib };
}

const now = () => new Promise<void>(resolve => { setImmediate(resolve); });

describe("Pinterest Tool window: searching", () => {
    it("starts empty and idle", () => {
        const { session } = make([]);
        const state = session.state;
        assert.equal(state.status, "idle");
        assert.equal(state.searched, false);
        assert.equal(state.tab, "search");
        assert.equal(state.kind, "AVATAR");
        assert.equal(state.filter, "ALL");
        assert.deepEqual(state.results, []);
        assert.equal(state.hasMore, false);
        assert.equal(state.notice, null);
        assert.equal(state.error, null);
    });

    it("searches page 1 with the kind, the filter and the randomize setting, and fills the grid", async () => {
        const { session, asked } = make([async () => page(["a", "b"], ["next"], [{ label: "g", query: "g q" }])], undefined, true);
        const pending = session.search("  cute   cats ");
        assert.equal(session.state.status, "loading");
        assert.equal(session.state.query, "cute cats");
        assert.equal(session.state.searched, true);
        await pending;
        assert.deepEqual(asked, [{ query: "cute cats", mediaFilter: "ALL", target: "AVATAR", randomize: true }]);
        assert.deepEqual(session.state.results.map(item => item.id), ["a", "b"]);
        assert.deepEqual(session.state.guides, [{ label: "g", query: "g q" }]);
        assert.equal(session.state.hasMore, true);
        assert.equal(session.state.status, "idle");
    });

    it("does nothing for an empty text", async () => {
        const { session, asked } = make([]);
        await session.search("   ");
        assert.equal(asked.length, 0);
        assert.equal(session.state.searched, false);
        assert.equal(session.state.status, "idle");
    });

    it("clears the grid when a new search starts and says there is no more when the cursor is null", async () => {
        const { session } = make([async () => page(["a"], null), async () => new Promise<PinterestSearchPayload>(() => undefined)]);
        await session.search("one");
        assert.equal(session.state.hasMore, false);
        void session.search("two");
        assert.deepEqual(session.state.results, []);
        assert.deepEqual(session.state.guides, []);
        assert.equal(session.state.hasMore, false);
        assert.equal(session.state.tab, "search");
    });

    it("goes to the search tab when a search starts", async () => {
        const { session } = make([async () => page(["a"], null)]);
        session.setTab("favourites");
        await session.search("x");
        assert.equal(session.state.tab, "search");
    });

    it("remembers a search that worked, and not one that failed", async () => {
        const { session, lib } = make([async () => page(["a"], null), async () => { throw new Error("no"); }]);
        await session.search("good");
        await now();
        assert.deepEqual(session.state.recent, ["good"]);
        await session.search("bad");
        await now();
        assert.deepEqual(lib.calls.filter(call => call.startsWith("remember")), ["remember:good"]);
    });

    it("keeps working when remembering the search fails", async () => {
        const { session, lib } = make([async () => page(["a"], null)]);
        lib.failOn("remember");
        await session.search("x");
        await now();
        assert.equal(session.state.status, "idle");
        assert.deepEqual(session.state.recent, []);
    });

    it("drops the answer of a search that was replaced before it came back", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session } = make([() => slow.promise, async () => page(["new"], null)]);
        const first = session.search("old");
        await session.search("new");
        slow.resolve(page(["old1", "old2"], ["x"]));
        await first;
        assert.deepEqual(session.state.results.map(item => item.id), ["new"]);
        assert.equal(session.state.query, "new");
        assert.equal(session.state.hasMore, false);
        assert.equal(session.state.status, "idle");
    });

    it("drops the failure of a search that was replaced", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session } = make([() => slow.promise, async () => page(["new"], null)]);
        const first = session.search("old");
        await session.search("new");
        slow.reject(new Error("late failure"));
        await first;
        assert.equal(session.state.status, "idle");
        assert.equal(session.state.error, null);
    });

    it("does not repeat a card that the source gave twice, and caps the list", async () => {
        const many = Array.from({ length: WINDOW_LIMITS.maxResults + 20 }, (_, i) => `p${i}`);
        const { session } = make([async () => page(["a", "a", "b", ...many], ["more"])]);
        await session.search("x");
        assert.equal(session.state.results.filter(item => item.id === "a").length, 1);
        assert.equal(session.state.hasMore, false, "a full list offers no more");
    });
});

describe("Pinterest Tool window: errors and retry", () => {
    it("shows a short plain message and keeps the cards when a next page fails", async () => {
        const { session } = make([async () => page(["a"], ["n"]), async () => { throw new Error("Pinterest said\n no"); }]);
        await session.search("x");
        await session.loadMore();
        assert.equal(session.state.status, "error");
        assert.equal(session.state.error, "Pinterest said no");
        assert.deepEqual(session.state.results.map(item => item.id), ["a"]);
    });

    it("retries a failed first page as a new search", async () => {
        const { session, asked } = make([async () => { throw new Error("down"); }, async () => page(["a"], null)]);
        await session.search("x");
        assert.equal(session.state.status, "error");
        assert.deepEqual(session.state.results, []);
        await session.retry();
        assert.equal(session.state.status, "idle");
        assert.deepEqual(session.state.results.map((item: { id: string; }) => item.id), ["a"]);
        assert.equal(asked[1].bookmarks, undefined, "page 1 again");
    });

    it("retries a failed next page with the same cursor, keeping what is on screen", async () => {
        const { session, asked } = make([async () => page(["a"], ["cur"]), async () => { throw new Error("down"); }, async () => page(["b"], null)]);
        await session.search("x");
        await session.loadMore();
        await session.retry();
        assert.deepEqual(asked[2].bookmarks, ["cur"]);
        assert.deepEqual(session.state.results.map(item => item.id), ["a", "b"]);
        assert.equal(session.state.status, "idle");
        assert.equal(session.state.error, null);
    });

    it("retry does nothing when nothing failed", async () => {
        const { session, asked } = make([async () => page(["a"], null)]);
        await session.search("x");
        await session.retry();
        assert.equal(asked.length, 1);
    });

    it("describeFailure gives a clean, short text, or a default", () => {
        assert.equal(describeFailure(new Error("  a \n\n b  ")), "a b");
        assert.equal(describeFailure("plain"), "plain");
        assert.equal(describeFailure(new Error("x".repeat(500))).length, WINDOW_LIMITS.errorChars);
        assert.equal(describeFailure(new Error("   ")), "The search failed.");
        assert.equal(describeFailure({ secret: "cookie=1" }), "The search failed.");
        assert.equal(describeFailure(undefined), "The search failed.");
    });
});

describe("Pinterest Tool window: more pages", () => {
    it("asks for the next page with the cursor, without the randomize flag, and adds without repeats", async () => {
        const { session, asked } = make([async () => page(["a", "b"], ["c1"]), async () => page(["b", "c"], ["c2"])], undefined, true);
        await session.search("x");
        await session.loadMore();
        assert.deepEqual(asked[1], { query: "x", mediaFilter: "ALL", target: "AVATAR", bookmarks: ["c1"] });
        assert.deepEqual(session.state.results.map(item => item.id), ["a", "b", "c"]);
        assert.equal(session.state.hasMore, true);
        assert.equal(session.state.status, "idle");
    });

    it("stops offering more when a page brings nothing new", async () => {
        const { session } = make([async () => page(["a"], ["c1"]), async () => page(["a"], ["c2"])]);
        await session.search("x");
        await session.loadMore();
        assert.equal(session.state.hasMore, false);
    });

    it("stops offering more when a next page fills the list to its limit", async () => {
        const full = Array.from({ length: WINDOW_LIMITS.maxResults }, (_, i) => `p${i}`);
        const { session } = make([async () => page(["a"], ["c1"]), async () => page(full, ["c2"])]);
        await session.search("x");
        await session.loadMore();
        assert.equal(session.state.hasMore, false);
    });

    it("stops offering more at the end of the cursors", async () => {
        const { session } = make([async () => page(["a"], ["c1"]), async () => page(["b"], null)]);
        await session.search("x");
        await session.loadMore();
        assert.equal(session.state.hasMore, false);
    });

    it("does not ask twice at the same time, nor before a search, nor without a next page", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session, asked } = make([async () => page(["a"], ["c1"]), () => slow.promise]);
        await session.loadMore();
        assert.equal(asked.length, 0, "before any search");
        await session.search("x");
        const first = session.loadMore();
        assert.equal(session.state.status, "loading-more");
        await session.loadMore();
        assert.equal(asked.length, 2, "the second click was ignored");
        slow.resolve(page(["b"], null));
        await first;
        await session.loadMore();
        assert.equal(asked.length, 2, "no next page");
    });

    it("does not ask for more while the first page is still loading", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session, asked } = make([() => slow.promise]);
        const first = session.search("x");
        await session.loadMore();
        assert.equal(asked.length, 1);
        slow.resolve(page(["a"], null));
        await first;
    });

    it("drops a next page that arrives after a new search began", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session } = make([async () => page(["a"], ["c1"]), () => slow.promise, async () => page(["z"], null)]);
        await session.search("old");
        const more = session.loadMore();
        await session.search("new");
        slow.resolve(page(["late"], ["c9"]));
        await more;
        assert.deepEqual(session.state.results.map(item => item.id), ["z"]);
        assert.equal(session.state.hasMore, false);
    });

    it("drops a next page that failed after a new search began", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session } = make([async () => page(["a"], ["c1"]), () => slow.promise, async () => page(["z"], null)]);
        await session.search("old");
        const more = session.loadMore();
        await session.search("new");
        slow.reject(new Error("late"));
        await more;
        assert.equal(session.state.status, "idle");
        assert.equal(session.state.error, null);
    });
});

describe("Pinterest Tool window: kind and filter", () => {
    it("changing the kind repeats the search from page 1, with the new target", async () => {
        const { session, asked } = make([async () => page(["a"], ["c"]), async () => page(["b"], null)]);
        await session.search("x");
        session.setKind("BANNER");
        await now();
        assert.deepEqual(asked[1], { query: "x", mediaFilter: "ALL", target: "BANNER", randomize: false });
        assert.equal(session.state.kind, "BANNER");
        assert.deepEqual(session.state.results.map(item => item.id), ["b"]);
    });

    it("changing the filter repeats the search with the new filter", async () => {
        const { session, asked } = make([async () => page(["a"], null), async () => page(["g"], null)]);
        await session.search("x");
        session.setFilter("GIFS");
        await now();
        assert.equal(asked[1].mediaFilter, "GIFS");
    });

    it("before any search only the choice is kept, and the same choice does nothing", async () => {
        const { session, asked } = make([]);
        session.setKind("IMAGE");
        session.setFilter("STATIC");
        assert.equal(session.state.kind, "IMAGE");
        assert.equal(session.state.filter, "STATIC");
        session.setKind("IMAGE");
        session.setFilter("STATIC");
        await now();
        assert.equal(asked.length, 0);
    });

    it("the same choice after a search does not search again", async () => {
        const { session, asked } = make([async () => page(["a"], null)]);
        await session.search("x");
        session.setKind("AVATAR");
        session.setFilter("ALL");
        await now();
        assert.equal(asked.length, 1);
    });

    it("saveKinds says where a heart may save", () => {
        assert.deepEqual(saveKinds("AVATAR"), ["AVATAR"]);
        assert.deepEqual(saveKinds("BANNER"), ["BANNER"]);
        assert.deepEqual(saveKinds("IMAGE"), ["AVATAR", "BANNER"]);
    });
});

describe("Pinterest Tool window: favourites", () => {
    it("loads what is saved and the recent searches", async () => {
        const { session } = make([], { AVATAR: ["a1", "a2"], BANNER: ["b1"], recent: ["cats"] });
        await session.init();
        assert.deepEqual([...session.state.saved.AVATAR], ["a1", "a2"]);
        assert.deepEqual([...session.state.saved.BANNER], ["b1"]);
        assert.deepEqual(session.state.favourites.map(item => item.id), ["a1", "a2"]);
        assert.deepEqual(session.state.recent, ["cats"]);
    });

    it("switches the favourites list between icons and banners", async () => {
        const { session } = make([], { AVATAR: ["a1"], BANNER: ["b1"] });
        await session.init();
        await session.setFavouriteKind("BANNER");
        assert.equal(session.state.favouriteKind, "BANNER");
        assert.deepEqual(session.state.favourites.map(item => item.id), ["b1"]);
        await session.setFavouriteKind("BANNER");
        assert.equal(session.state.favouriteKind, "BANNER");
    });

    it("saves a card, tells the person, and marks it as saved", async () => {
        const { session, lib } = make([]);
        await session.toggleFavourite(pin("a"), "AVATAR");
        assert.deepEqual(lib.calls.filter(call => call.startsWith("add")), ["add:AVATAR:a"]);
        assert.equal(session.state.notice, "Saved to your favourites");
        assert.equal(session.state.saved.AVATAR.has("a"), true);
        assert.equal(session.state.saved.BANNER.has("a"), false);
        assert.deepEqual(session.state.favourites.map(item => item.id), ["a"]);
    });

    it("takes a saved card out when its heart is pressed again", async () => {
        const { session, lib } = make([], { AVATAR: ["a"] });
        await session.init();
        await session.toggleFavourite(pin("a"), "AVATAR");
        assert.deepEqual(lib.calls.filter(call => call.startsWith("remove")), ["remove:AVATAR:a"]);
        assert.equal(session.state.notice, "Removed from your favourites");
        assert.equal(session.state.saved.AVATAR.has("a"), false);
        assert.deepEqual(session.state.favourites, []);
    });

    it("saves under the kind of the heart, and a card can be in both kinds", async () => {
        const { session } = make([]);
        await session.toggleFavourite(pin("a"), "AVATAR");
        await session.toggleFavourite(pin("a"), "BANNER");
        assert.equal(session.state.saved.AVATAR.has("a"), true);
        assert.equal(session.state.saved.BANNER.has("a"), true);
        await session.toggleFavourite(pin("a"), "BANNER");
        assert.equal(session.state.saved.AVATAR.has("a"), true);
        assert.equal(session.state.saved.BANNER.has("a"), false);
    });

    it("tells the person when the kind is full or the card was already there", async () => {
        const { session, lib } = make([]);
        lib.setAdd("full");
        await session.toggleFavourite(pin("a"), "AVATAR");
        assert.equal(session.state.notice, "Your favourites of that kind are full, remove one first");
        lib.setAdd("exists");
        await session.toggleFavourite(pin("a"), "AVATAR");
        assert.equal(session.state.notice, "Already in your favourites");
    });

    it("tells the person, with a plain message, when saving fails, and keeps going", async () => {
        const { session, lib } = make([], { AVATAR: ["x"] });
        lib.failOn("add");
        await session.toggleFavourite(pin("a"), "AVATAR");
        assert.equal(session.state.notice, "add broke");
        assert.equal(session.state.status, "idle");
    });

    it("tells the person when removing fails", async () => {
        const { session, lib } = make([], { AVATAR: ["a"] });
        await session.init();
        lib.failOn("remove");
        await session.toggleFavourite(pin("a"), "AVATAR");
        assert.equal(session.state.notice, "remove broke");
        assert.equal(session.state.saved.AVATAR.has("a"), true);
    });

    it("still opens when the library cannot be read", async () => {
        const { session, lib } = make([]);
        lib.failOn("favourites");
        await session.init();
        assert.deepEqual(session.state.favourites, []);
        lib.failOn("recent");
        await session.init();
        assert.deepEqual(session.state.recent, []);
    });

    it("clears the recent searches, and keeps the list if clearing fails", async () => {
        const { session, lib } = make([], { recent: ["a", "b"] });
        await session.init();
        lib.failOn("clearRecent");
        await session.clearRecent();
        assert.deepEqual(session.state.recent, ["a", "b"]);
        lib.failOn(undefined);
        await session.clearRecent();
        assert.deepEqual(session.state.recent, []);
    });

    it("changing the tab clears the notice", async () => {
        const { session } = make([]);
        await session.toggleFavourite(pin("a"), "AVATAR");
        session.setTab("favourites");
        assert.equal(session.state.tab, "favourites");
        assert.equal(session.state.notice, null);
    });
});

describe("Pinterest Tool window: listening and closing", () => {
    it("tells listeners at every change and stops when one unsubscribes", async () => {
        const { session } = make([async () => page(["a"], null)]);
        let heard = 0;
        const stop = session.subscribe(() => { heard++; });
        session.setTab("favourites");
        assert.equal(heard, 1);
        stop();
        session.setTab("search");
        assert.equal(heard, 1);
    });

    it("a listener that throws does not stop the others", () => {
        const { session } = make([]);
        let heard = 0;
        session.subscribe(() => { throw new Error("bad screen"); });
        session.subscribe(() => { heard++; });
        session.setTab("favourites");
        assert.equal(heard, 1);
    });

    it("after close, late answers change nothing and nobody is told", async () => {
        const slow = later<PinterestSearchPayload>();
        const { session } = make([() => slow.promise]);
        let heard = 0;
        session.subscribe(() => { heard++; });
        const pending = session.search("x");
        const beforeClose = heard;
        session.close();
        slow.resolve(page(["a"], null));
        await pending;
        assert.equal(heard, beforeClose);
        assert.deepEqual(session.state.results, []);
        session.setTab("favourites");
        assert.equal(session.state.tab, "search");
    });
});
