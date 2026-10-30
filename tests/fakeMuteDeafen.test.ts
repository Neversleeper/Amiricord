/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forcedVoiceState, matchesKeybind, parseKeybind, shownMute } from "../src/testcordplugins/FakeMuteDeafen/index";

describe("FakeMuteDeafen", () => {
    it("a fake deafen also shows mute when autoMute is on", () => {
        assert.equal(shownMute({ mute: false, deaf: true }, true), true);
        assert.equal(shownMute({ mute: false, deaf: true }, false), false);
        assert.equal(shownMute({ mute: true, deaf: false }, false), true);
    });

    it("forces the fake values and leaves the real ones alone", () => {
        const data = { self_mute: false, self_deaf: false, self_video: false };
        forcedVoiceState(data, { mute: false, deaf: true, video: false }, true);
        assert.deepEqual(data, { self_mute: true, self_deaf: true, self_video: false });
        const real = { self_mute: true, self_deaf: true, self_video: true };
        forcedVoiceState(real, { mute: false, deaf: false, video: false }, true);
        assert.deepEqual(real, { self_mute: true, self_deaf: true, self_video: true });
    });

    it("reads a key shortcut and matches only that exact key combination", () => {
        assert.deepEqual(parseKeybind("Ctrl+J"), { ctrl: true, alt: false, shift: false, meta: false, key: "j" });
        const press = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: "J" };
        assert.equal(matchesKeybind(press, "ctrl+j"), true);
        assert.equal(matchesKeybind({ ...press, shiftKey: true }, "ctrl+j"), false);
        assert.equal(matchesKeybind(press, "ctrl+"), false);
    });
});
