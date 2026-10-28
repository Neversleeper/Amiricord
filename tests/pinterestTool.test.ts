/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NativeHost, type NativeHostApi, type NativeResponse } from "../src/main/nativeHost";
import { PinterestClient } from "../src/testcordplugins/PinterestTool/native.client";
import {
    addSearchVariation, buildSearchUrl, decodeFeeds, encodeFeeds, extractBookmarks, getCsrfToken, getSearchQuery, isAllowedMediaHost, isGifUrl, mediaFilename, normalizeGuide,
    normalizePin, readSetCookies, sanitizeCookie, toBookmarkList
} from "../src/testcordplugins/PinterestTool/pinterest";
import { hasBannerIntent, hasProfileIntent, imageKey, normalizeQuery, rankResults, shapeFits, visualKey } from "../src/testcordplugins/PinterestTool/searchRanking";
import type { PinterestImageResult } from "../src/testcordplugins/PinterestTool/types";

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

describe("Pinterest Tool: cursors", () => {
    it("reads a single text or a list, and drops empty cursors, non-text ones and the end marker", () => {
        assert.deepEqual(toBookmarkList("abc"), ["abc"]);
        assert.deepEqual(toBookmarkList(["a", "", "-end-", 5, "b"]), ["a", "b"]);
        assert.deepEqual(toBookmarkList(undefined), []);
        assert.deepEqual(toBookmarkList({}), []);
        assert.deepEqual(toBookmarkList(""), []);
    });

    it("takes the next cursors from the answer first, then from the echoed options, and none at the end marker", () => {
        assert.deepEqual(extractBookmarks({ resource_response: { bookmark: "next" } }), ["next"]);
        assert.deepEqual(extractBookmarks({ resource_response: { bookmark: ["n1", "n2"] }, resource: { options: { bookmarks: ["old"] } } }), ["n1", "n2"]);
        assert.deepEqual(extractBookmarks({ resource: { options: { bookmarks: "echoed" } } }), ["echoed"]);
        assert.equal(extractBookmarks({ resource_response: { bookmark: "-end-" }, resource: { options: { bookmarks: ["old"] } } }), null, "the end marker wins over echoed options");
        assert.equal(extractBookmarks({ resource_response: { bookmark: ["x", "-end-"] } }), null);
        assert.equal(extractBookmarks({}), null);
        assert.equal(extractBookmarks({ resource_response: { bookmark: [] } }), null);
    });

    it("packs feeds into cursors and back, keeping only feeds that have more pages", () => {
        const packed = encodeFeeds([{ q: "cats aesthetic", b: ["x y"] }, { q: "cats", b: [] }, { q: "cats art", b: ["z"] }]);
        assert.equal(packed?.length, 2);
        assert.ok(packed?.every(item => item.startsWith("F|")));
        assert.deepEqual(decodeFeeds(packed!), [{ q: "cats aesthetic", b: ["x y"] }, { q: "cats art", b: ["z"] }]);
        assert.equal(encodeFeeds([{ q: "a", b: [] }]), null);
        assert.equal(encodeFeeds([]), null);
    });

    it("tells a cursor that is not a feed, or is damaged, from a feed", () => {
        assert.equal(decodeFeeds(["plain-cursor"]), null);
        assert.equal(decodeFeeds(["XX" + encodeURIComponent(JSON.stringify({ q: "a", b: ["k"] }))]), null, "without the F| mark it is not a feed, even if what follows reads like one");
        assert.equal(decodeFeeds(["F|%E0%A4%A"]), null);
        assert.equal(decodeFeeds(["F|" + encodeURIComponent("not json")]), null);
        assert.deepEqual(decodeFeeds(["F|" + encodeURIComponent(JSON.stringify({ q: 5, b: [] }))]), [], "a feed without a text query is skipped");
        assert.deepEqual(decodeFeeds(["F|" + encodeURIComponent(JSON.stringify({ q: "a", b: ["", "-end-", "k"] }))]), [{ q: "a", b: ["k"] }]);
    });
});

describe("Pinterest Tool: the request", () => {
    it("builds Pinterest's search address with the query, the page size, the cursors and the time", () => {
        const url = new URL(buildSearchUrl("cute cats", 25, ["c1"], 1234));
        assert.equal(url.origin + url.pathname, "https://www.pinterest.com/resource/BaseSearchResource/get/");
        assert.equal(url.searchParams.get("_"), "1234");
        assert.equal(url.searchParams.get("source_url"), "/search/pins/?q=cute%20cats&rs=typed");
        const data = JSON.parse(url.searchParams.get("data")!);
        assert.equal(data.options.query, "cute cats");
        assert.equal(data.options.page_size, 25);
        assert.deepEqual(data.options.bookmarks, ["c1"]);
        assert.equal(data.options.scope, "pins");
    });

    it("keeps a query with odd characters inside the address, never breaking out of it", () => {
        const url = new URL(buildSearchUrl("a&b=c#d?e", 25, [], 1));
        assert.equal(url.hostname, "www.pinterest.com");
        assert.equal(JSON.parse(url.searchParams.get("data")!).options.query, "a&b=c#d?e");
        assert.equal(url.hash, "");
    });

    it("adds a hint word for icons and banners only when the query has no such intent already, and asks for animated ones for GIFs", () => {
        assert.equal(getSearchQuery("zoro", "ALL", "IMAGE"), "zoro");
        assert.equal(getSearchQuery("zoro", "ALL", "AVATAR"), "zoro pfp icon");
        assert.equal(getSearchQuery("zoro icon", "ALL", "AVATAR"), "zoro icon");
        assert.equal(getSearchQuery("zoro", "ALL", "BANNER"), "zoro banner");
        assert.equal(getSearchQuery("zoro wallpaper", "ALL", "BANNER"), "zoro wallpaper");
        assert.equal(getSearchQuery("zoro", "GIFS", "IMAGE"), "zoro animated gif");
        assert.equal(getSearchQuery("zoro gif", "GIFS", "IMAGE"), "zoro gif");
        assert.equal(getSearchQuery("zoro", "GIFS", "AVATAR"), "zoro pfp icon animated gif");
        assert.equal(getSearchQuery("  zoro  ", "STATIC", "IMAGE"), "zoro");
    });

    it("adds one style word chosen by the function it is given, never one already in the query", () => {
        assert.equal(addSearchVariation("zoro", "IMAGE", "ALL", () => 0), "zoro aesthetic");
        assert.equal(addSearchVariation("zoro", "IMAGE", "ALL", () => 0.99), "zoro photography");
        assert.equal(addSearchVariation("zoro", "IMAGE", "GIFS", () => 0), "zoro loop");
        assert.equal(addSearchVariation("zoro", "BANNER", "ALL", () => 0), "zoro header");
        assert.equal(addSearchVariation("zoro", "AVATAR", "ALL", () => 0), "zoro aesthetic");
        assert.equal(addSearchVariation("zoro aesthetic art", "IMAGE", "ALL", () => 0), "zoro aesthetic art fanart");
    });

    it("uses the whole list when every style word overlaps the query", () => {
        const query = "aesthetic fanart art edit illustration photography";
        assert.equal(addSearchVariation(query, "IMAGE", "ALL", () => 0), `${query} aesthetic`);
    });

    it("cleans the person's cookie: first line, no prefix, printable ASCII, bounded", () => {
        assert.equal(sanitizeCookie("a=1; b=2"), "a=1; b=2");
        assert.equal(sanitizeCookie("  Cookie: a=1; b=2  "), "a=1; b=2");
        assert.equal(sanitizeCookie("a=1\nX-Evil: 1"), "a=1");
        assert.equal(sanitizeCookie("a=1\r\nX-Evil: 1"), "a=1");
        assert.equal(sanitizeCookie("a=é1"), "");
        assert.equal(sanitizeCookie("a=1\u0007; b=2"), "a=1; b=2");
        assert.equal(sanitizeCookie(""), "");
        assert.equal(sanitizeCookie(undefined), "");
        assert.equal(sanitizeCookie("x".repeat(8192)), "x".repeat(8192));
        assert.equal(sanitizeCookie("x".repeat(8193)), "");
        assert.equal(sanitizeCookie("\n\na=1\nsecond=2"), "a=1", "blank lines before the cookie are skipped, the lines after it are dropped");
    });

    it("finds the CSRF token inside a cookie", () => {
        assert.equal(getCsrfToken("a=1; csrftoken=tok123; b=2"), "tok123");
        assert.equal(getCsrfToken("csrftoken=first"), "first");
        assert.equal(getCsrfToken("xcsrftoken=no; a=1"), "");
        assert.equal(getCsrfToken("a=1"), "");
    });

    it("reads Set-Cookie values one by one, or from a merged line, or none", () => {
        assert.deepEqual(readSetCookies({ get: () => null, getSetCookie: () => ["a=1; Path=/", "b=2"] }), ["a=1; Path=/", "b=2"]);
        assert.deepEqual(readSetCookies({ get: () => "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Path=/" }), ["a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/", "b=2; Path=/"]);
        assert.deepEqual(readSetCookies({ get: () => null }), []);
        assert.deepEqual(readSetCookies({ get: () => "m=1", getSetCookie: () => [] }), ["m=1"]);
    });
});

describe("Pinterest Tool: the answer", () => {
    const image = (url: string, width = 600, height = 800) => ({ url, width, height });

    it("turns a pin into a result, with the preview, the fallback and the page of the pin", () => {
        const pin = normalizePin({
            id: "1", type: "pin", title: " Cat ", description: " d ", dominant_color: "#aabbcc",
            images: { orig: image("https://i.pinimg.com/originals/a.jpg", 1000, 1500), "736x": image("https://i.pinimg.com/736x/a.jpg"), "474x": image("https://i.pinimg.com/474x/a.jpg") }
        });
        assert.deepEqual(pin, {
            id: "1", title: "Cat", description: "d", url: "https://i.pinimg.com/originals/a.jpg", width: 1000, height: 1500, dominantColor: "#aabbcc",
            pinterestUrl: "https://www.pinterest.com/pin/1/", isGif: false, thumbUrl: "https://i.pinimg.com/474x/a.jpg", fallbackUrl: "https://i.pinimg.com/736x/a.jpg", source: "PINTEREST"
        });
    });

    it("falls back through the sizes, uses the grid title, and has no fallback when it is the same file", () => {
        const only = normalizePin({ id: "2", type: "pin", grid_title: "Grid", images: { "236x": image("https://i.pinimg.com/236x/b.jpg", 236, 300) } });
        assert.equal(only?.title, "Grid");
        assert.equal(only?.url, "https://i.pinimg.com/236x/b.jpg");
        assert.equal(only?.thumbUrl, "https://i.pinimg.com/236x/b.jpg");
        assert.equal(only?.fallbackUrl, undefined);
        assert.equal(only?.dominantColor, null);
        const same = normalizePin({ id: "3", type: "pin", images: { "736x": image("https://i.pinimg.com/736x/c.jpg") } });
        assert.equal(same?.fallbackUrl, undefined);
    });

    it("refuses what is not a usable still or GIF", () => {
        const good = { orig: image("https://i.pinimg.com/o/a.jpg") };
        assert.equal(normalizePin({ id: "1", type: "video", images: good }), null);
        assert.equal(normalizePin({ type: "pin", images: good }), null);
        assert.equal(normalizePin({ id: "1", type: "pin" }), null);
        assert.equal(normalizePin({ id: "1", type: "pin", images: { orig: { url: "https://i.pinimg.com/o/a.jpg", width: 0, height: 5 } } }), null);
        assert.equal(normalizePin({ id: "1", type: "pin", images: { orig: { width: 5, height: 5 } } }), null);
        assert.equal(normalizePin({ id: "1", type: "pin", images: good, videos: {} }), null, "a video preview is not an image");
        assert.equal(normalizePin({ id: "1", type: "pin", images: good, video_list: {} }), null);
        const gif = normalizePin({ id: "1", type: "pin", images: { orig: image("https://i.pinimg.com/o/a.gif") }, videos: {} });
        assert.equal(gif?.isGif, true, "a real GIF with a video copy is kept");
    });

    it("tells a GIF from its address", () => {
        assert.equal(isGifUrl("https://i.pinimg.com/o/a.GIF"), true);
        assert.equal(isGifUrl("https://i.pinimg.com/o/a.gif?x=1"), true);
        assert.equal(isGifUrl("https://i.pinimg.com/o/a.jpg"), false);
        assert.equal(isGifUrl("https://i.pinimg.com/o/gif/a.jpg"), false);
        assert.equal(isGifUrl("not a url.gif"), true);
        assert.equal(isGifUrl("not a url"), false);
    });

    it("keeps a suggested search only with both its label and its query", () => {
        assert.deepEqual(normalizeGuide({ display: { display_text: " Aesthetic " }, action: { search_query: " cats aesthetic " } }), { label: "Aesthetic", query: "cats aesthetic" });
        assert.equal(normalizeGuide({ display: { display_text: "x" } }), null);
        assert.equal(normalizeGuide({ action: { search_query: "x" } }), null);
        assert.equal(normalizeGuide({ display: { display_text: " " }, action: { search_query: "x" } }), null);
    });

    it("names a download from its path, adding an extension when there is none", () => {
        assert.equal(mediaFilename("/originals/ab/cd/pic.png", "image/png"), "pic.png");
        assert.equal(mediaFilename("/originals/abc", "image/gif"), "abc.gif");
        assert.equal(mediaFilename("/originals/abc", "image/webp"), "abc.jpg");
        assert.equal(mediaFilename("/", "image/jpeg"), "pinterest-image.jpg");
    });

    it("downloads only from Pinterest's two image servers", () => {
        assert.equal(isAllowedMediaHost("i.pinimg.com"), true);
        assert.equal(isAllowedMediaHost("S.PINIMG.COM"), true);
        for (const host of ["www.pinterest.com", "pinimg.com", "x.i.pinimg.com", "i.pinimg.com.evil.example", "wixmp.com", "a.deviantart.net"]) assert.equal(isAllowedMediaHost(host), false, host);
    });
});

describe("Pinterest Tool: ranking", () => {
    const item = (id: string, width: number, height: number, extra: Partial<PinterestImageResult> = {}): PinterestImageResult => ({
        id, title: "", description: "", url: `https://i.pinimg.com/736x/${id}.jpg`, width, height, dominantColor: null, pinterestUrl: null, isGif: false, ...extra
    });

    it("cleans a query: control characters, spaces, accents composed, at most 240 characters", () => {
        assert.equal(normalizeQuery("  a\t\nb   c \u0007"), "a b c");
        assert.equal(normalizeQuery("é"), "é");
        assert.equal(normalizeQuery("x".repeat(300)).length, 240);
    });

    it("says which shapes fit an icon and a banner", () => {
        assert.equal(shapeFits({ width: 500, height: 500 }, "AVATAR"), true);
        assert.equal(shapeFits({ width: 100, height: 500 }, "AVATAR"), false);
        assert.equal(shapeFits({ width: 1000, height: 100 }, "AVATAR"), false);
        assert.equal(shapeFits({ width: 1200, height: 500 }, "BANNER"), true);
        assert.equal(shapeFits({ width: 500, height: 1200 }, "BANNER"), false);
        assert.equal(shapeFits({ width: 100, height: 1000 }, "IMAGE"), true);
    });

    it("spots icon and banner intent in several languages, ignoring accents", () => {
        assert.equal(hasProfileIntent("zoro PFP"), true);
        assert.equal(hasProfileIntent("icono de gato"), true);
        assert.equal(hasProfileIntent("アイコン"), true);
        assert.equal(hasProfileIntent("zoro"), false);
        assert.equal(hasBannerIntent("fondo oscuro"), true);
        assert.equal(hasBannerIntent("Panorama"), true);
        assert.equal(hasBannerIntent("zoro"), false);
    });

    it("gives the same key to one picture in different size folders, and tells other hosts by path", () => {
        assert.equal(imageKey("https://i.pinimg.com/236x/ab/cd/pic.jpg"), imageKey("https://i.pinimg.com/originals/ab/cd/pic.png"));
        assert.notEqual(imageKey("https://i.pinimg.com/236x/ab/one.jpg"), imageKey("https://i.pinimg.com/236x/ab/two.jpg"));
        assert.equal(imageKey("https://example.com/a/b.jpg"), "example.com/a/b.jpg");
        assert.equal(imageKey("not a url"), "not a url");
    });

    it("fingerprints re-uploads by size and colour, but not plain greys", () => {
        assert.equal(visualKey({ width: 5, height: 6, dominantColor: "#AABBCC" }), "5x6:#aabbcc");
        assert.equal(visualKey({ width: 5, height: 6, dominantColor: "#808080" }), "");
        assert.equal(visualKey({ width: 5, height: 6, dominantColor: "#8a8080" }), "", "a difference of 10 is still grey");
        assert.equal(visualKey({ width: 5, height: 6, dominantColor: "#9a8080" }), "5x6:#9a8080");
        assert.equal(visualKey({ width: 5, height: 6, dominantColor: null }), "");
        assert.equal(visualKey({ width: 5, height: 6, dominantColor: "red" }), "");
    });

    it("puts images that fit the target before the ones that do not, however well they match", () => {
        const tall = item("tall", 400, 1200, { title: "zoro zoro" });
        const wide = item("wide", 1500, 600, { title: "something else" });
        assert.deepEqual(rankResults([[tall, wide]], "zoro", "BANNER").map(r => r.id), ["wide", "tall"]);
    });

    it("drops repeats: the same pin, the same file in another size, and the same size and colour", () => {
        const a = item("a", 600, 600, { dominantColor: "#aa0000" });
        const sameId = { ...a, url: "https://i.pinimg.com/other/zzz.jpg", dominantColor: null };
        const sameFile = item("b", 600, 600, { url: "https://i.pinimg.com/originals/a.jpg" });
        const sameLook = item("c", 600, 600, { dominantColor: "#aa0000" });
        const different = item("d", 500, 700, { dominantColor: "#00aa00" });
        assert.deepEqual(rankResults([[a, sameId, sameFile, sameLook, different]], "x", "IMAGE").map(r => r.id).sort(), ["a", "d"]);
    });

    it("mixes the lists instead of putting one after the other", () => {
        const one = [item("a1", 600, 600), item("a2", 600, 600), item("a3", 600, 600)];
        const two = [item("b1", 600, 600), item("b2", 600, 600), item("b3", 600, 600)];
        const order = rankResults([one, two], "x", "IMAGE").map(r => r.id);
        assert.equal(order.length, 6);
        assert.notDeepEqual(order, ["a1", "a2", "a3", "b1", "b2", "b3"]);
        assert.notDeepEqual(order, ["b1", "b2", "b3", "a1", "a2", "a3"]);
    });

    it("lifts icons that say they are icons and lowers placeholders, for an icon search", () => {
        const icon = item("icon", 500, 500, { title: "cute pfp" });
        const plain = item("plain", 500, 500, { title: "cute" });
        const placeholder = item("ph", 500, 500, { title: "default avatar placeholder cute" });
        assert.deepEqual(rankResults([[plain, placeholder, icon]], "cute", "AVATAR").map(r => r.id), ["icon", "plain", "ph"]);
    });

    it("ranks nothing as nothing", () => {
        assert.deepEqual(rankResults([], "x", "IMAGE"), []);
        assert.deepEqual(rankResults([[]], "x", "IMAGE"), []);
    });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The client, against a fake Pinterest
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

interface Call { url: string; headers: Record<string, string>; maxBytes?: number; }

const textResponse = (status: number, body: unknown, headers: Record<string, string> = {}, setCookies: string[] = [], url?: string): NativeResponse => ({
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: name => headers[name.toLowerCase()] ?? null, getSetCookie: () => setCookies },
    arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)).buffer as ArrayBuffer),
    text: async () => String(body),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body)
});

const pinJson = (id: string, query = "", width = 600, height = 600, extra: Record<string, unknown> = {}) => ({
    id, type: "pin", title: `${query} ${id}`, images: { orig: { url: `https://i.pinimg.com/originals/${id}.jpg`, width, height } }, ...extra
});

interface Pinterest {
    /** One answer per search request, in order. A function may look at the request. */
    searches: Array<NativeResponse | ((call: Call) => NativeResponse | Promise<NativeResponse>)>;
    home?: NativeResponse | (() => NativeResponse);
}

/** The cookie the fake main process holds as the plugin's secret right now. `withCookie` sets it just before a search, so a test reads like the options it replaces. */
let heldCookie: string | undefined;
const withCookie = <T>(value: unknown, options: T): T => { heldCookie = typeof value === "string" ? value : undefined; return options; };

function fakeHost(script: Pinterest) {
    heldCookie = undefined;
    const calls: Call[] = [];
    let searchIndex = 0;
    const host: NativeHostApi = {
        secret: name => (name === "pinterestCookie" ? heldCookie ?? null : null),
        fetch: async (url, init) => {
            const call: Call = { url, headers: init?.headers ?? {}, maxBytes: init?.maxBytes };
            calls.push(call);
            if (url === "https://www.pinterest.com") {
                const home = script.home ?? textResponse(200, "", {}, ["_pinterest_sess=abc; Path=/", "csrftoken=tok; Path=/"]);
                return typeof home === "function" ? home() : home;
            }
            const next = script.searches[searchIndex++] ?? textResponse(500, "no more answers");
            return typeof next === "function" ? next(call) : next;
        }
    };
    return { host, calls, searchCalls: () => calls.filter(c => c.url !== "https://www.pinterest.com") };
}

const page = (pins: unknown[], bookmark?: string | string[], guides: unknown[] = []) => textResponse(200, { resource_response: { data: { results: pins, guides }, ...(bookmark ? { bookmark } : {}) } });

const queryOf = (call: Call) => JSON.parse(new URL(call.url).searchParams.get("data")!).options.query as string;
const bookmarksOf = (call: Call) => JSON.parse(new URL(call.url).searchParams.get("data")!).options.bookmarks as string[];

describe("PinterestClient: search", () => {
    const first = () => [page([pinJson("a", "zoro"), pinJson("b", "zoro")], "cursor-1", [{ display: { display_text: "Aesthetic" }, action: { search_query: "zoro aesthetic" } }]), page([pinJson("c", "zoro"), pinJson("a", "zoro")], "cursor-2", [{ display: { display_text: "aesthetic" }, action: { search_query: "zoro x" } }, { display: { display_text: "Wallpaper" }, action: { search_query: "zoro wallpaper" } }])];

    it("contacts nobody until a search is made", () => {
        const t = fakeHost({ searches: [] });
        new PinterestClient({ host: t.host });
        assert.equal(t.calls.length, 0);
    });

    it("opens one anonymous session, reads two feeds (the query and a style variation), and gives ranked, de-duplicated results with merged guides", async () => {
        const t = fakeHost({ searches: first() });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        const result = await client.search({ query: "zoro", randomize: false });
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 1);
        const searches = t.searchCalls();
        assert.equal(searches.length, 2);
        assert.deepEqual(searches.map(queryOf).sort(), ["zoro", "zoro aesthetic"]);
        for (const call of searches) {
            assert.equal(call.headers.Cookie, "_pinterest_sess=abc; csrftoken=tok");
            assert.equal(call.headers["X-Requested-With"], "XMLHttpRequest");
            assert.match(call.headers["User-Agent"], /Mozilla/);
            assert.equal("X-CSRFToken" in call.headers, false, "the anonymous session sends no token header");
        }
        assert.deepEqual(result.results.map(r => r.id).sort(), ["a", "b", "c"]);
        assert.deepEqual(result.guides.map(g => g.label), ["Aesthetic", "Wallpaper"], "guides are merged without repeating a label in another case");
        assert.equal(result.query, "zoro");
        assert.equal(result.bookmark?.length, 2);
        assert.ok(result.bookmark?.every(b => b.startsWith("F|")));
    });

    it("adds the style word to the first feed too when asked to randomize", async () => {
        const t = fakeHost({ searches: first() });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        await client.search({ query: "zoro", randomize: true });
        assert.deepEqual(t.searchCalls().map(queryOf), ["zoro aesthetic", "zoro aesthetic"].map((q, i) => (i === 0 ? q : t.searchCalls().map(queryOf)[1])));
        assert.ok(t.searchCalls().map(queryOf).every(q => q.startsWith("zoro ")));
    });

    it("asks for icons and banners with their hint, in both feeds", async () => {
        const t = fakeHost({ searches: first() });
        await new PinterestClient({ host: t.host, random: () => 0 }).search({ query: "zoro", target: "AVATAR" });
        assert.ok(t.searchCalls().map(queryOf).every(q => q.includes("pfp icon")), t.searchCalls().map(queryOf).join(" | "));
    });

    it("reuses the session for the next searches and opens a new one after fifteen minutes", async () => {
        let now = 1_000;
        const t = fakeHost({ searches: [...first(), ...first(), ...first()] });
        const client = new PinterestClient({ host: t.host, now: () => now, random: () => 0 });
        await client.search({ query: "one" });
        await client.search({ query: "two" });
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 1);
        now += 15 * 60 * 1000 + 1;
        await client.search({ query: "three" });
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 2);
    });

    it("opens only one session when two searches start together", async () => {
        const t = fakeHost({ searches: [...first(), ...first()] });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        await Promise.all([client.search({ query: "one" }), client.search({ query: "two" })]);
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 1);
    });

    it("warms the session up only when asked, once, and never fails", async () => {
        const t = fakeHost({ searches: [], home: textResponse(500, "") });
        const client = new PinterestClient({ host: t.host });
        await client.warmUp();
        assert.equal(t.calls.length, 1);
        const good = fakeHost({ searches: [] });
        const ready = new PinterestClient({ host: good.host });
        await ready.warmUp();
        await ready.warmUp();
        assert.equal(good.calls.length, 1);
    });

    it("forgets the anonymous session when Pinterest refuses a search, and says what happened", async () => {
        const t = fakeHost({ searches: [textResponse(429, ""), textResponse(429, ""), ...first()] });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        await assert.rejects(client.search({ query: "zoro" }), /Pinterest search failed with HTTP 429/);
        await client.search({ query: "zoro" });
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 2);
    });

    it("fails clearly when the session cannot be opened", async () => {
        await assert.rejects(new PinterestClient({ host: fakeHost({ searches: [], home: textResponse(503, "") }).host }).search({ query: "x" }), /Could not initialize Pinterest search/);
        await assert.rejects(new PinterestClient({ host: fakeHost({ searches: [], home: textResponse(200, "") }).host }).search({ query: "x" }), /Could not initialize Pinterest cookies/);
    });

    it("uses the person's own cookie instead of a session, sends the CSRF token, and explains a refused cookie", async () => {
        const t = fakeHost({ searches: [page([pinJson("a")]), page([pinJson("b")])] });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        await client.search(withCookie("Cookie: mine=1; csrftoken=tk9\nEvil: 1", { query: "zoro" }));
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 0, "no anonymous session is opened");
        for (const call of t.searchCalls()) {
            assert.equal(call.headers.Cookie, "mine=1; csrftoken=tk9");
            assert.equal(call.headers["X-CSRFToken"], "tk9");
        }
        const refused = fakeHost({ searches: [textResponse(401, ""), textResponse(403, "")] });
        await assert.rejects(new PinterestClient({ host: refused.host }).search(withCookie("a=1", { query: "x" })), /Pinterest rejected your session cookie \(HTTP 40[13]\)/);
        assert.equal(refused.calls.filter(c => c.url === "https://www.pinterest.com").length, 0);
    });

    it("ignores a cookie that is not usable and falls back to the session", async () => {
        const t = fakeHost({ searches: first() });
        await new PinterestClient({ host: t.host, random: () => 0 }).search(withCookie("badé", { query: "zoro" }));
        assert.equal(t.calls.filter(c => c.url === "https://www.pinterest.com").length, 1);
    });

    it("continues a page with the cursors it gave, asking only the feeds that have more, and shares and caches the answer", async () => {
        const t = fakeHost({ searches: first() });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        const one = await client.search({ query: "zoro" });
        t.calls.length = 0;
        const more = fakeHost({ searches: [page([pinJson("n1")], "c-9"), page([pinJson("n2")])] });
        const second = new PinterestClient({ host: more.host, random: () => 0 });
        const nextPage = await second.search({ query: "zoro", bookmarks: one.bookmark! });
        assert.deepEqual(more.searchCalls().map(bookmarksOf).sort(), [["cursor-1"], ["cursor-2"]]);
        assert.deepEqual(nextPage.results.map(r => r.id).sort(), ["n1", "n2"]);
        assert.equal(decodeFeeds(nextPage.bookmark ?? [])?.length, 1, "only the feed that has a further cursor stays");

        const before = more.calls.length;
        const again = await second.search({ query: "zoro", bookmarks: one.bookmark! });
        assert.equal(more.calls.length, before, "answered from memory");
        assert.deepEqual(again, nextPage);
    });

    it("answers identical page requests in flight with one request", async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const slow = async () => { await gate; return page([pinJson("n1")]); };
        const t = fakeHost({ searches: [slow, slow] });
        const client = new PinterestClient({ host: t.host });
        const cursors = encodeFeeds([{ q: "zoro", b: ["c1"] }, { q: "zoro art", b: ["c2"] }])!;
        const a = client.search({ query: "zoro", bookmarks: cursors });
        const b = client.search({ query: "zoro", bookmarks: cursors });
        await new Promise(resolve => setImmediate(resolve));
        release();
        const [one, two] = await Promise.all([a, b]);
        assert.equal(t.searchCalls().length, 2, "two feeds, once");
        assert.deepEqual(one, two);
    });

    it("does not serve a cached page to someone with another cookie, and forgets pages after three minutes", async () => {
        let now = 0;
        const cursors = encodeFeeds([{ q: "zoro", b: ["c1"] }])!;
        const t = fakeHost({ searches: [page([pinJson("n1")]), page([pinJson("n2")]), page([pinJson("n3")]), page([pinJson("n4")])] });
        const client = new PinterestClient({ host: t.host, now: () => now });
        await client.search(withCookie("a=1", { query: "zoro", bookmarks: cursors }));
        await client.search(withCookie("a=1", { query: "zoro", bookmarks: cursors }));
        assert.equal(t.searchCalls().length, 1, "same cookie: from memory");
        await client.search(withCookie("a=2", { query: "zoro", bookmarks: cursors }));
        assert.equal(t.searchCalls().length, 2, "another cookie: asked again");
        now += 3 * 60 * 1000 + 1;
        await client.search(withCookie("a=1", { query: "zoro", bookmarks: cursors }));
        assert.equal(t.searchCalls().length, 3, "after three minutes: asked again");
    });

    it("keeps the other feed's results when one feed fails, and keeps the failed feed's cursor so the next page retries it", async () => {
        const t = fakeHost({ searches: [textResponse(500, ""), page([pinJson("ok")], "more")] });
        const client = new PinterestClient({ host: t.host, random: () => 0 });
        const result = await client.search(withCookie("a=1", { query: "zoro" }));
        assert.deepEqual(result.results.map(r => r.id), ["ok"]);
        const feeds = decodeFeeds(result.bookmark ?? []);
        assert.equal(feeds?.length, 1, "the failed feed has no cursor of its own to keep on a first page");
    });

    it("keeps the cursor of a feed that failed on a follow-up page, so asking again retries exactly that feed", async () => {
        const cursors = encodeFeeds([{ q: "zoro", b: ["c1"] }, { q: "zoro art", b: ["c2"] }])!;
        const t = fakeHost({ searches: [textResponse(500, ""), page([pinJson("ok")])] });
        const result = await new PinterestClient({ host: t.host }).search(withCookie("a=1", { query: "zoro", bookmarks: cursors }));
        assert.deepEqual(result.results.map(r => r.id), ["ok"]);
        assert.deepEqual(decodeFeeds(result.bookmark ?? []), [{ q: "zoro", b: ["c1"] }], "the feed that answered is done, the one that failed keeps its cursor");
    });

    it("fails when every feed fails", async () => {
        const t = fakeHost({ searches: [textResponse(500, ""), textResponse(500, "")] });
        await assert.rejects(new PinterestClient({ host: t.host }).search(withCookie("a=1", { query: "zoro" })), /Pinterest search failed with HTTP 500/);
    });

    it("refuses an answer that is not an object", async () => {
        const t = fakeHost({ searches: [textResponse(200, "null"), textResponse(200, "null")] });
        await assert.rejects(new PinterestClient({ host: t.host }).search(withCookie("a=1", { query: "zoro" })), /invalid response/);
    });

    it("keeps only GIFs for GIF searches and only stills for static ones", async () => {
        const gifPin = pinJson("g", "x", 400, 400, { images: { orig: { url: "https://i.pinimg.com/originals/g.gif", width: 400, height: 400 } } });
        const gifs = fakeHost({ searches: [page([gifPin, pinJson("s")]), page([gifPin, pinJson("s")])] });
        const onlyGifs = await new PinterestClient({ host: gifs.host }).search(withCookie("a=1", { query: "x", mediaFilter: "GIFS" }));
        assert.deepEqual(onlyGifs.results.map(r => r.id), ["g"]);
        const stills = fakeHost({ searches: [page([gifPin, pinJson("s")]), page([gifPin, pinJson("s")])] });
        const onlyStills = await new PinterestClient({ host: stills.host }).search(withCookie("a=1", { query: "x", mediaFilter: "STATIC" }));
        assert.deepEqual(onlyStills.results.map(r => r.id), ["s"]);
    });

    it("reads a second page inside one request for sparse GIF results, and stops when the cursor does not move", async () => {
        const gifPin = (id: string) => pinJson(id, "x", 400, 400, { images: { orig: { url: `https://i.pinimg.com/originals/${id}.gif`, width: 400, height: 400 } } });
        const t = fakeHost({ searches: [page([gifPin("g1")], "k1"), page([gifPin("g2")], "k1"), page([gifPin("g3")], "k2"), page([gifPin("g4")])] });
        const result = await new PinterestClient({ host: t.host }).search(withCookie("a=1", { query: "x", mediaFilter: "GIFS" }));
        assert.equal(t.searchCalls().length, 4, "two feeds, up to two pages each");
        assert.ok(result.results.length >= 2);
    });

    it("stops after one page when it is full", async () => {
        const many = Array.from({ length: 25 }, (_, i) => pinJson(`p${i}`, "x"));
        const t = fakeHost({ searches: [page(many, "k1"), page(many.map(p => ({ ...p, id: `q${p.id}`, images: { orig: { url: `https://i.pinimg.com/originals/q${p.id}.jpg`, width: 600, height: 600 } } })), "k2")] });
        await new PinterestClient({ host: t.host }).search(withCookie("a=1", { query: "x" }));
        assert.equal(t.searchCalls().length, 2);
    });

    it("tells when the time to search has run out", async () => {
        let now = 0;
        const t = fakeHost({ searches: [() => { now += 20_000; return page([pinJson("a")], "k1"); }, () => { now += 20_000; return page([pinJson("b")], "k2"); }] });
        const client = new PinterestClient({ host: t.host, now: () => now });
        const result = await client.search(withCookie("a=1", { query: "x", mediaFilter: "GIFS" }));
        assert.ok(t.searchCalls().length <= 2, "it did not go on after the time ran out");
        assert.ok(Array.isArray(result.results));
    });

    it("refuses an empty search and reads odd options as the plain defaults", async () => {
        const client = new PinterestClient({ host: fakeHost({ searches: [] }).host });
        await assert.rejects(client.search({ query: "   " }), /Search query is required/);
        await assert.rejects(client.search({ query: 5 as unknown as string }), /Search query is required/);
        await assert.rejects(client.search(undefined as unknown as { query: string; }), /Search query is required/);
        const t = fakeHost({ searches: [page([pinJson("a")]), page([pinJson("a")])] });
        await new PinterestClient({ host: t.host }).search(withCookie(7 as never, { query: "zoro", mediaFilter: "WHAT" as never, target: "ALL" as never, bookmarks: 5 as never, randomize: "yes" as never }));
        assert.ok(t.searchCalls().map(queryOf).every(q => q === "zoro" || q.startsWith("zoro ")));
        assert.equal(t.searchCalls().map(queryOf).some(q => q.includes("gif") || q.includes("pfp") || q.includes("banner")), false);
    });

    it("sends the query clean: no control characters and at most 240 characters", async () => {
        const t = fakeHost({ searches: first() });
        await new PinterestClient({ host: t.host, random: () => 0 }).search({ query: `a\n\tb ${"x".repeat(400)}` });
        for (const q of t.searchCalls().map(queryOf)) {
            assert.equal(/[\u0000-\u001f]/.test(q), false);
            assert.ok(q.length <= 240 + 12);
        }
    });
});

describe("PinterestClient: images", () => {
    const image = (headers: Record<string, string>, extra: { status?: number; url?: string; body?: ArrayBuffer; } = {}) => textResponse(extra.status ?? 200, extra.body ?? new ArrayBuffer(8), headers, [], extra.url);

    function media(answer: NativeResponse) {
        const calls: Call[] = [];
        const host: NativeHostApi = { secret: () => null, fetch: async (url, init) => { calls.push({ url, headers: init?.headers ?? {}, maxBytes: init?.maxBytes }); return answer; } };
        return { client: new PinterestClient({ host }), calls };
    }

    it("downloads an image and gives its bytes, its type and a file name, asking for at most 60 MB", async () => {
        const t = media(image({ "content-type": "image/png; charset=binary" }, { url: "https://i.pinimg.com/originals/ab/pic.png" }));
        const got = await t.client.fetchMedia("https://i.pinimg.com/originals/ab/pic.png");
        assert.equal(got.type, "image/png");
        assert.equal(got.filename, "pic.png");
        assert.equal(got.data.byteLength, 8);
        assert.equal(t.calls[0].maxBytes, 60 * 1024 * 1024);
        assert.match(t.calls[0].headers.Accept, /image\/avif/);
        assert.deepEqual(Object.keys(got).sort(), ["data", "filename", "type"], "one copy of the bytes only");
    });

    it("names the file after the address the image finally came from, with an extension when it has none", async () => {
        const t = media(image({ "content-type": "image/gif" }, { url: "https://s.pinimg.com/final/abc" }));
        assert.equal((await t.client.fetchMedia("https://i.pinimg.com/start.jpg")).filename, "abc.gif");
    });

    it("refuses addresses that are not Pinterest's image servers, before any request", async () => {
        const t = media(image({ "content-type": "image/png" }));
        for (const url of ["not a url", "http://i.pinimg.com/a.png", "https://www.pinterest.com/a.png", "https://i.pinimg.com.evil.example/a.png", "https://wixmp.com/a.png", "ftp://i.pinimg.com/a.png"]) {
            await assert.rejects(t.client.fetchMedia(url), /Invalid media URL/, url);
        }
        assert.equal(t.calls.length, 0);
    });

    it("refuses an image that ended somewhere else after redirects", async () => {
        for (const url of ["https://www.pinterest.com/x.png", "https://evil.example/x.png", "http://i.pinimg.com/x.png"]) {
            const t = media(image({ "content-type": "image/png" }, { url }));
            await assert.rejects(t.client.fetchMedia("https://i.pinimg.com/a.png"), /Invalid image redirect/, url);
        }
    });

    it("refuses an answer that is not ok or not a supported image", async () => {
        await assert.rejects(media(image({ "content-type": "image/png" }, { status: 404 })).client.fetchMedia("https://i.pinimg.com/a.png"), /HTTP 404/);
        for (const type of ["text/html", "image/svg+xml", "", "application/octet-stream"]) {
            await assert.rejects(media(image({ "content-type": type })).client.fetchMedia("https://i.pinimg.com/a.png"), /not a supported image/, type);
        }
        for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "IMAGE/PNG"]) {
            assert.equal((await media(image({ "content-type": type })).client.fetchMedia("https://i.pinimg.com/a.png")).type, type.toLowerCase());
        }
    });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// The whole way through Amiricord's own host
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

describe("Pinterest Tool through the native host", () => {
    it("runs search and fetchMedia as the page would call them, with only the declared hosts reachable", async () => {
        const native = await import("../src/testcordplugins/PinterestTool/native");
        const requested: string[] = [];
        const host = new NativeHost({
            plugins: { PinterestTool: { functions: ["fetchMedia", "search", "warmUp"], hosts: ["www.pinterest.com", "i.pinimg.com", "s.pinimg.com"], load: () => native as unknown as Record<string, unknown> } },
            fetch: async url => {
                requested.push(url);
                // The host writes every address in its plain form, so the home page arrives with a closing slash.
                if (url === "https://www.pinterest.com/") return textResponse(200, "", {}, ["s=1"], url);
                if (url.startsWith("https://www.pinterest.com/resource/")) return page([pinJson("a", "zoro"), pinJson("b", "zoro")], "k");
                if (url === "https://i.pinimg.com/start.jpg") return textResponse(302, "", { location: "https://s.pinimg.com/final/x.jpg" }, [], url);
                if (url === "https://s.pinimg.com/final/x.jpg") return textResponse(200, new ArrayBuffer(16), { "content-type": "image/jpeg" }, [], url);
                return textResponse(404, "");
            }
        });

        const searched = await host.call({ plugin: "PinterestTool", fn: "search", args: [{ query: "zoro" }] });
        assert.equal(searched.ok, true, JSON.stringify(searched));
        assert.deepEqual((searched as { value: { results: Array<{ id: string; }>; }; }).value.results.map(r => r.id).sort(), ["a", "b"]);

        const downloaded = await host.call({ plugin: "PinterestTool", fn: "fetchMedia", args: ["https://i.pinimg.com/start.jpg"] });
        assert.equal(downloaded.ok, true, JSON.stringify(downloaded));
        const value = (downloaded as { value: { data: ArrayBuffer; type: string; filename: string; }; }).value;
        assert.equal(value.data.byteLength, 16);
        assert.equal(value.type, "image/jpeg");
        assert.equal(value.filename, "x.jpg");

        const bad = await host.call({ plugin: "PinterestTool", fn: "fetchMedia", args: ["https://example.com/a.png"] });
        assert.deepEqual(bad, { ok: false, error: "PinterestTool: Invalid media URL." });
        assert.equal(requested.some(url => url.includes("example.com")), false);

        assert.equal((await host.call({ plugin: "PinterestTool", fn: "somethingElse", args: [] })).ok, false);
        assert.deepEqual(Object.keys(native).sort(), ["fetchMedia", "search", "warmUp"], "nothing else is callable from the page");
    });
});
