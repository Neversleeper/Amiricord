/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tokenText } from "../src/testcordplugins/GetMyToken/index";

describe("GetMyToken: what the window shows", () => {
    const FAKE = "fake-token-aaaaaaaaaaaaaaaa.bbbbbb";

    it("hides a token behind dots (at most 40) until it is shown", () => {
        assert.equal(tokenText(FAKE, false), "•".repeat(FAKE.length));
        assert.equal(tokenText("a".repeat(100), false), "•".repeat(40));
        assert.equal(tokenText(FAKE, true), FAKE);
    });

    it("never gives the token away while it is hidden", () => {
        assert.equal(tokenText(FAKE, false).includes("fake"), false);
    });

    it("says so in words when there is no token, hidden or shown", () => {
        assert.equal(tokenText(null, false), "Your token could not be found.");
        assert.equal(tokenText(null, true), "Your token could not be found.");
        assert.equal(tokenText("", true), "Your token could not be found.");
    });
});
