/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { annoil } from "../src/testcordplugins/Annoiler/index";
import { convert as bold } from "../src/testcordplugins/BoldText/index";
import { convert as clap } from "../src/testcordplugins/ClapText/index";
import { convert as leet } from "../src/testcordplugins/LeetText/index";
import { heartFor, score } from "../src/testcordplugins/ShipCalc/index";
import { convert as smallCaps } from "../src/testcordplugins/SmallCaps/index";
import { convert as spaceOut } from "../src/testcordplugins/SpaceOut/index";
import { starify } from "../src/testcordplugins/Starify/index";
import { convert as vaporwave } from "../src/testcordplugins/VaporwaveText/index";

describe("text plugins", () => {
    it("converts text the way each plugin says", () => {
        assert.equal(bold("Az9 !"), "𝐀𝐳𝟗 !");
        assert.equal(clap("a  b c"), "a 👏 b 👏 c");
        assert.equal(leet("Test"), "7357");
        assert.equal(spaceOut("abc"), "a b c");
        assert.equal(vaporwave("a b"), "ａ　ｂ");
        assert.equal(smallCaps("Hi"), "ʜɪ");
        assert.equal(starify("hey"), "✦ﾟ｡⋆ hey ⋆｡ﾟ✦");
    });

    it("puts a spoiler around every character but the spaces", () => {
        assert.equal(annoil("a b"), "||a|| ||b||");
    });

    it("gives the same ship score for a pair in any order and case", () => {
        assert.equal(score("Ana", "Bob"), score(" bob", "ANA"));
        assert.ok(score("Ana", "Bob") >= 0 && score("Ana", "Bob") <= 100);
        assert.equal(heartFor(100), "💞");
        assert.equal(heartFor(0), "💔");
    });
});
