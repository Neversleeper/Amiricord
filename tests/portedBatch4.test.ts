/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMessage } from "../src/equicordplugins/ExportMessages/index";
import { membersInRole } from "../src/equicordplugins/InRole/index";
import { speedFor } from "../src/equicordplugins/MediaPlaybackSpeed/index";
import { magnetName } from "../src/equicordplugins/RichMagnetLinks/index";
import { parseDelay, splitQueue } from "../src/equicordplugins/ScheduledMessages/index";
import { applySed } from "../src/equicordplugins/SedEnhanced/index";
import { convertText } from "../src/equicordplugins/UnitConverter/index";
import { entriesFor, LABELS, MAX_ENTRIES } from "../src/equicordplugins/VoiceChannelLog/index";
import { flushTotals, formatSeconds } from "../src/equicordplugins/VoiceStats/index";
import { searchBookmarks, toggleBookmark } from "../src/testcordplugins/Bookmarks/index";
import { fakeLink, spoof } from "../src/testcordplugins/FakeUrl/index";
import { presets, splitDue } from "../src/testcordplugins/MessageReminders/index";
import { addMessage, startOfDay, streak, sumLast } from "../src/testcordplugins/MessageStatistics/index";
import { shouldSilence } from "../src/testcordplugins/SilentCall/index";
import { cleanFlags, withFlag } from "../src/testcordplugins/UserFlags/index";
import { searchNotes, withNote } from "../src/testcordplugins/UserNotes/index";
import { copyLabel } from "../src/vencordplugins/CopyFileContents/index";
import { guildSettingsBodies, isNewJoin } from "../src/vencordplugins/NewGuildSettings/index";
import { parseTime, replaceTimes } from "../src/vencordplugins/SendTimestamps/index";
import { applyRules, stringToRegex } from "../src/vencordplugins/TextReplace/index";
import { rawText, sortKeys } from "../src/vencordplugins/ViewRaw/index";
import { reactionKey } from "../src/vencordplugins/WhoReacted/index";

describe("ported plugins, fourth batch", () => {
    it("turns <9:30pm> into a timestamp and leaves code and links alone", () => {
        const now = new Date("2026-03-04T08:00:00");
        const out = parseTime("<9:30pm>", now);
        assert.match(out, /^<t:\d+:t>$/);
        assert.equal(parseTime("<nonsense>", now), "<nonsense>");
        assert.equal(replaceTimes("see `<9:30pm>` and https://x.y/<9:30pm>", now), "see `<9:30pm>` and https://x.y/<9:30pm>");
        assert.match(replaceTimes("at <21:30> ok", now), /^at <t:\d+:t> ok$/);
    });

    it("applies sed expressions in both modes", () => {
        assert.equal(applySed("s/colour/color/g", "colour colour"), "color color");
        assert.equal(applySed("s/colour/color/", "colour colour", true), "color colour");
        assert.equal(applySed("s|a.c|X|r", "abc a.c"), "X a.c");
        assert.equal(applySed("s|a.c|X|", "abc a.c"), "abc X");
        assert.equal(applySed("not sed", "x"), undefined);
        assert.equal(applySed("s/(/x/", "x", true), undefined);
    });

    it("reads the name of a magnet link and labels the copy button", () => {
        assert.equal(magnetName("magnet:?xt=urn:btih:abc&dn=My+File.iso"), "My File.iso");
        assert.equal(magnetName("magnet:?xt=urn:btih:abc"), "unknown filename");
        assert.equal(copyLabel(true, 0), "Copied!");
        assert.equal(copyLabel(false, 5), "File too large to copy");
        assert.equal(copyLabel(false, 0), "Copy File Contents");
    });

    it("makes a masked link with invisible characters", () => {
        assert.equal(spoof("ab", () => 0), "a\u200Bb\u200B");
        assert.equal(fakeLink("", "https://x.y", false), undefined);
        const link = fakeLink("hi", "<https://x.y>", true, () => 0);
        assert.equal(link, "[h\u200Bi\u200B](<https://x.y>)");
    });

    it("converts units both ways", () => {
        const metric = convertText("it is 5 ft and 100 F", "metric");
        assert.ok(metric.some(line => line.endsWith("37.78°C")));
        assert.ok(metric.some(line => line.endsWith("1.52m")));
        assert.ok(convertText("10 miles", "metric")[0].endsWith("16.09km"));
        assert.ok(convertText("30 C", "imperial")[0].endsWith("86°F"));
        assert.deepEqual(convertText("nothing here", "metric"), []);
    });

    it("toggles and searches bookmarks", () => {
        const mark = { messageId: "1", channelId: "c", guildId: null, author: "Ana", content: "hello world", time: 1 };
        const added = toggleBookmark([], mark);
        assert.equal(added.length, 1);
        assert.deepEqual(toggleBookmark(added, mark), []);
        assert.equal(searchBookmarks(added, "WORLD").length, 1);
        assert.equal(searchBookmarks(added, "zzz").length, 0);
        assert.equal(searchBookmarks(added, "  ").length, 1);
    });

    it("offers reminder times and splits the due ones", () => {
        const now = new Date("2026-03-04T10:00:00").getTime();
        const list = presets(now);
        assert.equal(list.length, 5);
        assert.equal(list[0].at, now + 30 * 60_000);
        assert.ok(list[3].at > now);
        const reminders = [{ id: "a", messageId: "m", channelId: "c", author: "x", content: "", remindAt: now - 1 }, { id: "b", messageId: "m", channelId: "c", author: "x", content: "", remindAt: now + 1 }];
        const { due, rest } = splitDue(reminders, now);
        assert.deepEqual(due.map(entry => entry.id), ["a"]);
        assert.deepEqual(rest.map(entry => entry.id), ["b"]);
    });

    it("decides when a call should not ring", () => {
        const all = { isEnabled: true, silenceGroupCalls: true, silenceDMCalls: false };
        assert.equal(shouldSilence(3, all), true);
        assert.equal(shouldSilence(1, all), false);
        assert.equal(shouldSilence(0, all), false);
        assert.equal(shouldSilence(3, { ...all, isEnabled: false }), false);
    });

    it("picks a speed by the kind of player", () => {
        const values = { defaultVoiceMessageSpeed: 1.5, defaultVideoSpeed: 2, defaultAudioSpeed: 1.25 };
        assert.equal(speedFor("VIDEO", "", values), 2);
        assert.equal(speedFor("AUDIO", "audioElement_x", values), 1.5);
        assert.equal(speedFor("AUDIO", "other", values), 1.25);
        assert.equal(speedFor("DIV", "", values), undefined);
    });

    it("finds members of a role", () => {
        const found = membersInRole([{ userId: "1", roles: ["a"] }, { userId: "2", roles: ["b"] }], "a");
        assert.deepEqual(found.map(member => member.userId), ["1"]);
    });

    it("keeps, searches and clears notes and flags", () => {
        let notes = withNote({}, "1", "likes cats");
        assert.deepEqual(searchNotes(notes, "CATS", id => id), [["1", "likes cats"]]);
        assert.deepEqual(searchNotes(notes, "dogs", id => id), []);
        notes = withNote(notes, "1", "  ");
        assert.deepEqual(notes, {});
        let flags = withFlag({}, "1", { type: "danger", text: " be careful " });
        assert.equal(flags["1"].text, "be careful");
        flags = withFlag(flags, "1", null);
        assert.deepEqual(flags, {});
        assert.deepEqual(cleanFlags({ a: { type: "info", text: "x" }, b: { type: "nope", text: "y" }, c: 3 }), { a: { type: "info", text: "x" } });
        assert.deepEqual(cleanFlags([1, 2]), {});
    });

    it("logs voice joins, leaves, moves and camera changes of the watched channel", () => {
        const options = { join: true, video: true, stream: true };
        const join = entriesFor({ userId: "u", channelId: "w" }, undefined, "w", 5, options);
        assert.deepEqual(join.entries.map(entry => entry.type), ["join"]);
        const camera = entriesFor({ userId: "u", channelId: "w", selfVideo: true }, join.seen, "w", 6, options);
        assert.deepEqual(camera.entries.map(entry => entry.type), ["video-on"]);
        const leave = entriesFor({ userId: "u", channelId: null }, camera.seen, "w", 7, options);
        assert.deepEqual(leave.entries.map(entry => entry.type), ["leave"]);
        const elsewhere = entriesFor({ userId: "u", channelId: "x" }, undefined, "w", 8, options);
        assert.deepEqual(elsewhere.entries, []);
        assert.deepEqual(entriesFor({ userId: "u", channelId: "w" }, undefined, undefined, 9, options).entries, []);
        assert.equal(LABELS.join, "joined");
        assert.equal(MAX_ENTRIES, 500);
    });

    it("adds up voice time", () => {
        assert.equal(formatSeconds(3725), "1h 2m 5s");
        assert.equal(formatSeconds(59), "59s");
        const running = new Map([["u", 1000]]);
        const next = flushTotals({ u: 10 }, running, 6000);
        assert.equal(next.u, 15);
        assert.equal(running.get("u"), 6000);
    });

    it("counts messages by day and finds the streak", () => {
        const now = new Date("2026-03-10T12:00:00").getTime();
        const day = 24 * 60 * 60 * 1000;
        let days = {};
        for (let index = 0; index < 3; index++) days = addMessage(days, now);
        days = addMessage(days, now - day);
        days = addMessage(days, now - day);
        days = addMessage(days, now - day);
        assert.equal(sumLast(days, now, 1), 3);
        assert.equal(sumLast(days, now, 7), 6);
        assert.equal(streak(days, now, 3), 2);
        assert.equal(streak(days, now, 4), 0);
        assert.equal(startOfDay(now) <= now, true);
    });

    it("applies text replacement rules", () => {
        const rules = { simple: [{ find: "brb", replace: "be right back", onlyIfIncludes: "" }, { find: "", replace: "x", onlyIfIncludes: "" }], regex: [{ find: "/(\\d+)px/g", replace: "$1 pixels", onlyIfIncludes: "" }, { find: "/(/", replace: "x", onlyIfIncludes: "" }] };
        assert.equal(applyRules("brb 10px", rules), "be right back 10 pixels");
        assert.equal(applyRules("brb", { simple: [{ find: "brb", replace: "x", onlyIfIncludes: "needed" }], regex: [] }), "brb");
        assert.equal(stringToRegex("a+").flags, "g");
        assert.equal(stringToRegex("/a/ii").flags, "i");
    });

    it("builds the notification settings for a new server", () => {
        const values = { guild: true, messages: "3", everyone: true, role: false, highlights: true, events: true, mobilePush: true };
        assert.equal(guildSettingsBodies(values).length, 1);
        assert.equal(guildSettingsBodies(values)[0].mobile_push, false);
        assert.deepEqual(guildSettingsBodies({ ...values, messages: "1" })[1], { message_notifications: 1 });
        const now = Date.parse("2026-03-04T10:00:00Z");
        assert.equal(isNewJoin("2026-03-04T09:59:00Z", now), true);
        assert.equal(isNewJoin("2026-03-04T09:00:00Z", now), false);
        assert.equal(isNewJoin(undefined, now), false);
    });

    it("shows raw data without private fields", () => {
        const text = rawText({ id: "1", b: 1, a: 2, editHistory: [], author: { id: "2", email: "x@y.z" } }, { sort: true, strip: true });
        assert.ok(!text.includes("email"));
        assert.ok(!text.includes("editHistory"));
        assert.ok(text.indexOf("\"a\"") < text.indexOf("\"b\""));
        assert.ok(rawText({ author: { email: "x@y.z" } }, { sort: false, strip: false }).includes("email"));
        assert.deepEqual(Object.keys(sortKeys({ b: 1, a: 1 })), ["a", "b"]);
    });

    it("builds the address part for a reaction and formats exported messages", () => {
        assert.equal(reactionKey({ name: "👍" }), encodeURIComponent("👍"));
        assert.equal(reactionKey({ name: "cat", id: "12" }), "cat%3A12");
        const text = formatMessage({ id: "1", timestamp: "2026-03-04T10:00:00Z", content: "hi", author: { username: "ana", discriminator: "0" }, attachments: [{ filename: "a.png", url: "https://x/a.png" }] });
        assert.ok(text.includes("ana: hi"));
        assert.ok(text.includes("- a.png (https://x/a.png)"));
    });

    it("reads delays and splits the schedule", () => {
        assert.equal(parseDelay("10m"), 600_000);
        assert.equal(parseDelay("2h30m"), 9_000_000);
        assert.equal(parseDelay("1d 1s"), 86_401_000);
        assert.equal(parseDelay("soon"), undefined);
        assert.equal(parseDelay("0m"), undefined);
        const { due, later } = splitQueue([{ id: "b", channelId: "c", content: "", at: 20 }, { id: "a", channelId: "c", content: "", at: 5 }], 10);
        assert.deepEqual(due.map(entry => entry.id), ["a"]);
        assert.deepEqual(later.map(entry => entry.id), ["b"]);
    });
});
