/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { moveTarget } from "../src/testcordplugins/FollowMe/index";
import { changesFor, readActions, withAction } from "../src/testcordplugins/UserTools/index";

const A = "100000000000000001";
const B = "100000000000000002";
const allowed = () => true;

describe("UserTools", () => {
    it("reads the saved list: plain ids with an action on, nothing else", () => {
        assert.deepEqual(readActions({ [A]: { disconnect: true }, [B]: { mute: false }, nope: { mute: true }, "": 1 }), { [A]: { disconnect: true, mute: false, deafen: false } });
        assert.deepEqual(readActions(null), {});
        assert.deepEqual(readActions([A]), {});
        assert.deepEqual(readActions({ [A]: "mute" }), {});
    });

    it("switches an action and takes the person out when nothing is left on, without touching the old list", () => {
        const first = withAction({}, A, "mute", true);
        assert.deepEqual(first, { [A]: { disconnect: false, mute: true, deafen: false } });
        const second = withAction(first, A, "deafen", true);
        assert.equal(second[A]!.mute && second[A]!.deafen, true);
        assert.deepEqual(withAction(first, A, "mute", false), {});
        assert.equal(first[A]!.mute, true);
    });

    it("asks for nothing when the person is not in voice or nothing is on", () => {
        assert.deepEqual(changesFor({ disconnect: true, mute: true, deafen: true }, { channelId: null }, allowed), []);
        assert.deepEqual(changesFor({ disconnect: true, mute: true, deafen: true }, undefined, allowed), []);
        assert.deepEqual(changesFor(undefined, { channelId: "1" }, allowed), []);
        assert.deepEqual(changesFor({ disconnect: false, mute: false, deafen: false }, { channelId: "1" }, allowed), []);
    });

    it("asks for each action that is on, skipping mute and deafen the person already has", () => {
        assert.deepEqual(changesFor({ disconnect: true, mute: true, deafen: true }, { channelId: "1", mute: false, deaf: false }, allowed), [{ channel_id: null }, { mute: true }, { deaf: true }]);
        assert.deepEqual(changesFor({ disconnect: false, mute: true, deafen: true }, { channelId: "1", mute: true, deaf: false }, allowed), [{ deaf: true }]);
    });

    it("never asks for what the owner may not do", () => {
        assert.deepEqual(changesFor({ disconnect: true, mute: true, deafen: true }, { channelId: "1" }, permission => permission === "mute"), [{ mute: true }]);
        assert.deepEqual(changesFor({ disconnect: true, mute: true, deafen: true }, { channelId: "1" }, () => false), []);
    });
});

describe("FollowMe", () => {
    it("moves the person to the channel you are in, in the same server", () => {
        assert.equal(moveTarget({ channelId: "c1", guildId: "g1" }, { channelId: "c2", guildId: "g1" }), "c1");
        assert.equal(moveTarget({ channelId: "c1", guildId: "g1" }, undefined), "c1");
    });

    it("does nothing when you are not in a server voice channel, they are already with you, or they are in another server", () => {
        assert.equal(moveTarget(undefined, { channelId: "c2", guildId: "g1" }), undefined);
        assert.equal(moveTarget({ channelId: null, guildId: "g1" }, { channelId: "c2", guildId: "g1" }), undefined);
        assert.equal(moveTarget({ channelId: "c1", guildId: null }, { channelId: "c2" }), undefined);
        assert.equal(moveTarget({ channelId: "c1", guildId: "g1" }, { channelId: "c1", guildId: "g1" }), undefined);
        assert.equal(moveTarget({ channelId: "c1", guildId: "g1" }, { channelId: "c2", guildId: "g2" }), undefined);
    });
});
