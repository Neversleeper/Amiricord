/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ageText, BlockItem, blockItems, BLOCKS_PER_PAGE, filterBlocks, pageOfBlocks } from "../src/plugins/Settings/recentBlocks";
import type { BlockGroup } from "../src/shared/blocks";

const none = { analytics: 0, metrics: 0, "crash-reports": 0 };
const noTimes = { analytics: null, metrics: null, "crash-reports": null };
const group = (change: Partial<BlockGroup> = {}): BlockGroup => ({ kind: "usage-reports", method: "POST", host: "discord.com", path: "/api/*/science", count: 1, agoMs: 5000, ...change });

describe("how long ago, in words", () => {
    it("says just now below a second, and for odd numbers", () => {
        for (const ms of [0, 999, -5, NaN, Infinity, -Infinity]) assert.equal(ageText(ms), "just now", String(ms));
    });

    it("counts seconds, minutes, hours and days, rounding down", () => {
        assert.equal(ageText(1000), "1s ago");
        assert.equal(ageText(7400), "7s ago");
        assert.equal(ageText(59_999), "59s ago");
        assert.equal(ageText(60_000), "1m ago");
        assert.equal(ageText(3_599_000), "59m ago");
        assert.equal(ageText(3_600_000), "1h ago");
        assert.equal(ageText(86_399_000), "23h ago");
        assert.equal(ageText(86_400_000), "1d ago");
        assert.equal(ageText(5 * 86_400_000 + 1000), "5d ago");
        assert.equal(ageText(5 * 86_400_000 + 43_200_000), "5d ago", "rounded down, not up");
    });
});

describe("the lines of the recent blocks", () => {
    it("names each kind in plain words, with its tag, its place and its badge", () => {
        const kinds = ["usage-reports", "metrics", "crash-reports", "telemetry-host", "host-rules", "token-stripped"] as const;
        const items = blockItems(kinds.map((kind, index) => group({ kind, host: `h${index}.test`, agoMs: index })), none, noTimes, 0);
        assert.deepEqual(items.map(item => [item.title, item.tag, item.badge]), [
            ["Usage report blocked", "USAGE", "BLOCKED"],
            ["Metrics report blocked", "METRICS", "BLOCKED"],
            ["Crash report blocked", "CRASH", "BLOCKED"],
            ["Telemetry ping blocked", "PING", "BLOCKED"],
            ["Blocked by your rules", "YOUR RULE", "BLOCKED"],
            ["Token removed from a request", "TOKEN", "STRIPPED"]
        ]);
        assert.ok(items.every(item => item.source === "NETWORK"));
    });

    it("shows the method, the host and the path shape, and leaves a root path out", () => {
        assert.equal(blockItems([group()], none, noTimes, 0)[0]!.where, "POST discord.com/api/*/science");
        assert.equal(blockItems([group({ path: "/", method: "GET", host: "dc-telemetry.net" })], none, noTimes, 0)[0]!.where, "GET dc-telemetry.net");
    });

    it("keeps the count and the age of a group, and gives each line its own key", () => {
        const items = blockItems([group({ count: 3, agoMs: 7000 }), group({ host: "b.test", count: 1, agoMs: 8000 })], none, noTimes, 0);
        assert.deepEqual(items.map(item => [item.count, item.agoMs]), [[3, 7000], [1, 8000]]);
        assert.equal(new Set(items.map(item => item.key)).size, 2);
        const same = blockItems([group(), group()], none, noTimes, 0);
        assert.equal(new Set(same.map(item => item.key)).size, 2, "even two equal groups would get two keys");
    });

    it("adds one line per kind NoTrack stopped inside Discord, apart from the network ones, and only when it stopped something", () => {
        const items = blockItems([group({ agoMs: 5000 })], { analytics: 212, metrics: 0, "crash-reports": 1 }, { analytics: 9000, metrics: null, "crash-reports": 2000 }, 10_000);
        assert.deepEqual(items.map(item => [item.title, item.count, item.source, item.agoMs, item.where]), [
            ["Crash report hooks stopped inside Discord", 1, "INSIDE DISCORD", 8000, ""],
            ["Usage report blocked", 1, "NETWORK", 5000, "POST discord.com/api/*/science"],
            ["Usage events stopped inside Discord", 212, "INSIDE DISCORD", 1000, ""]
        ].sort((a, b) => (a[3] as number) - (b[3] as number)));
        assert.ok(items.filter(item => item.source === "INSIDE DISCORD").every(item => item.badge === "BLOCKED"));
        assert.deepEqual(items.map(item => item.tag).sort(), ["CRASH", "USAGE", "USAGE"]);
    });

    it("never adds what was stopped inside Discord to the network counts", () => {
        const items = blockItems([group({ count: 4 })], { analytics: 100, metrics: 0, "crash-reports": 0 }, { analytics: 0, metrics: null, "crash-reports": null }, 0);
        assert.deepEqual(items.map(item => [item.source, item.count]).sort(), [["INSIDE DISCORD", 100], ["NETWORK", 4]]);
    });

    it("uses a zero age when the time of a stopped kind is not known, and never a negative one", () => {
        assert.equal(blockItems([], { analytics: 5, metrics: 0, "crash-reports": 0 }, noTimes, 100)[0]!.agoMs, 0);
        assert.equal(blockItems([], { analytics: 5, metrics: 0, "crash-reports": 0 }, { analytics: 500, metrics: null, "crash-reports": null }, 100)[0]!.agoMs, 0);
    });

    it("puts the newest first and keeps the network line before an inside one of the same age", () => {
        const items = blockItems([group({ host: "old.test", agoMs: 9000 }), group({ host: "tie.test", agoMs: 3000 })], { analytics: 1, metrics: 0, "crash-reports": 0 }, { analytics: 7000, metrics: null, "crash-reports": null }, 10_000);
        assert.deepEqual(items.map(item => item.source + (item.where ? ":" + item.where : "")), ["NETWORK:POST tie.test/api/*/science", "INSIDE DISCORD", "NETWORK:POST old.test/api/*/science"]);
    });

    it("gives nothing when nothing was blocked", () => {
        assert.deepEqual(blockItems([], none, noTimes, 0), []);
    });
});

describe("searching the lines", () => {
    const items = blockItems([
        group({ host: "discord.com", agoMs: 1 }), group({ kind: "host-rules", host: "m.stripe.com", path: "/", method: "GET", agoMs: 2 }), group({ kind: "token-stripped", host: "stranger.test", agoMs: 3 })
    ], { analytics: 4, metrics: 0, "crash-reports": 0 }, { analytics: 0, metrics: null, "crash-reports": null }, 100);

    it("keeps everything for an empty search or one made of spaces", () => {
        assert.equal(filterBlocks(items, "").length, items.length);
        assert.equal(filterBlocks(items, "   ").length, items.length);
    });

    it("finds by the place, the title, the tag, the source and the badge, ignoring case", () => {
        assert.deepEqual(filterBlocks(items, "STRIPE").map(item => item.tag), ["YOUR RULE"]);
        assert.deepEqual(filterBlocks(items, "token removed").map(item => item.tag), ["TOKEN"]);
        assert.deepEqual(filterBlocks(items, "your rule").length, 1);
        assert.deepEqual(filterBlocks(items, "inside discord").map(item => item.source), ["INSIDE DISCORD"]);
        assert.equal(filterBlocks(items, "stripped").length, 1);
        assert.equal(filterBlocks(items, "blocked").length, 3);
    });

    it("finds by where it was stopped, so the network lines can be told from the inside ones", () => {
        assert.equal(filterBlocks(items, "network").length, 3);
        assert.deepEqual(filterBlocks(items, "network").map(item => item.source), ["NETWORK", "NETWORK", "NETWORK"]);
    });

    it("needs every word to be found, in any order", () => {
        assert.equal(filterBlocks(items, "stripe rule").length, 1);
        assert.equal(filterBlocks(items, "rule stripe").length, 1);
        assert.equal(filterBlocks(items, "stripe token").length, 0);
    });

    it("finds nothing for a word that is nowhere, and does not change the list", () => {
        const before = items.length;
        assert.deepEqual(filterBlocks(items, "zzz"), []);
        assert.equal(items.length, before);
        assert.notEqual(filterBlocks(items, ""), items, "a copy");
    });
});

describe("the pages", () => {
    const many = (n: number): BlockItem[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, title: "t", count: 1, where: "", tag: "USAGE", source: "NETWORK" as const, badge: "BLOCKED" as const, agoMs: i }));

    it("shows eight lines to a page, and always at least one page", () => {
        assert.equal(BLOCKS_PER_PAGE, 8);
        assert.deepEqual(pageOfBlocks([], 0), { items: [], index: 0, pages: 1 });
        assert.equal(pageOfBlocks(many(8), 0).pages, 1);
        assert.equal(pageOfBlocks(many(9), 0).pages, 2);
        assert.equal(pageOfBlocks(many(17), 0).pages, 3);
    });

    it("gives the lines of the page asked for", () => {
        const items = many(20);
        assert.deepEqual(pageOfBlocks(items, 0).items.map(item => item.key), ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7"]);
        assert.deepEqual(pageOfBlocks(items, 1).items.map(item => item.key), ["k8", "k9", "k10", "k11", "k12", "k13", "k14", "k15"]);
        assert.deepEqual(pageOfBlocks(items, 2).items.map(item => item.key), ["k16", "k17", "k18", "k19"]);
    });

    it("moves a page that is out of range into it, and tolerates odd numbers", () => {
        assert.equal(pageOfBlocks(many(20), 99).index, 2);
        assert.equal(pageOfBlocks(many(20), -4).index, 0);
        assert.equal(pageOfBlocks(many(20), NaN).index, 0);
        assert.equal(pageOfBlocks(many(20), Infinity).index, 0);
        assert.equal(pageOfBlocks(many(20), 1.9).index, 1);
    });

    it("takes the size from the caller", () => {
        assert.equal(pageOfBlocks(many(20), 0, 5).pages, 4);
        assert.equal(pageOfBlocks(many(20), 3, 5).items.length, 5);
    });
});
