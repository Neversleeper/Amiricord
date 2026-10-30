/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mentionText } from "../src/equicordplugins/VoiceChatUtils/index";
import { attributeValue } from "../src/testcordplugins/AutoCorrect/index";
import { galleryItems, thumbnailUrl } from "../src/testcordplugins/ChannelGallery/index";
import { formatMessages, parseFormat } from "../src/testcordplugins/ExportDM/index";
import { addReaction, cleanCounts, ranked, removeReaction } from "../src/testcordplugins/ReactionTracker/index";
import { permissionsOf } from "../src/vencordplugins/PermissionsViewer/index";
import { millisecondsOf, replyTime } from "../src/vencordplugins/ReplyTimestamp/index";

describe("ported plugins, seventh batch", () => {
    it("finds pictures in messages", () => {
        const items = galleryItems([
            { id: "1", attachments: [{ filename: "a.png", url: "https://cdn.discordapp.com/a.png", content_type: "image/png" }, { filename: "b.gif", url: "https://x/b.gif" }, { filename: "c.txt", url: "https://x/c.txt" }], embeds: [{ image: { url: "https://x/e.jpg" } }] },
            { id: "2", attachments: [{ filename: "a.png", url: "https://cdn.discordapp.com/a.png" }] }
        ], { includeGifs: true, includeEmbeds: true });
        assert.equal(items.length, 3);
        assert.equal(galleryItems([{ id: "1", attachments: [{ filename: "b.gif", url: "https://x/b.gif" }] }], { includeGifs: false, includeEmbeds: true }).length, 0);
        assert.equal(galleryItems([{ id: "1", embeds: [{ image: { url: "https://x/e.jpg" } }] }], { includeGifs: true, includeEmbeds: false }).length, 0);
        assert.ok(thumbnailUrl("https://cdn.discordapp.com/a.png").includes("width=200"));
        assert.equal(thumbnailUrl("https://x/a.png"), "https://x/a.png");
    });

    it("adds up permissions from roles", () => {
        const everyone = { id: "g", name: "@everyone", permissions: 1n << 11n, position: 0 };
        const mod = { id: "m", name: "Mod", permissions: (1n << 1n) | (1n << 11n), position: 5 };
        const found = permissionsOf([everyone, mod], false);
        assert.deepEqual(found.map(p => p.name), ["Kick Members", "Send Messages"]);
        assert.equal(found[1].from, "Mod");
        assert.ok(permissionsOf([everyone], true).length > 40);
        assert.equal(permissionsOf([{ id: "a", name: "Admin", permissions: "8", position: 1 }], false)[0].from, "Admin (Administrator)");
    });

    it("small helpers", () => {
        assert.equal(attributeValue(true, "off"), "on");
        assert.equal(attributeValue(false, "off"), "off");
        assert.equal(mentionText(["1", "2", "1", undefined, "me"], "me"), "<@1> <@2> ");
        assert.equal(mentionText([], "me"), "");
        assert.equal(parseFormat(" CSV "), "csv");
        assert.equal(parseFormat("zip"), "txt");
        const csv = formatMessages([{ id: "1", timestamp: "2026-01-01T00:00:00Z", content: "say \"hi\"", author: { username: "ana" } }], "csv");
        assert.ok(csv.includes("\"say \"\"hi\"\"\""));
        assert.equal(JSON.parse(formatMessages([{ id: "1", timestamp: "t" }], "json"))[0].author, "unknown");
    });

    it("times of replies", () => {
        const a = new Date("2026-03-04T14:05:00").getTime();
        assert.match(replyTime(a, a + 1000, "en-US"), /^\[\d\d:\d\d/);
        assert.ok(replyTime(a, a + 3 * 86_400_000, "en-US").includes(","));
        assert.equal(millisecondsOf(undefined), undefined);
        assert.equal(millisecondsOf("nope"), undefined);
        assert.equal(millisecondsOf(5), 5);
    });

    it("counts reactions", () => {
        let counts = addReaction(addReaction(cleanCounts(null), "u", "c"), "u", "d");
        assert.equal(counts.users.u, 2);
        counts = removeReaction(counts, "u", "c");
        assert.equal(counts.users.u, 1);
        assert.equal(counts.channels.c, undefined);
        assert.deepEqual(ranked({ a: 1, b: 3 }).map(e => e.id), ["b", "a"]);
        assert.deepEqual(cleanCounts({ users: { a: 2, b: "x" }, channels: 5 }), { users: { a: 2 }, channels: {} });
    });
});
