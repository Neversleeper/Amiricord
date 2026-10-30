/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readState, statusSettings, statusSettingsBytes } from "../src/testcordplugins/BetterUserTools/index";

describe("Off The Radar", () => {
    it("writes the status settings message: status (field 1, a string wrapper) and show current game (field 3, a bool wrapper), inside field 11", () => {
        assert.deepEqual(statusSettingsBytes("idle", false), [0x5a, 0x0c, 0x0a, 0x06, 0x0a, 0x04, 0x69, 0x64, 0x6c, 0x65, 0x1a, 0x02, 0x08, 0x00]);
        assert.deepEqual(statusSettingsBytes("online", true).slice(-4), [0x1a, 0x02, 0x08, 0x01]);
    });

    it("gives the same bytes as base64", () => {
        assert.equal(statusSettings("idle", false), Buffer.from(statusSettingsBytes("idle", false)).toString("base64"));
    });

    it("reads the saved state: off unless it says on, and keeps only a known status and a true or false", () => {
        assert.deepEqual(readState(null), { enabled: false });
        assert.deepEqual(readState("on"), { enabled: false });
        assert.deepEqual(readState({ enabled: true, prevStatus: "dnd", prevShow: false }), { enabled: true, prevStatus: "dnd", prevShow: false });
        assert.deepEqual(readState({ enabled: true, prevStatus: "<script>", prevShow: "no" }), { enabled: true, prevStatus: undefined, prevShow: undefined });
        assert.equal(readState({ enabled: "yes" }).enabled, false);
    });
});
