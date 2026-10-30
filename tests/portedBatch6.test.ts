/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findReplies } from "../src/equicordplugins/FindReply/index";
import { cleanPatterns, globToRegex, matchingEntry } from "../src/equicordplugins/UrlHighlighter/index";
import { formatIcons, iconEntries } from "../src/testcordplugins/IconExport/index";
import { clickAction } from "../src/testcordplugins/MessageClickActions/index";
import { counterColor, textLength } from "../src/vencordplugins/CharacterCounter/index";
import { OLDEST_QUERY } from "../src/vencordplugins/JumpTo/index";
import { nextMessage } from "../src/vencordplugins/QuickReply/index";

describe("ported plugins, sixth batch", () => {
    it("colours the counter and measures the box", () => {
        assert.equal(counterColor(10, true), "var(--text-muted)");
        assert.match(counterColor(60, true), /yellow/);
        assert.match(counterColor(80, true), /orange/);
        assert.match(counterColor(95, true), /red/);
        assert.equal(counterColor(95, false), "var(--text-muted)");
        assert.equal(textLength("\n"), 0);
        assert.equal(textLength("héllo\n"), 5);
        assert.equal(textLength("👍👍"), 2);
    });

    it("finds the replies after a message and pings only when asked", () => {
        const loaded = [
            { id: "10" },
            { id: "11", messageReference: { message_id: "10" } },
            { id: "9", messageReference: { message_id: "10" } },
            { id: "12", content: "hi <@77>" },
            { id: "13", messageReference: { message_id: "10" }, deleted: true },
            { id: "14", messageReference: { message_id: "10" } }
        ];
        assert.deepEqual(findReplies(loaded, { id: "10", authorId: "77" }, false).map(message => message.id), ["11", "14"]);
        assert.deepEqual(findReplies(loaded, { id: "10", authorId: "77" }, true).map(message => message.id), ["11", "12", "14"]);
        assert.deepEqual(findReplies(loaded, { id: "10" }, true).map(message => message.id), ["11", "14"]);
    });

    it("matches links with globs, anywhere in the address", () => {
        assert.equal(globToRegex("*.example.com").test("https://a.example.com/x"), true);
        assert.equal(globToRegex("example.com").test("https://example.com"), true);
        assert.equal(globToRegex("a?c").test("abc"), true);
        assert.equal(globToRegex("a.c").test("abc"), false);
        const entries = [{ pattern: "", color: "#000000" }, { pattern: "github.com", color: "#111111" }, { pattern: "*", color: "#222222" }];
        assert.equal(matchingEntry("https://github.com/x", entries)?.color, "#111111");
        assert.equal(matchingEntry("https://other.org", entries)?.color, "#222222");
        assert.equal(matchingEntry("https://other.org", []), undefined);
        assert.deepEqual(cleanPatterns([{ pattern: "a", color: "#abcdef" }, { pattern: "b", color: "red" }, null, 3]), [{ pattern: "a", color: "#abcdef" }]);
        assert.deepEqual(cleanPatterns("no"), []);
    });

    it("lists emojis and stickers in the three formats", () => {
        const entries = iconEntries([{ id: "1", name: "a", animated: true }, { id: "2", name: "b|c" }], [{ id: "3", name: "s", format_type: 4 }]);
        assert.equal(entries.length, 3);
        assert.ok(entries[0].url.endsWith("1.gif?size=128"));
        assert.ok(entries[1].url.endsWith("2.png?size=128"));
        assert.ok(entries[2].url.includes("/stickers/3.gif"));
        assert.equal(formatIcons(entries, "urls").split("\n").length, 3);
        assert.equal(JSON.parse(formatIcons(entries, "JSON")).length, 3);
        const table = formatIcons(entries, "markdown").split("\n");
        assert.equal(table.length, 5);
        assert.ok(table[3].includes("b\\|c"));
    });

    it("asks for the oldest message with after=0", () => {
        assert.deepEqual({ ...OLDEST_QUERY }, { after: "0", limit: 1 });
    });

    it("chooses the double-click action", () => {
        assert.equal(clickAction(true, { editOwn: true, replyOthers: true }), "edit");
        assert.equal(clickAction(false, { editOwn: true, replyOthers: true }), "reply");
        assert.equal(clickAction(true, { editOwn: false, replyOthers: true }), undefined);
        assert.equal(clickAction(false, { editOwn: true, replyOthers: false }), undefined);
    });

    it("moves through messages for quick reply and quick edit", () => {
        const all = [
            { id: "1", type: 0, author: { id: "me" } },
            { id: "2", type: 0, author: { id: "other" } },
            { id: "3", type: 7, author: { id: "other" } },
            { id: "4", type: 0, author: { id: "blocked" } },
            { id: "5", type: 0, author: { id: "other" }, flags: 64 },
            { id: "6", type: 19, author: { id: "me" } },
            { id: "7", type: 0, author: { id: "other" }, deleted: true }
        ];
        const reply = { own: "me", replying: true, skip: (id: string) => id === "blocked" };
        assert.equal(nextMessage(all, null, true, reply)?.id, "6");
        assert.equal(nextMessage(all, "6", true, reply)?.id, "2");
        assert.equal(nextMessage(all, "2", false, reply)?.id, "6");
        assert.equal(nextMessage(all, "6", false, reply), null);
        assert.equal(nextMessage(all, "1", true, reply), null);
        assert.equal(nextMessage(all, "gone", true, reply)?.id, "6");
        const edit = { own: "me", replying: false };
        assert.equal(nextMessage(all, null, true, edit)?.id, "6");
        assert.equal(nextMessage(all, "6", true, edit)?.id, "1");
        assert.equal(nextMessage([], null, true, edit), undefined);
    });
});
