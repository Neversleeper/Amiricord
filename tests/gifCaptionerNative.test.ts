/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NativeHostApi, NativeResponse } from "../src/main/nativeHost";
import { getLines, inspectMedia, looksLikeGif, looksLikeVideo } from "../src/testcordplugins/GifCaptioner/media";
import * as nativeEntry from "../src/testcordplugins/GifCaptioner/native";
import { createClient, isFamilyName, isMediaHost } from "../src/testcordplugins/GifCaptioner/native.client";
import manifest from "../src/testcordplugins/GifCaptioner/plugin.json";
import { addressesFor, applyTenorMp4Fix, collectCandidateUrls, looksLikeUrl, normalizeUrl, orderCandidateUrls, scoreUrl } from "../src/testcordplugins/GifCaptioner/urls";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

function response(options: { ok?: boolean; url?: string; type?: string; data?: ArrayBuffer; text?: string; }): NativeResponse {
    return {
        status: options.ok === false ? 404 : 200,
        ok: options.ok !== false,
        url: options.url,
        headers: { get: (name: string) => (name === "content-type" ? options.type ?? null : null) },
        arrayBuffer: async () => options.data ?? new ArrayBuffer(0),
        text: async () => options.text ?? "",
        json: async () => ({})
    } as NativeResponse;
}

function fakeHost(answer: (url: string, init: { method?: string; body?: string; maxBytes?: number; } | undefined) => NativeResponse | Promise<NativeResponse>) {
    const calls: Array<{ url: string; init?: { method?: string; body?: string; maxBytes?: number; headers?: Record<string, string>; }; }> = [];
    const host: NativeHostApi = {
        fetch: async (url, init) => { calls.push({ url, init }); return answer(url, init); },
        secret: () => null
    };
    return { host, calls };
}

describe("GifCaptioner main process: which hosts", () => {
    it("accepts Discord's, Tenor's and Klipy's servers and their subdomains, and nothing that only looks like them", () => {
        for (const host of ["cdn.discordapp.com", "media.discordapp.net", "images-ext-1.discordapp.net", "media.tenor.com", "tenor.com", "c.klipy.com", "MEDIA.TENOR.COM"]) assert.equal(isMediaHost(host), true, host);
        for (const host of ["evildiscordapp.com", "discordapp.com.evil.example", "tenor.com.evil.example", "nottenor.com", "giphy.com", "example.com", ""]) assert.equal(isMediaHost(host), false, host);
    });

    it("accepts a font family name that is safe to put in an address and in CSS", () => {
        for (const name of ["Roboto", "Open Sans", "Press Start 2P", "Noto-Sans_JP", "Alfa Slab One's"]) assert.equal(isFamilyName(name), true, name);
        for (const name of ["", "x".repeat(101), "a;b", "a/b", "a<b>", "a\"b", 5, null, undefined]) assert.equal(isFamilyName(name), false, String(name));
        assert.equal(isFamilyName("x".repeat(100)), true);
    });
});

describe("GifCaptioner main process: the download", () => {
    it("downloads a picture from a listed host with a size limit, and gives its bytes and type", async () => {
        const world = fakeHost(() => response({ type: "image/gif", data: bytes(1, 2, 3) }));
        const result = await createClient(world.host).fetchMedia("https://media.tenor.com/a/b.gif");
        assert.deepEqual(result && [...new Uint8Array(result.data)], [1, 2, 3]);
        assert.equal(result?.contentType, "image/gif");
        assert.deepEqual(world.calls.map(call => [call.url, call.init?.maxBytes]), [["https://media.tenor.com/a/b.gif", 25 * 1024 * 1024]]);
    });

    it("reads an address that starts with two slashes as https", async () => {
        const world = fakeHost(() => response({ data: bytes(1) }));
        assert.notEqual(await createClient(world.host).fetchMedia("//cdn.discordapp.com/x.gif"), null);
        assert.equal(world.calls[0].url, "https://cdn.discordapp.com/x.gif");
    });

    it("gives nothing, and asks nobody, for an address that is not https, not listed, not text or not an address", async () => {
        const world = fakeHost(() => response({ data: bytes(1) }));
        const client = createClient(world.host);
        for (const url of ["http://media.tenor.com/a.gif", "https://example.com/a.gif", "ftp://media.tenor.com/a", "nonsense", "", 5, null, undefined, { href: "x" }]) {
            assert.equal(await client.fetchMedia(url), null, String(url));
        }
        assert.equal(world.calls.length, 0);
    });

    it("gives nothing when the answer is not ok, ends on another host, is empty or is too big, or when the request fails", async () => {
        assert.equal(await createClient(fakeHost(() => response({ ok: false, data: bytes(1) })).host).fetchMedia("https://media.tenor.com/a"), null);
        assert.equal(await createClient(fakeHost(() => response({ url: "https://evil.example/a", data: bytes(1) })).host).fetchMedia("https://media.tenor.com/a"), null);
        assert.equal(await createClient(fakeHost(() => response({ data: new ArrayBuffer(0) })).host).fetchMedia("https://media.tenor.com/a"), null);
        assert.equal(await createClient(fakeHost(() => response({ data: new ArrayBuffer(25 * 1024 * 1024 + 1) })).host).fetchMedia("https://media.tenor.com/a"), null);
        assert.equal(await createClient(fakeHost(() => { throw new Error("offline"); }).host).fetchMedia("https://media.tenor.com/a"), null);
        assert.notEqual(await createClient(fakeHost(() => response({ url: "https://c.tenor.com/final", data: bytes(1) })).host).fetchMedia("https://media.tenor.com/a"), null, "a redirect inside the listed hosts is fine");
        assert.notEqual(await createClient(fakeHost(() => response({ data: new ArrayBuffer(25 * 1024 * 1024) })).host).fetchMedia("https://media.tenor.com/a"), null, "exactly the limit is fine");
    });

    it("gives an empty type when the answer names none", async () => {
        const result = await createClient(fakeHost(() => response({ data: bytes(1) })).host).fetchMedia("https://media.tenor.com/a");
        assert.equal(result?.contentType, "");
    });
});

describe("GifCaptioner main process: fonts", () => {
    const listText = (rows: unknown[]) => `)]}'\n${JSON.stringify([null, rows])}`;

    it("reads the list of fonts from Google's answer, sorted, leaving out names that are not safe", async () => {
        const world = fakeHost(() => response({ text: listText([[0, ["Roboto", "Roboto"]], [0, ["Alfa Slab One", "Alfa Slab"]], [0, ["bad;name", "x"]], [0, [5]], "junk", [0], [0, ["Zilla", 7]]]) }));
        const fonts = await createClient(world.host).fontList();
        assert.deepEqual(fonts, [{ family: "Alfa Slab One", displayName: "Alfa Slab" }, { family: "Roboto", displayName: "Roboto" }, { family: "Zilla", displayName: "Zilla" }]);
        assert.equal(world.calls[0].init?.method, "POST");
        assert.equal(world.calls[0].init?.body, JSON.stringify([["", null, null, null, null, null, 1], [5], null, 400]));
        assert.equal(world.calls[0].init?.headers?.["content-type"], "application/json+protobuf");
    });

    it("gives an empty list when Google does not answer in the expected form", async () => {
        for (const make of [() => response({ ok: false }), () => response({ text: "not json" }), () => response({ text: ")]}'\n{\"a\":1}" }), () => response({ text: ")]}'\n[1, 5]" }), () => { throw new Error("offline"); }]) {
            assert.deepEqual(await createClient(fakeHost(make).host).fontList(), []);
        }
    });

    it("reads a font answer that has no prefix", async () => {
        assert.deepEqual(await createClient(fakeHost(() => response({ text: JSON.stringify([null, [[0, ["Roboto", "R"]]]]) })).host).fontList(), [{ family: "Roboto", displayName: "R" }]);
    });

    it("downloads the file of a family from Google's font server, and nowhere else", async () => {
        const world = fakeHost(url => (url.startsWith("https://fonts.googleapis.com/")
            ? response({ text: "@font-face { src: url('https://fonts.gstatic.com/s/roboto/v1/x.woff2') format('woff2'); }" })
            : response({ data: bytes(9, 8) })));
        const data = await createClient(world.host).fontFile("Open Sans");
        assert.deepEqual(data && [...new Uint8Array(data)], [9, 8]);
        assert.deepEqual(world.calls.map(call => call.url), ["https://fonts.googleapis.com/css2?family=Open%20Sans&display=swap", "https://fonts.gstatic.com/s/roboto/v1/x.woff2"]);
    });

    it("refuses a name that is not safe, a style sheet without a source, a source on another host, and a file that is empty or too big", async () => {
        const css = (source: string) => response({ text: `a { src: url(${source}); }` });
        assert.equal(await createClient(fakeHost(() => css("https://fonts.gstatic.com/x")).host).fontFile("bad;name"), null);
        assert.equal(await createClient(fakeHost(() => response({ text: "nothing here" })).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(() => css("https://evil.example/x.woff2")).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(() => css("http://fonts.gstatic.com/x.woff2")).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(() => css("not an address")).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(() => response({ ok: false })).host).fontFile("Roboto"), null);
        const file = (data: ArrayBuffer, ok = true) => (url: string) => (url.includes("googleapis") ? css("https://fonts.gstatic.com/x") : response({ ok, data }));
        assert.equal(await createClient(fakeHost(file(new ArrayBuffer(0))).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(file(new ArrayBuffer(8 * 1024 * 1024 + 1))).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(file(bytes(1), false)).host).fontFile("Roboto"), null);
        assert.notEqual(await createClient(fakeHost(file(new ArrayBuffer(8 * 1024 * 1024))).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(() => { throw new Error("offline"); }).host).fontFile("Roboto"), null);
        assert.equal(await createClient(fakeHost(() => css("\"https://fonts.gstatic.com/x\"")).host).fontFile("Roboto").then(value => value === null), true, "a quoted source whose file cannot be read");
    });

    it("exports only the three functions the page may call, and declares them", () => {
        assert.deepEqual(Object.keys(nativeEntry).sort(), ["fetchMedia", "fontFile", "fontList"]);
        assert.deepEqual([...manifest.permissions.native.functions].sort(), ["fetchMedia", "fontFile", "fontList"]);
        assert.deepEqual(manifest.permissions.network.map(rule => rule.from), Array(7).fill("main"));
        assert.equal(manifest.permissions.messages.send, true);
        assert.equal(manifest.origin, "testcord");
    });

    it("hands each call to a client built on the host it was given", async () => {
        const world = fakeHost(() => response({ type: "image/png", data: bytes(7) }));
        const result = await nativeEntry.fetchMedia(world.host, "https://media.tenor.com/x.png");
        assert.equal(result?.contentType, "image/png");
        assert.deepEqual(await nativeEntry.fontList(fakeHost(() => response({ ok: false })).host), []);
        assert.equal(await nativeEntry.fontFile(world.host, "bad;name"), null);
    });
});

describe("GifCaptioner: what a file is", () => {
    const ascii = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

    it("knows a GIF by its type or by its first letters", () => {
        assert.equal(looksLikeGif({ buffer: ascii("GIF89a"), contentType: "" }), true);
        assert.equal(looksLikeGif({ buffer: bytes(0, 0, 0), contentType: "image/gif" }), true);
        assert.equal(looksLikeGif({ buffer: ascii("GIX"), contentType: "image/png" }), false);
        assert.equal(looksLikeGif({ buffer: ascii("GI"), contentType: "" }), false);
        assert.equal(looksLikeGif({ buffer: ascii("XIF"), contentType: "" }), false);
        assert.equal(looksLikeGif({ buffer: ascii("GXF"), contentType: "" }), false);
    });

    it("knows a video by its type, by an mp4 header or by a webm header", () => {
        assert.equal(looksLikeVideo({ buffer: bytes(0), contentType: "video/mp4" }), true);
        assert.equal(looksLikeVideo({ buffer: bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1), contentType: "" }), true);
        assert.equal(looksLikeVideo({ buffer: bytes(0x1a, 0x45, 0xdf, 0xa3), contentType: "" }), true);
        assert.equal(looksLikeVideo({ buffer: bytes(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x71), contentType: "" }), false);
        assert.equal(looksLikeVideo({ buffer: bytes(0x1a, 0x45, 0xdf, 0xa4), contentType: "" }), false);
        assert.equal(looksLikeVideo({ buffer: bytes(0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70), contentType: "" }), true, "eight bytes are enough for the mp4 mark");
        assert.equal(looksLikeVideo({ buffer: bytes(0x1a, 0x45, 0xdf), contentType: "image/png" }), false);
        assert.equal(looksLikeVideo({ buffer: bytes(0, 0, 0, 0, 0x66, 0x74, 0x79), contentType: "" }), false);
    });

    it("says a video is a video without opening it, and reads the size of a picture by opening it", async () => {
        const never = async () => { throw new Error("must not open"); };
        assert.deepEqual(await inspectMedia(bytes(0), "video/mp4", never), { height: 0, isVideo: true, width: 0 });
        let closed = 0;
        const opened = await inspectMedia(bytes(0), "image/png", async () => ({ width: 30, height: 20, close: () => { closed++; } }));
        assert.deepEqual(opened, { height: 20, isVideo: false, width: 30 });
        assert.equal(closed, 1);
    });

    it("reads the size of a GIF from its own header when the page cannot open it, and gives nothing for anything else", async () => {
        const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0xc8, 0x00]).buffer;
        const fail = async () => { throw new Error("cannot open"); };
        assert.deepEqual(await inspectMedia(gif, "image/gif", fail), { width: 300, height: 200, isVideo: false });
        assert.equal(await inspectMedia(bytes(1, 2, 3), "image/png", fail), null);
        assert.equal(await inspectMedia(new Uint8Array([0x47, 0x49, 0x46]).buffer, "", fail), null, "a GIF too short to have a size");
    });

    it("cuts a caption into lines between words", () => {
        const ctx = { measureText: (text: string) => ({ width: text.length * 10 }) };
        assert.deepEqual(getLines(ctx, "one two three four", 100), ["one two", "three", "four"], "\"three four\" is exactly as wide as the line, so it does not fit");
        assert.deepEqual(getLines(ctx, "single", 100), ["single"]);
        assert.deepEqual(getLines(ctx, "", 100), [""]);
        assert.deepEqual(getLines(ctx, "supercalifragilistic is", 50), ["supercalifragilistic", "is"], "a word wider than the line stays alone");
        assert.deepEqual(getLines(ctx, "aa bb", 51), ["aa bb"], "it fits when it is narrower than the line");
        assert.deepEqual(getLines(ctx, "aa bbb", 60), ["aa", "bbb"], "and does not when it is exactly as wide");
    });
});

describe("GifCaptioner: which addresses to try", () => {
    it("recognises addresses and gives them a scheme", () => {
        assert.equal(looksLikeUrl("https://a"), true);
        assert.equal(looksLikeUrl("http://a"), true);
        assert.equal(looksLikeUrl("//a"), true);
        assert.equal(looksLikeUrl("a.com"), false);
        assert.equal(normalizeUrl("//a.com/x"), "https://a.com/x");
        assert.equal(normalizeUrl("https://a.com/x"), "https://a.com/x");
    });

    it("changes a Tenor address of a video to the mp4 one, once, and leaves GIFs and other hosts alone", () => {
        assert.equal(applyTenorMp4Fix("https://media.tenor.com/abcdeAAA/x", false), "https://media.tenor.com/abcdeAAo/x");
        assert.equal(applyTenorMp4Fix("https://media.tenor.com/abcdeAAo/x", false), "https://media.tenor.com/abcdeAAo/x");
        assert.equal(applyTenorMp4Fix("https://media.tenor.com/abcdeAAA/x", true), "https://media.tenor.com/abcdeAAA/x");
        assert.equal(applyTenorMp4Fix("https://cdn.example.com/abcdeAAA/x", false), "https://cdn.example.com/abcdeAAA/x");
        assert.equal(applyTenorMp4Fix("not an address", false), "not an address");
    });

    it("finds the addresses inside an item, by key names, only a few levels deep", () => {
        const found = collectCandidateUrls({
            url: "//a.example/1", src: "https://a.example/2", proxy_url: "http://a.example/3", title: "https://not-a-url-key.example/", other: "text",
            gif: { src: "https://a.example/4", note: "x", deep: { image: { url: "https://a.example/not-in-a-container" } } },
            list: ["https://not-a-container.example/"], media: [{ url: "https://a.example/6" }, "https://a.example/7"], count: 5
        });
        assert.deepEqual([...found].sort(), ["http://a.example/3", "https://a.example/1", "https://a.example/2", "https://a.example/4", "https://a.example/6", "https://a.example/7"].sort());
        assert.equal(collectCandidateUrls({ gif: { media: { image: { url: "https://a.example/too-deep" } } } }).size, 0, "containers inside containers stop after two levels");
        assert.equal(collectCandidateUrls({ gif: { media: { url: "https://a.example/two-levels" } } }).size, 1);
        assert.equal(collectCandidateUrls(null).size, 0);
        assert.equal(collectCandidateUrls("https://a.example/x").size, 1);
        assert.equal(collectCandidateUrls("plain").size, 0);
        assert.equal(collectCandidateUrls(5).size, 0);
        assert.equal(collectCandidateUrls({ url: "https://a" }, 3).size, 0);
        assert.deepEqual([...collectCandidateUrls(["//x.example/1", ["//x.example/2"]])], ["https://x.example/1", "https://x.example/2"]);
        assert.equal(collectCandidateUrls([[["//x.example/3"]]]).size, 0, "three arrays deep is too deep");
    });

    it("scores Discord's own servers highest, then the others it knows", () => {
        assert.equal(scoreUrl("https://cdn.discordapp.com/a.gif"), 100 + 10 + 1);
        assert.equal(scoreUrl("https://media.discordapp.net/a.png"), 110);
        assert.equal(scoreUrl("https://images-ext-1.discordapp.net/a"), 120);
        assert.equal(scoreUrl("https://c.klipy.com/a.gif"), 6);
        assert.equal(scoreUrl("https://media.tenor.com/a"), 5);
        assert.equal(scoreUrl("https://example.com/a"), 0);
        assert.equal(scoreUrl("not an address .gif"), 1);
    });

    it("puts the preferred address first and sorts the rest from best to worst", () => {
        const all = new Set(["https://example.com/z", "https://media.tenor.com/t", "https://cdn.discordapp.com/d"]);
        assert.deepEqual(orderCandidateUrls("https://example.com/z", all), ["https://example.com/z", "https://cdn.discordapp.com/d", "https://media.tenor.com/t"]);
        assert.deepEqual(orderCandidateUrls(null, all), ["https://cdn.discordapp.com/d", "https://media.tenor.com/t", "https://example.com/z"]);
        assert.deepEqual(orderCandidateUrls("https://x", new Set()), []);
    });

    it("builds the list for an item: its own address first, adjusted, then the others", () => {
        const props = { format: 2, src: "//media.tenor.com/abcdeAAA/x", gif: { url: "https://cdn.discordapp.com/k.gif" } };
        assert.deepEqual(addressesFor(props), ["https://media.tenor.com/abcdeAAo/x", "https://cdn.discordapp.com/k.gif"]);
        assert.deepEqual(addressesFor({ format: 1, src: "https://media.tenor.com/abcdeAAA/x" }), ["https://media.tenor.com/abcdeAAA/x"]);
        assert.deepEqual(addressesFor({ format: 1, gif: { url: "https://cdn.discordapp.com/k.gif" } }), ["https://cdn.discordapp.com/k.gif"]);
        assert.deepEqual(addressesFor({}), []);
        assert.deepEqual(addressesFor({ src: 5 as never }), []);
    });
});
