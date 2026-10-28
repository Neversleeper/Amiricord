/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authorInfo, avatarUrl, isDiscordId } from "../src/plugins/Settings/authorModel";

const ID = "1564847328794382408";

describe("the Discord name and picture of an author", () => {
    it("builds the picture address on Discord's own image host, a GIF when the picture is animated", () => {
        assert.equal(avatarUrl(ID, "0123456789abcdef0123456789abcdef"), `https://cdn.discordapp.com/avatars/${ID}/0123456789abcdef0123456789abcdef.png?size=64`);
        assert.equal(avatarUrl(ID, "a_0123456789abcdef0123456789abcdef"), `https://cdn.discordapp.com/avatars/${ID}/a_0123456789abcdef0123456789abcdef.gif?size=64`);
    });

    it("gives no picture for a hash or an id that is not what Discord uses", () => {
        for (const hash of [null, undefined, "", "../x", "abc", "0123456789abcdef0123456789abcdef.png?x=1", 5]) assert.equal(avatarUrl(ID, hash), null, String(hash));
        assert.equal(avatarUrl("12", "0123456789abcdef0123456789abcdef"), null);
        assert.ok(isDiscordId(ID) && !isDiscordId("abc") && !isDiscordId(5));
    });

    it("prefers the display name, understands both shapes of Discord's user, and gives nothing without a user name", () => {
        const hash = "a_0123456789abcdef0123456789abcdef";
        assert.deepEqual(authorInfo(ID, { username: "neversleeper", globalName: "Never", avatar: hash }), { displayName: "Never", username: "neversleeper", avatarUrl: avatarUrl(ID, hash) });
        assert.equal(authorInfo(ID, { username: "neversleeper", global_name: "Never from the API" })?.displayName, "Never from the API");
        assert.deepEqual(authorInfo(ID, { username: "neversleeper" }), { displayName: "neversleeper", username: "neversleeper", avatarUrl: null });
        assert.equal(authorInfo(ID, undefined), null);
        assert.equal(authorInfo(ID, { username: "" }), null);
    });
});
