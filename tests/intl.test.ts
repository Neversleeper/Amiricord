/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compileModule } from "../src/webpack/compileModule";
import { expandIntl, hashMessageKey, xxhash64 } from "../src/webpack/intl";

describe("intl keys in finds and matches", () => {
    it("computes xxHash64 as the published algorithm does", () => {
        assert.equal(xxhash64(""), 0xef46db3751d8e999n);
        assert.equal(xxhash64("abc"), 0x44bc2cf5ad770999n);
        // 32 bytes or more go through the four-lane loop
        assert.equal(xxhash64("Nobody inspects the spammish repetition"), 0xfbcea83c8a378bf1n);
    });

    it("turns a key into six characters", () => {
        assert.equal(hashMessageKey("COPY_MESSAGE_LINK").length, 6);
        assert.equal(hashMessageKey("COPY_MESSAGE_LINK"), hashMessageKey("COPY_MESSAGE_LINK"));
        assert.notEqual(hashMessageKey("COPY_MESSAGE_LINK"), hashMessageKey("PIN_MESSAGE"));
    });

    it("writes the hash as a property or as an index, and leaves other text alone", () => {
        const hash = hashMessageKey("PIN_MESSAGE");
        const plain = /^[A-Za-z_$]/.test(hash) && !hash.includes("+") && !hash.includes("/");
        assert.equal(expandIntl("a#{intl::PIN_MESSAGE}b", false), plain ? `a.${hash}b` : `a["${hash}"]b`);
        assert.equal(expandIntl("#{intl::PIN_MESSAGE::hash}", false), hash);
        assert.equal(expandIntl("#{intl::PIN_MESSAGE::raw}", false), ".PIN_MESSAGE");
        assert.equal(expandIntl("nothing here", true), "nothing here");
    });

    it("finds a module and patches it by the key", () => {
        const hash = hashMessageKey("PIN_MESSAGE");
        const access = /^[A-Za-z_$]/.test(hash) && !hash.includes("+") && !hash.includes("/") ? `.${hash}` : `["${hash}"]`;
        const source = `function(e,t,n){let r=t.t${access};return r}`;
        const result = compileModule("1", source, [{
            plugin: "P",
            find: "t.t#{intl::PIN_MESSAGE}",
            replacements: [{ match: /let (\i)=t\.t#{intl::PIN_MESSAGE}/, replace: "let $1=1" }]
        }]);
        assert.equal(result.changed, true);
        assert.match(result.code, /let r=1/);
    });
});
