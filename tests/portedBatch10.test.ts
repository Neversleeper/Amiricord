/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isServerMutedHere } from "../src/testcordplugins/AskMeToMute/index";
import { type AwayState, MAX_REPLIES, shouldReply } from "../src/testcordplugins/DMAway/index";
import { stillActive } from "../src/testcordplugins/GhostTyping/index";
import { pollText } from "../src/testcordplugins/PollMaker/index";
import { typistNamed } from "../src/vencordplugins/TypingAvatars/index";

describe("ported plugins, tenth batch", () => {
    it("makes a poll", () => {
        assert.equal(pollText("Pizza? | yes | no"), "📊 **Pizza?**\n1️⃣ yes\n2️⃣ no");
        assert.equal(pollText("only a question"), undefined);
        assert.equal(pollText("q | same | same"), undefined);
        assert.equal(pollText("q | a |  | b"), "📊 **q**\n1️⃣ a\n2️⃣ b");
        const many = pollText(`q | ${Array.from({ length: 15 }, (_, index) => `o${index}`).join(" | ")}`)!;
        assert.equal(many.split("\n").length, 11);
        assert.ok(many.length <= 2000);
    });

    it("knows a moderator mute that is meant for me", () => {
        const update = { userId: "1", channelId: "9", guildId: "5", mute: true, selfMute: false };
        assert.equal(isServerMutedHere(update, "1", "9"), true);
        assert.equal(isServerMutedHere(update, "2", "9"), false);
        assert.equal(isServerMutedHere(update, "1", "8"), false);
        assert.equal(isServerMutedHere({ ...update, selfMute: true }, "1", "9"), false);
        assert.equal(isServerMutedHere({ ...update, guildId: null }, "1", "9"), false);
        assert.equal(isServerMutedHere({ ...update, mute: false }, "1", "9"), false);
        assert.equal(isServerMutedHere(update, undefined, "9"), false);
    });

    it("keeps ghost typing only inside its time", () => {
        const started = new Map([["a", 0], ["b", 5 * 60000]]);
        assert.deepEqual(stillActive(started, 9 * 60000, 10), ["a", "b"]);
        assert.deepEqual(stillActive(started, 10 * 60000, 10), ["b"]);
        assert.deepEqual(stillActive(started, 99 * 60000, 10), []);
    });

    it("matches a typing name to one person only", () => {
        const typists = [{ id: "1", name: "Ana" }, { id: "2", name: "Leo" }, { id: "3", name: "Leo" }];
        assert.equal(typistNamed("Ana", typists)?.id, "1");
        assert.equal(typistNamed(" Ana ", typists)?.id, "1");
        assert.equal(typistNamed("Leo", typists), undefined);
        assert.equal(typistNamed("Zed", typists), undefined);
        assert.equal(typistNamed("", [{ id: "9", name: "" }]), undefined);
    });

    it("answers a direct message once per cooldown, and only the right ones", () => {
        const state = (): AwayState => ({ on: true, replied: new Map(), sent: 0 });
        const dm = { authorId: "7", guildId: null, channelType: 1, blocked: false };
        const away = state();
        assert.equal(shouldReply(away, dm, "1", 0, 30), true);
        assert.equal(shouldReply(away, dm, "1", 29 * 60000, 30), false);
        assert.equal(shouldReply(away, dm, "1", 31 * 60000, 30), true);
        assert.equal(shouldReply(away, { ...dm, authorId: "8" }, "1", 0, 30), true);
        assert.equal(shouldReply(state(), { ...dm, authorId: "1" }, "1", 0, 30), false);
        assert.equal(shouldReply(state(), { ...dm, guildId: "5" }, "1", 0, 30), false);
        assert.equal(shouldReply(state(), { ...dm, channelType: 3 }, "1", 0, 30), false);
        assert.equal(shouldReply(state(), { ...dm, blocked: true }, "1", 0, 30), false);
        assert.equal(shouldReply({ ...state(), on: false }, dm, "1", 0, 30), false);
        // The cooldown has a floor of five minutes.
        const floor = state();
        assert.equal(shouldReply(floor, dm, "1", 0, 1), true);
        assert.equal(shouldReply(floor, dm, "1", 2 * 60000, 1), false);
        const capped = { ...state(), sent: MAX_REPLIES };
        assert.equal(shouldReply(capped, dm, "1", 0, 30), false);
    });
});
