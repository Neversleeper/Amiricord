/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readBuildNumber } from "../src/renderer/buildNumber";

describe("readBuildNumber", () => {
    it("reads the number Discord writes as text, and a plain number", () => {
        assert.equal(readBuildNumber({ GLOBAL_ENV: { BUILD_NUMBER: "650101" } }), 650101);
        assert.equal(readBuildNumber({ GLOBAL_ENV: { BUILD_NUMBER: 650101 } }), 650101);
        assert.equal(readBuildNumber({ GLOBAL_ENV: { BUILD_NUMBER: "1" } }), 1);
    });

    it("gives null for anything that does not look like a build number", () => {
        const bad: unknown[] = [
            undefined, null, 5, "x", {}, { GLOBAL_ENV: null }, { GLOBAL_ENV: "x" }, { GLOBAL_ENV: {} },
            { GLOBAL_ENV: { BUILD_NUMBER: "" } }, { GLOBAL_ENV: { BUILD_NUMBER: "0" } }, { GLOBAL_ENV: { BUILD_NUMBER: "-5" } },
            { GLOBAL_ENV: { BUILD_NUMBER: "12abc" } }, { GLOBAL_ENV: { BUILD_NUMBER: "1.5" } }, { GLOBAL_ENV: { BUILD_NUMBER: " 12" } },
            { GLOBAL_ENV: { BUILD_NUMBER: "99999999999" } }, { GLOBAL_ENV: { BUILD_NUMBER: NaN } }, { GLOBAL_ENV: { BUILD_NUMBER: [650101] } },
            { GLOBAL_ENV: { BUILD_NUMBER: { toString: () => "650101" } } }
        ];
        for (const value of bad) assert.equal(readBuildNumber(value), null, JSON.stringify(value));
    });

    it("survives getters that throw", () => {
        assert.equal(readBuildNumber({ get GLOBAL_ENV(): never { throw new Error("no"); } }), null);
        assert.equal(readBuildNumber({ GLOBAL_ENV: { get BUILD_NUMBER(): never { throw new Error("no"); } } }), null);
    });
});
