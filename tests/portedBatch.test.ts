/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLurkable, timeLeft } from "../src/equicordplugins/BetterInvites/index";
import { parseUserTags, usersWithTags } from "../src/equicordplugins/FriendTags/index";
import { channelName, isExempted } from "../src/equicordplugins/Ghosted/index";
import { firstMessageOf } from "../src/equicordplugins/LastActive/index";
import { OUTGOING_REQUEST } from "../src/equicordplugins/PendingFriendRequest/index";
import { pickUsers } from "../src/equicordplugins/UniversalMention/index";
import { customStatusSettings } from "../src/testcordplugins/ProfileCopyButton/index";
import { matchExperiment } from "../src/vencordplugins/Experiments/index";

describe("LastActive", () => {
    it("takes the first message of the person from Discord's grouped answer", () => {
        const answer = { body: { messages: [[{ id: "1", author: { id: "other" } }, { id: "2", author: { id: "me" } }], [{ id: "3", author: { id: "me" } }]] } };
        assert.equal(firstMessageOf(answer, "me"), "2");
        assert.equal(firstMessageOf(answer, "nobody"), null);
        assert.equal(firstMessageOf({}, "me"), null);
    });
});

describe("PendingFriendRequest", () => {
    it("uses Discord's number for a request you sent", () => {
        assert.equal(OUTGOING_REQUEST, 4);
    });
});

describe("UniversalMention", () => {
    it("keeps everybody, or only people with a direct message when asked", () => {
        const all = [{ id: "a" }, { id: "b" }];
        assert.deepEqual(pickUsers(all, false, () => false), all);
        assert.deepEqual(pickUsers(all, true, id => id === "b"), [{ id: "b" }]);
    });
});

describe("FriendTags", () => {
    it("reads the tags after & in a search", () => {
        assert.deepEqual(parseUserTags("&friends &work "), ["friends", "work"]);
        assert.deepEqual(parseUserTags("friends"), []);
        assert.deepEqual(parseUserTags("& "), []);
    });

    it("gives the people of the named tags among the candidates, once each, ignoring case and empty tags", () => {
        const saved = [{ tagName: "Work", userIds: ["a", "b"] }, { tagName: "", userIds: ["c"] }, { tagName: "family", userIds: [] }];
        assert.deepEqual(usersWithTags("&work", saved, ["a", "a", "z", "b"]), ["a", "b"]);
        assert.deepEqual(usersWithTags("&family", saved, ["a"]), []);
        assert.deepEqual(usersWithTags("nothing", saved, ["a"]), []);
    });
});

describe("Ghosted", () => {
    it("leaves out channels by id and group chats when asked", () => {
        const group = { id: "g", isGroupDM: () => true };
        const direct = { id: "d", isGroupDM: () => false };
        assert.equal(isExempted("x, d", false, direct), true);
        assert.equal(isExempted("", true, group), true);
        assert.equal(isExempted("", false, group), false);
        assert.equal(isExempted("", true, direct), false);
    });

    it("names a direct message after the other person and a group chat after its name", () => {
        const getUser = (id: string) => (id === "u" ? { username: "ana" } : undefined);
        assert.equal(channelName({ isGroupDM: () => false, recipients: ["u"] }, getUser), "ana");
        assert.equal(channelName({ isGroupDM: () => false, recipients: ["x"] }, getUser), "Unknown User");
        assert.equal(channelName({ isGroupDM: () => true, name: "" }, getUser), "Unnamed Group");
        assert.equal(channelName(undefined, getUser), "Unknown");
    });
});

describe("Experiments", () => {
    it("matches an experiment link by label, ignoring symbols and case", () => {
        assert.equal(matchExperiment("dev://experiment/My_Cool-Test", "my cool test"), true);
        assert.equal(matchExperiment("dev://experiment/other", "my cool test"), false);
        assert.equal(matchExperiment("dev://experiment/x", "!!!"), false);
    });
});

describe("ProfileCopyButton custom status", () => {
    it("writes status (11) > customStatus (2) with every field, so nothing old stays", () => {
        const bytes = Buffer.from(customStatusSettings("hi", "1402673636464398508", "WW", 1000), "base64");
        assert.equal(bytes[0], (11 << 3) | 2);
        assert.equal(bytes[1], bytes.length - 2);
        assert.equal(bytes[2], (2 << 3) | 2);
        assert.equal(bytes[3], bytes.length - 4);
        const custom = bytes.subarray(4);
        assert.deepEqual([...custom.subarray(0, 4)], [0x0a, 2, 0x68, 0x69]);
        assert.equal(custom[4], (2 << 3) | 1);
        assert.equal(custom.readBigUInt64LE(5), 1402673636464398508n);
        assert.deepEqual([...custom.subarray(13, 17)], [0x1a, 2, 0x57, 0x57]);
        assert.equal(custom[17], (4 << 3) | 1);
        assert.equal(custom.readBigUInt64LE(18), 0n);
        assert.equal(custom[26], (5 << 3) | 1);
        assert.equal(custom.readBigUInt64LE(27), 1000n);
    });

    it("writes an empty text and no emoji as zeros and empty strings", () => {
        const custom = Buffer.from(customStatusSettings("", "0", "", 5), "base64").subarray(4);
        assert.deepEqual([...custom.subarray(0, 2)], [0x0a, 0]);
        assert.equal(custom.readBigUInt64LE(3), 0n);
        assert.deepEqual([...custom.subarray(11, 13)], [0x1a, 0]);
    });
});

describe("BetterInvites", () => {
    it("lets a visitor in only for servers open to discovery", () => {
        assert.equal(isLurkable({ features: ["DISCOVERABLE", "COMMUNITY"] }), true);
        assert.equal(isLurkable({ features: ["COMMUNITY"] }), false);
        assert.equal(isLurkable(undefined), false);
    });
});

describe("BetterInvites time left", () => {
    it("writes the time left without leading zero parts", () => {
        assert.equal(timeLeft(0), "expired");
        assert.equal(timeLeft(45 * 1000), "45s");
        assert.equal(timeLeft((3 * 60 + 5) * 1000), "3m 5s");
        assert.equal(timeLeft((2 * 3600 + 30 * 60 + 1) * 1000), "2h 30m 1s");
        assert.equal(timeLeft((29 * 86400 + 3 * 3600) * 1000), "29d 3h 0m 0s");
    });
});
