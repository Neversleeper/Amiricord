/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inviteLink, inviteSummary } from "../src/equicordplugins/FriendCodes/index";
import { looksLikeToken } from "../src/equicordplugins/LoginWithToken/index";
import { splitMessage } from "../src/equicordplugins/SplitLargeMessages/index";
import { accountAge, idTimestamp } from "../src/testcordplugins/BetterJoinedDate/index";
import { OUTGOING_REQUEST } from "../src/testcordplugins/CancelFriendRequest/index";
import { composeAction } from "../src/testcordplugins/ComposeMode/index";
import { definitionLines } from "../src/testcordplugins/Define/index";
import { maskToken, parseTokens } from "../src/testcordplugins/ImportMultiTokens/index";
import { cameraChanges } from "../src/testcordplugins/WebcamStartNotifier/index";
import { wikiSummary } from "../src/testcordplugins/WikiLookup/index";
import { anonymisedName, extensionOf, formatDate } from "../src/vencordplugins/AnonymiseFileNames/index";
import { formatDuration } from "../src/vencordplugins/CallTimer/index";
import { restorePath } from "../src/vencordplugins/KeepCurrentChannel/index";
import { addEntry, type LogEntry, toSeen } from "../src/vencordplugins/MessageLogger/index";
import { draftText } from "../src/vencordplugins/PreviewMessage/index";
import { timeLeft } from "../src/vencordplugins/ShowTimeoutDuration/index";
import { voiceText } from "../src/vencordplugins/UserVoiceShow/index";

describe("ported plugins, eighth batch", () => {
    it("keeps the extension and makes a new name", () => {
        assert.equal(extensionOf("photo.png"), ".png");
        assert.equal(extensionOf("backup.tar.gz"), ".tar.gz");
        assert.equal(extensionOf("noext"), "");
        assert.equal(extensionOf(".hidden"), "");
        const rules = { method: "random", randomLength: 5, consistent: "image", dateFormat: "YYYY-MM-DD", spoiler: false };
        const now = new Date(2026, 9, 29, 14, 5, 9, 7);
        assert.match(anonymisedName("a.png", rules, now), /^[0-9bdfhjkmnpqrstvwxz]{5}\.png$/);
        assert.equal(anonymisedName("a.png", { ...rules, method: "consistent" }, now), "image.png");
        assert.equal(anonymisedName("a.png", { ...rules, method: "date", dateFormat: "YYYY-MM-DD_HH-mm-ss-SSS", spoiler: true }, now), "SPOILER_2026-10-29_14-05-09-007.png");
        assert.equal(anonymisedName("a.png", { ...rules, method: "timestamp" }, now), `${now.getTime()}.png`);
        assert.equal(formatDate("DD/MM/YYYY", now), "29/10/2026");
    });

    it("reads the age of an account from its id", () => {
        const id = "175928847299117063";
        assert.equal(new Date(idTimestamp(id)).getUTCFullYear(), 2016);
        const created = idTimestamp(id);
        assert.match(accountAge(id, created + 1000), /Today/);
        assert.match(accountAge(id, created + 86400000 * 1.5), /Yesterday/);
        assert.match(accountAge(id, created + 86400000 * 12), /12 days ago/);
    });

    it("decides what a key does in compose mode", () => {
        assert.equal(composeAction("Enter", false, false, false, true), "newline");
        assert.equal(composeAction("Enter", true, false, false, true), "send");
        assert.equal(composeAction("Enter", false, true, false, true), "none");
        assert.equal(composeAction("Enter", false, false, false, false), "none");
        assert.equal(composeAction("a", false, false, false, true), "none");
    });

    it("picks the words of a dictionary and wiki answer", () => {
        assert.deepEqual(definitionLines([{ meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "a thing", example: "see it" }] }, { partOfSpeech: "verb", definitions: [] }] }]), [{ kind: "noun", text: "a thing", example: "see it" }]);
        assert.deepEqual(definitionLines({ title: "No Definitions Found" }), []);
        assert.equal(wikiSummary({ type: "disambiguation", extract: "x" }, "q"), undefined);
        assert.equal(wikiSummary({ title: "Cat", extract: "A cat.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Cat" } } }, "cat")?.url, "https://en.wikipedia.org/wiki/Cat");
        assert.equal(wikiSummary(null, "q"), undefined);
    });

    it("notices a camera turned on or off", () => {
        const seen = new Map<string, boolean>();
        assert.deepEqual(cameraChanges(seen, "c", [{ userId: "1", channelId: "c", selfVideo: false }]), []);
        assert.deepEqual(cameraChanges(seen, "c", [{ userId: "1", channelId: "c", selfVideo: true }]), [true]);
        assert.deepEqual(cameraChanges(seen, "c", [{ userId: "1", channelId: "c", selfVideo: true }]), []);
        assert.deepEqual(cameraChanges(seen, "c", [{ userId: "1", channelId: "c", selfVideo: false }]), [false]);
        assert.deepEqual(cameraChanges(seen, "c", [{ userId: "1", channelId: "other", selfVideo: true }]), []);
        assert.equal(seen.has("1"), false);
    });

    it("writes the time left of a timeout and of a call", () => {
        const now = 1_000_000;
        assert.equal(timeLeft(new Date(now + 2 * 3600_000 + 5 * 60_000 + 9000), now), "2h 5m");
        assert.equal(timeLeft(new Date(now + 40_000), now), "40s");
        assert.equal(timeLeft(new Date(now + 3 * 86400_000), now), "3d");
        assert.equal(timeLeft(new Date(now - 1), now), undefined);
        assert.equal(timeLeft(null, now), undefined);
        assert.equal(timeLeft("not a date", now), undefined);
        assert.equal(formatDuration(65_000), "1:05");
        assert.equal(formatDuration(3_725_000), "1:02:05");
        assert.equal(formatDuration(-5), "0:00");
    });

    it("finds where to go back to and what to show", () => {
        assert.equal(restorePath({ channelId: "22", guildId: "11" }), "/channels/11/22");
        assert.equal(restorePath({ channelId: "22", guildId: null }), "/channels/@me/22");
        assert.equal(restorePath({ channelId: "x" }), undefined);
        assert.equal(restorePath({ channelId: "22", guildId: "../x" }), undefined);
        assert.equal(restorePath(null), undefined);
        assert.equal(restorePath("a"), undefined);
        assert.equal(draftText({ innerText: "  hi\n\n\n\nthere \u200b" }), "hi\n\nthere");
        assert.equal(draftText(null), "");
        assert.equal(voiceText("General"), "in General");
        assert.equal(voiceText(undefined), undefined);
    });

    it("writes friend code links and summaries", () => {
        assert.equal(inviteLink("abc"), "https://discord.gg/abc");
        assert.match(inviteSummary({ code: "a", expires_at: new Date(2000, 0, 1).toISOString(), uses: 1, max_uses: 5 }, Date.now()), /expired, used 1\/5/);
        assert.match(inviteSummary({ code: "a" }, 0), /no end date, used 0\/\?/);
        assert.equal(OUTGOING_REQUEST, 4);
    });
});

describe("ported plugins, split and logger", () => {
    it("cuts long text at the chosen boundary", () => {
        assert.deepEqual(splitMessage("aaa bbb ccc", 8, "spaces"), ["aaa bbb ", "ccc"]);
        assert.deepEqual(splitMessage("aaa\nbbb ccc", 8, "newlines"), ["aaa\n", "bbb ccc"]);
        assert.deepEqual(splitMessage("abcdef", 4, "characters"), ["abcd", "ef"]);
        assert.deepEqual(splitMessage("abc", 10, "spaces"), ["abc"]);
        assert.deepEqual(splitMessage("abc", 0, "spaces"), []);
        assert.equal(splitMessage("x".repeat(4500), 2000, "newlines").length, 3);
    });

    it("keeps the messages seen and a limited log", () => {
        const seen = toSeen({ id: "1", channel_id: "2", content: "hi", author: { id: "3", username: "ana", bot: true } });
        assert.deepEqual(seen, { id: "1", channelId: "2", authorId: "3", author: "ana", content: "hi", bot: true });
        assert.equal(toSeen({ id: "1" }), undefined);
        assert.equal(toSeen(null), undefined);
        let log: LogEntry[] = [];
        for (let i = 0; i < 25; i++) log = addEntry(log, { ...seen!, id: String(i), kind: "deleted", at: i }, 20);
        assert.equal(log.length, 20);
        assert.equal(log[0].id, "24");
    });
});

describe("ported plugins, login with your own token", () => {
    it("parses pasted tokens in several layouts", () => {
        assert.deepEqual(parseTokens("a\n\nTOKEN1\nb\n\nTOKEN2"), [{ userId: "a", token: "TOKEN1" }, { userId: "b", token: "TOKEN2" }]);
        assert.deepEqual(parseTokens("TOKEN1, TOKEN2"), [{ userId: "TOKEN1", token: "TOKEN1" }, { userId: "TOKEN2", token: "TOKEN2" }]);
        assert.deepEqual(parseTokens("TOKEN1\nTOKEN1"), [{ userId: "TOKEN1", token: "TOKEN1" }]);
        assert.deepEqual(parseTokens(""), []);
        assert.equal(maskToken("abcdefgh"), "****efgh");
        assert.equal(maskToken("ab"), "**");
        assert.equal(looksLikeToken("abc.DEF-123_xyz0123456789"), true);
        assert.equal(looksLikeToken("not a token"), false);
    });
});
