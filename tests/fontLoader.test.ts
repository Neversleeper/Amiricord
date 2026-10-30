/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanFamily, fontCss } from "../src/equicordplugins/FontLoader/index";

describe("FontLoader", () => {
    it("accepts a plain font name and tidies its spaces", () => {
        assert.equal(cleanFamily("Nunito"), "Nunito");
        assert.equal(cleanFamily("  Fira   Sans "), "Fira Sans");
        assert.equal(cleanFamily("Roboto2"), "Roboto2");
    });

    it("refuses what could carry other CSS or is not a name", () => {
        for (const bad of ["", "   ", "A;} body{display:none", "Nunito'", "a\"b", "x/y", "<b>", "é", "x".repeat(61), 5, null]) assert.equal(cleanFamily(bad), undefined, String(bad));
    });

    it("writes the import and the font variables, with code blocks only when asked", () => {
        const css = fontCss("Fira Sans", false);
        assert.ok(css.includes("https://fonts.googleapis.com/css2?family=Fira%20Sans:wght@300;400;500;600;700&display=swap"));
        assert.ok(css.includes("--font-primary: 'Fira Sans', sans-serif !important;"));
        assert.equal(css.includes("--font-code"), false);
        assert.ok(fontCss("Fira Sans", true).includes("--font-code: 'Fira Sans', monospace !important;"));
    });

    it("writes nothing when there is no valid font", () => {
        assert.equal(fontCss("", true), "");
        assert.equal(fontCss("bad;name", true), "");
    });
});
