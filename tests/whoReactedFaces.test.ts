/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { avatarUrl, emojiKey, emojiMatches, faces } from "../src/vencordplugins/WhoReacted/inline";

describe("WhoReacted faces", () => {
    it("builds the picture address of a person", () => {
        assert.equal(avatarUrl({ id: "5", avatar: "abc" }), "https://cdn.discordapp.com/avatars/5/abc.webp?size=32");
        assert.equal(avatarUrl({ id: "5", avatar: "a_abc" }), "https://cdn.discordapp.com/avatars/5/a_abc.gif?size=32");
        assert.match(avatarUrl({ id: "1564847328794382408", avatar: null }), /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
        assert.equal(avatarUrl({ id: "x", avatar: null }), "https://cdn.discordapp.com/embed/avatars/0.png");
    });

    it("matches a reaction's emoji to the picture drawn for it", () => {
        assert.equal(emojiMatches({ id: null, name: "💀" }, { alt: "💀", src: "/assets/x.svg" }), true);
        assert.equal(emojiMatches({ id: null, name: "💀" }, { alt: "😀", src: "/assets/x.svg" }), false);
        assert.equal(emojiMatches({ id: "123", name: "pog" }, { alt: ":pog:", src: "https://cdn.discordapp.com/emojis/123.webp?size=48" }), true);
        assert.equal(emojiMatches({ id: "123", name: "pog" }, { alt: ":pog:", src: "https://cdn.discordapp.com/emojis/124.webp" }), false);
        assert.equal(emojiMatches({ id: null, name: null }, { alt: "", src: "" }), false);
    });

    it("limits the faces and counts the rest", () => {
        assert.deepEqual(faces([1, 2, 3], 5), { shown: [1, 2, 3], more: 0 });
        assert.deepEqual(faces([1, 2, 3, 4, 5, 6, 7], 5), { shown: [1, 2, 3, 4, 5], more: 2 });
        assert.deepEqual(faces([], 5), { shown: [], more: 0 });
        assert.deepEqual(faces([1, 2], 0), { shown: [1], more: 1 });
    });

    it("writes the emoji key for Discord's request", () => {
        assert.equal(emojiKey({ id: null, name: "💀" }), encodeURIComponent("💀"));
        assert.equal(emojiKey({ id: "123", name: "pog" }), encodeURIComponent("pog:123"));
    });
});
