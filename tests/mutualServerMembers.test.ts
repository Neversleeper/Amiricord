/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { avatarFor, guildIdFromTarget, type Member, mutualIds, visibleMembers } from "../src/testcordplugins/MutualServerMembers/index";

const ID = "1564847328794382408";
const iconOf = (attribute: string | null) => ({ closest: (selector: string) => (selector.includes("guildsnav___") ? { getAttribute: (name: string) => (name === "data-list-item-id" ? attribute : null) } : null) });

describe("MutualServerMembers: which server was clicked", () => {
    it("reads the server id from the icon in the server list", () => {
        assert.equal(guildIdFromTarget(iconOf(`guildsnav___${ID}`)), ID);
    });

    it("gives nothing for a click elsewhere, or for an icon that is not a server (home, a folder, a wrong id)", () => {
        assert.equal(guildIdFromTarget({ closest: () => null }), undefined);
        assert.equal(guildIdFromTarget(iconOf("guildsnav___home")), undefined);
        assert.equal(guildIdFromTarget(iconOf("guildsnav___")), undefined);
        assert.equal(guildIdFromTarget(iconOf(null)), undefined);
        assert.equal(guildIdFromTarget({}), undefined);
        assert.equal(guildIdFromTarget(null), undefined);
        assert.equal(guildIdFromTarget(undefined), undefined);
    });
});

describe("MutualServerMembers: who is in both servers", () => {
    it("gives the ids found in both lists, in the order of the second, each once", () => {
        assert.deepEqual(mutualIds(["1", "2", "3"], ["3", "9", "1", "3"]), ["3", "1"]);
    });

    it("gives nothing when there is nothing in common or a list is empty", () => {
        assert.deepEqual(mutualIds(["1"], ["2"]), []);
        assert.deepEqual(mutualIds([], ["1"]), []);
        assert.deepEqual(mutualIds(["1"], []), []);
    });
});

describe("MutualServerMembers: the pictures", () => {
    it("uses the person's own picture when the hash looks like Discord's", () => {
        assert.equal(avatarFor(ID, "0123456789abcdef0123456789abcdef"), `https://cdn.discordapp.com/avatars/${ID}/0123456789abcdef0123456789abcdef.png?size=32`);
    });

    it("uses one of Discord's six default pictures, always the same for the same id, when there is no usable hash", () => {
        const expected = `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(ID) >> 22n) % 6n)}.png`;
        for (const hash of [undefined, null, "", "../x", "abc", 5]) assert.equal(avatarFor(ID, hash), expected, String(hash));
        assert.equal(avatarFor("not an id", undefined), "https://cdn.discordapp.com/embed/avatars/0.png");
    });
});

describe("MutualServerMembers: the list that is shown", () => {
    const member = (id: string, name: string, bot = false): Member => ({ id, name, bot, avatar: "" });
    const all = [member("1", "zoe"), member("2", "Ana"), member("3", "Robo", true), member("4", "ANDREA")];

    it("sorts by name and leaves the bots out unless they are asked for", () => {
        assert.deepEqual(visibleMembers(all, "", false).map(m => m.id), ["2", "4", "1"]);
        assert.deepEqual(visibleMembers(all, "", true).map(m => m.id), ["2", "4", "3", "1"]);
    });

    it("finds the text anywhere in the name, in any case, ignoring spaces around it", () => {
        assert.deepEqual(visibleMembers(all, "  an  ", false).map(m => m.id), ["2", "4"]);
        assert.deepEqual(visibleMembers(all, "zzz", true), []);
    });

    it("leaves the given list as it was", () => {
        const copy = [...all];
        visibleMembers(all, "", true);
        assert.deepEqual(all, copy);
    });
});
