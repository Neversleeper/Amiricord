/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isChannelPath, navigate, type NavigatePage } from "../src/api/navigate";
import { searchVoiceChannels } from "../src/equicordplugins/VoiceChannelSearch/index";
import { channelPath, remember } from "../src/testcordplugins/RecentChannelSwitcher/index";

const G = "111111111111111111";
const C = "222222222222222222";
const M = "333333333333333333";

function fakePage(pathname = "/channels/@me", fail = false) {
    const events: string[] = [];
    const pushed: string[] = [];
    class FakePopState { constructor(readonly type: string) { events.push(type); } }
    const page = {
        history: { pushState: (_state: unknown, _unused: string, url: string) => { if (fail) throw new Error("no"); pushed.push(url); } },
        location: { pathname },
        dispatchEvent: () => true,
        PopStateEvent: FakePopState
    } as unknown as NavigatePage;
    return { page, events, pushed };
}

describe("going to a channel from a plugin", () => {
    it("accepts only channel addresses", () => {
        assert.equal(isChannelPath("/channels/@me"), true);
        assert.equal(isChannelPath(`/channels/@me/${C}`), true);
        assert.equal(isChannelPath(`/channels/${G}/${C}`), true);
        assert.equal(isChannelPath(`/channels/${G}/${C}/${M}`), true);
        assert.equal(isChannelPath("/store"), false);
        assert.equal(isChannelPath(`/channels/${G}`), false);
        assert.equal(isChannelPath(`/channels/${G}/${C}/`), false);
        assert.equal(isChannelPath(`/channels/${G}/${C}?x=1`), false);
        assert.equal(isChannelPath("https://evil.example/channels/@me"), false);
        assert.equal(isChannelPath(5), false);
        assert.equal(isChannelPath(undefined), false);
    });

    it("pushes the address and tells the page, once", () => {
        const { page, events, pushed } = fakePage();
        assert.equal(navigate(page, `/channels/${G}/${C}`), true);
        assert.deepEqual(pushed, [`/channels/${G}/${C}`]);
        assert.deepEqual(events, ["popstate"]);
    });

    it("does nothing when already there, for a bad address, or when the page refuses", () => {
        const there = fakePage(`/channels/${G}/${C}`);
        assert.equal(navigate(there.page, `/channels/${G}/${C}`), true);
        assert.deepEqual(there.pushed, []);
        const bad = fakePage();
        assert.equal(navigate(bad.page, "/settings"), false);
        assert.deepEqual(bad.pushed, []);
        assert.equal(navigate(fakePage("/channels/@me", true).page, `/channels/${G}/${C}`), false);
    });

    it("remembers recent channels and builds their addresses", () => {
        const list = remember(remember([], { channelId: "a", guildId: "g" }, 3), { channelId: "b", guildId: null }, 3);
        assert.deepEqual(list.map(entry => entry.channelId), ["b", "a"]);
        assert.deepEqual(remember(list, { channelId: "a", guildId: "g" }, 3).map(entry => entry.channelId), ["a", "b"]);
        assert.equal(remember(list, { channelId: "c", guildId: null }, 2).length, 2);
        assert.equal(channelPath({ channelId: "5", guildId: "7" }), "/channels/7/5");
        assert.equal(channelPath({ channelId: "5", guildId: null }), "/channels/@me/5");
    });

    it("searches voice channels by channel or server name", () => {
        const all = [
            { id: "1", name: "General", guildId: "g1", guildName: "Zeta" },
            { id: "2", name: "Music", guildId: "g2", guildName: "Alpha" },
            { id: "3", name: "Chill", guildId: "g2", guildName: "Alpha" }
        ];
        assert.deepEqual(searchVoiceChannels(all, "").map(channel => channel.id), ["3", "2", "1"]);
        assert.deepEqual(searchVoiceChannels(all, "MUS").map(channel => channel.id), ["2"]);
        assert.deepEqual(searchVoiceChannels(all, "alpha").map(channel => channel.id), ["3", "2"]);
        assert.deepEqual(searchVoiceChannels(all, "zzz"), []);
    });
});
