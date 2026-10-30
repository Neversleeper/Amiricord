/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_ALIVE, sparklesFor } from "../src/testcordplugins/ClickSparkles/index";
import { isSuggestedHeader } from "../src/testcordplugins/HideSuggestedChannels/index";
import { cssFor } from "../src/testcordplugins/NoButtons/index";
import { typingLabel } from "../src/testcordplugins/ShowTypingUsers/index";
import { countLabel, isFull } from "../src/testcordplugins/VoiceCount/index";
import { sanitize } from "../src/testcordplugins/ZeroWidthSanitizer/index";

describe("ported plugins, ninth batch", () => {
    it("makes the sparkles of a click", () => {
        const sparkles = sparklesFor(6, () => 0.5);
        assert.equal(sparkles.length, 6);
        assert.deepEqual(sparkles[0], { dx: 0, dy: -30, color: "#b967ff" });
        assert.equal(sparklesFor(99, Math.random).length, 16);
        assert.equal(sparklesFor(-3, Math.random).length, 0);
        assert.equal(sparklesFor(1, () => 0.9999)[0].color, "#05ffa1");
        assert.ok(MAX_ALIVE >= 16);
    });

    it("hides only the buttons that are switched on", () => {
        assert.equal(cssFor(() => false), "");
        const css = cssFor(setting => setting === "hideGiftButton");
        assert.match(css, /\[aria-label="Send a gift"\]/);
        assert.doesNotMatch(css, /GIF picker/);
        assert.match(css, /display: none !important/);
        assert.match(cssFor(setting => setting === "hideEmojiButton"), /Add Emoji/);
    });

    it("knows the header of the suggested section", () => {
        assert.equal(isSuggestedHeader("  Suggested ", "suggested"), true);
        assert.equal(isSuggestedHeader("Sugeridos", "Suggested"), false);
        assert.equal(isSuggestedHeader("", ""), false);
        assert.equal(isSuggestedHeader(null, "Suggested"), false);
    });

    it("says who is typing", () => {
        assert.equal(typingLabel([], 3), "");
        assert.equal(typingLabel(["Ana"], 3), "Ana is typing...");
        assert.equal(typingLabel(["Ana", "Leo"], 3), "Ana and Leo are typing...");
        assert.equal(typingLabel(["Ana", "Leo", "Mia"], 3), "Ana, Leo and Mia are typing...");
        assert.equal(typingLabel(["Ana", "Leo", "Mia", "Ian"], 3), "Ana, Leo, Mia and 1 other are typing...");
        assert.equal(typingLabel(["Ana", "Leo", "Mia", "Ian", "Zoe"], 2), "Ana, Leo and 3 others are typing...");
    });

    it("writes the number of people in a voice channel", () => {
        assert.equal(countLabel(0, 0, true, true), null);
        assert.equal(countLabel(0, 0, true, false), "0");
        assert.equal(countLabel(3, 0, true, true), "3");
        assert.equal(countLabel(3, 10, true, true), "3/10");
        assert.equal(countLabel(3, 10, false, true), "3");
        assert.equal(isFull(10, 10), true);
        assert.equal(isFull(9, 10), false);
        assert.equal(isFull(50, 0), false);
    });

    it("takes out hidden characters and keeps the ones that are needed", () => {
        const keep = { removeDirectionMarks: false };
        assert.deepEqual(sanitize("hel​lo﻿", keep), { result: "hello", removed: 2 });
        assert.deepEqual(sanitize("plain text", keep), { result: "plain text", removed: 0 });
        // A family emoji is joined with the joiner; it must stay whole.
        const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
        assert.deepEqual(sanitize(family, keep), { result: family, removed: 0 });
        // A joiner between letters is a mark.
        assert.deepEqual(sanitize("a‍b", keep), { result: "ab", removed: 1 });
        // Persian uses the non-joiner inside words.
        const persian = "می‌خواهم";
        assert.deepEqual(sanitize(persian, keep), { result: persian, removed: 0 });
        assert.deepEqual(sanitize("a‌b", keep), { result: "ab", removed: 1 });
        // Direction marks are kept unless asked.
        assert.equal(sanitize("a‎b", keep).removed, 0);
        assert.deepEqual(sanitize("a‎b", { removeDirectionMarks: true }), { result: "ab", removed: 1 });
    });
});
