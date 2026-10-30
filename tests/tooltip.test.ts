/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placeTip } from "../src/api/tooltip";

const view = { width: 1000, height: 800 };
const tip = { width: 160, height: 32 };

describe("tooltip placement", () => {
    it("goes above the element, centred, with the arrow in the middle", () => {
        const spot = placeTip({ left: 400, top: 300, width: 20, height: 20 }, tip, view);
        assert.equal(spot.side, "top");
        assert.equal(spot.top, 300 - 32 - 8);
        assert.equal(spot.left, 410 - 80);
        assert.equal(spot.arrow, 80);
    });

    it("goes below when there is no room above", () => {
        const spot = placeTip({ left: 400, top: 20, width: 20, height: 20 }, tip, view);
        assert.equal(spot.side, "bottom");
        assert.equal(spot.top, 20 + 20 + 8);
    });

    it("stays inside the window and the arrow still points at the element", () => {
        const left = placeTip({ left: 0, top: 300, width: 20, height: 20 }, tip, view);
        assert.equal(left.left, 8);
        assert.equal(left.arrow, 12);
        const right = placeTip({ left: 990, top: 300, width: 10, height: 20 }, tip, view);
        assert.equal(right.left, 1000 - 160 - 8);
        assert.equal(right.arrow, 148);
    });
});
