/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRendererScript, makeBridgeKey } from "../src/preload/script";

describe("buildRendererScript", () => {
    it("hands the key to the bundle as a plain string", () => {
        const seen: unknown[] = [];
        const script = buildRendererScript("__seen(__bridgeKey);", "bkey1");
        // eslint-disable-next-line no-new-func -- the test runs the script the preload would run
        new Function("__seen", script)((value: unknown) => seen.push(value));
        assert.deepEqual(seen, ["bkey1"]);
    });

    it("keeps a hostile key inside its string", () => {
        const hostile = "\"); globalThis.__pwned = 1; (\"";
        const script = buildRendererScript("", hostile);
        // eslint-disable-next-line no-new-func -- the test runs the script the preload would run
        new Function(script)();
        assert.equal((globalThis as Record<string, unknown>).__pwned, undefined);
    });

    it("names its source so errors are attributed to the engine", () => {
        assert.match(buildRendererScript("", "k"), /\/\/# sourceURL=AmiricordRenderer$/);
    });
});

describe("makeBridgeKey", () => {
    it("is a valid identifier-like name and differs between calls", () => {
        const a = makeBridgeKey();
        const b = makeBridgeKey();
        assert.match(a, /^b[0-9a-z]+$/);
        assert.notEqual(a, b);
    });

    it("uses the random source it is given", () => {
        assert.equal(makeBridgeKey(() => 0), "b0000");
    });
});
