/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectGifs, extractGifs, type Filter, type GifEntry, type Page, type ScanDeps, userIdFromTarget } from "../src/testcordplugins/SaveUserGifs/index";

const ID = "1564847328794382408";

describe("SaveUserGifs: the GIFs in a message", () => {
    it("takes a GIF attachment by its name or its type, with the size Discord gave", () => {
        const found = extractGifs({ attachments: [{ url: "https://cdn/a.gif", proxy_url: "https://proxy/a.gif", width: 10, height: 20 }, { url: "https://cdn/b", content_type: "image/gif" }, { url: "https://cdn/c.png", content_type: "image/png" }] });
        assert.deepEqual(found.map(gif => [gif.url, gif.src, gif.width, gif.height, gif.format]), [["https://cdn/a.gif", "https://proxy/a.gif", 10, 20, 1], ["https://cdn/b", "https://cdn/b", 498, 280, 1]]);
    });

    it("takes a GIF embed (Tenor, Giphy, a .gif link or a gifv) with its video as the source", () => {
        const found = extractGifs({ embeds: [{ type: "gifv", url: "https://tenor.com/view/x", video: { url: "https://media.tenor.com/x.mp4", width: 300, height: 200 } }, { type: "link", url: "https://example.com/page" }, { type: "image", url: "https://example.com/y.gif" }] });
        assert.deepEqual(found.map(gif => [gif.url, gif.src, gif.format]), [["https://tenor.com/view/x", "https://media.tenor.com/x.mp4", 2], ["https://example.com/y.gif", "https://example.com/y.gif", 2]]);
    });

    it("takes the GIF addresses written in the text, and lists each address once per message", () => {
        const text = "look https://tenor.com/view/cat-123 and https://x.test/a.gif?size=2 and https://x.test/page and again https://tenor.com/view/cat-123";
        const found = extractGifs({ content: text });
        assert.deepEqual(found.map(gif => gif.url), ["https://tenor.com/view/cat-123", "https://x.test/a.gif?size=2"]);
        assert.deepEqual(found.map(gif => gif.format), [2, 2]);
    });

    it("gives nothing for a message without GIFs or one that is not what it should be", () => {
        for (const message of [{}, { content: "hello" }, { attachments: "no", embeds: 5 }, null, undefined, "text", 5]) assert.deepEqual(extractGifs(message), [], String(message));
    });
});

/** A fake search: each filter has a list of messages (each message is a text with one GIF address) given 25 at a time. */
function fakeDeps(perFilter: Record<string, string[]>, over: Partial<ScanDeps> = {}): { deps: ScanDeps; calls: Array<[string, number]>; slept: number[]; } {
    const calls: Array<[string, number]> = [];
    const slept: number[] = [];
    const deps: ScanDeps = {
        async fetchPage(filter: Filter, offset: number): Promise<Page | null> {
            calls.push([filter.value, offset]);
            const all = perFilter[filter.value] ?? [];
            return { messages: all.slice(offset, offset + 25).map(content => ({ content })), total: all.length };
        },
        sleep: async ms => { slept.push(ms); },
        stopped: () => false,
        ...over
    };
    return { deps, calls, slept };
}

const gifLink = (n: number) => `https://media.tenor.com/${n}.gif`;
const filters: Filter[] = [{ type: "content", value: "tenor.com" }, { type: "has", value: "file" }];

describe("SaveUserGifs: looking through the pages", () => {
    it("reads page after page until the messages are over, pausing between pages, and gives each GIF once across searches", async () => {
        const first = Array.from({ length: 30 }, (_, index) => gifLink(index));
        const second = [gifLink(0), gifLink(99)];
        const { deps, calls, slept } = fakeDeps({ "tenor.com": first, file: second });
        const found = await collectGifs(deps, filters, 99999);
        assert.equal(found.length, 31);
        assert.deepEqual(calls, [["tenor.com", 0], ["tenor.com", 25], ["file", 0]]);
        assert.deepEqual(slept, [800]);
    });

    it("tells each new GIF as it is found, and skips the ones it was told it already has", async () => {
        const told: string[] = [];
        const { deps } = fakeDeps({ "tenor.com": [gifLink(1), gifLink(2)] }, { onGif: (gif: GifEntry) => { told.push(gif.url); } });
        const found = await collectGifs(deps, [filters[0]], 99999, new Set([gifLink(1)]));
        assert.deepEqual(found.map(gif => gif.url), [gifLink(2)]);
        assert.deepEqual(told, [gifLink(2)]);
    });

    it("stops at the most messages asked for, and when it is asked to stop", async () => {
        const many = Array.from({ length: 100 }, (_, index) => gifLink(index));
        const limited = fakeDeps({ "tenor.com": many });
        assert.equal((await collectGifs(limited.deps, [filters[0]], 25)).length, 25);
        assert.deepEqual(limited.calls, [["tenor.com", 0]]);
        let pages = 0;
        const stopping = fakeDeps({ "tenor.com": many }, { stopped: () => pages >= 1, fetchPage: async (_filter, offset) => { pages++; return { messages: many.slice(offset, offset + 25).map(content => ({ content })), total: 100 }; } });
        assert.equal((await collectGifs(stopping.deps, filters, 99999)).length, 25);
    });

    it("waits 5 seconds and tries the same page again when Discord says it is being rate limited, and gives up after five tries", async () => {
        let attempt = 0;
        const flaky = fakeDeps({}, { fetchPage: async () => { attempt++; if (attempt === 1) throw { status: 429 }; return { messages: [{ content: gifLink(1) }], total: 1 }; } });
        assert.equal((await collectGifs(flaky.deps, [filters[0]], 99999)).length, 1);
        assert.deepEqual(flaky.slept, [5000]);
        let tries = 0;
        const always = fakeDeps({}, { fetchPage: async () => { tries++; throw { status: 429 }; } });
        assert.deepEqual(await collectGifs(always.deps, [filters[0]], 99999), []);
        assert.equal(tries, 6);
    });

    it("goes on with the next search when one fails with something else or gives nothing", async () => {
        const { deps } = fakeDeps({ file: [gifLink(7)] }, { fetchPage: async (filter: Filter) => { if (filter.value === "tenor.com") throw new Error("boom"); return { messages: [{ content: gifLink(7) }], total: 1 }; } });
        assert.deepEqual((await collectGifs(deps, filters, 99999)).map(gif => gif.url), [gifLink(7)]);
        const empty = fakeDeps({}, { fetchPage: async () => null });
        assert.deepEqual(await collectGifs(empty.deps, filters, 99999), []);
    });
});

/** A fake page element: attributes, an address, and the element around it. */
const element = (over: { attributes?: Record<string, string>; src?: string; parent?: unknown; } = {}) => ({ getAttribute: (name: string) => over.attributes?.[name] ?? null, src: over.src, parentElement: over.parent ?? null });

describe("SaveUserGifs: who was right-clicked", () => {
    it("reads the id from an attribute that carries it, from a list item id that ends in it, or from a picture of Discord's avatar address", () => {
        assert.equal(userIdFromTarget(element({ attributes: { "data-user-id": ID } })), ID);
        assert.equal(userIdFromTarget(element({ attributes: { "data-author-id": ID } })), ID);
        assert.equal(userIdFromTarget(element({ attributes: { "data-list-item-id": `members___${ID}` } })), ID);
        assert.equal(userIdFromTarget(element({ src: `https://cdn.discordapp.com/avatars/${ID}/abcdef0123456789abcd.png?size=80` })), ID);
    });

    it("looks at the elements around the one clicked, a few levels up", () => {
        const inner = element({ parent: element({ parent: element({ attributes: { "data-user-id": ID } }) }) });
        assert.equal(userIdFromTarget(inner), ID);
        let top: unknown = element({ attributes: { "data-user-id": ID } });
        for (let level = 0; level < 9; level++) top = element({ parent: top });
        assert.equal(userIdFromTarget(top), undefined, "nine levels up is too far");
    });

    it("gives nothing for a click that carries no id or a value that is not an id", () => {
        for (const target of [null, undefined, {}, element(), element({ attributes: { "data-user-id": "abc" } }), element({ attributes: { "data-list-item-id": "guildsnav___home" } }), element({ src: "https://example.com/avatars/12/x.png" })]) {
            assert.equal(userIdFromTarget(target), undefined);
        }
    });
});
