/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isBigTile, isGifTileLabel, isModalDialog } from "../src/testcordplugins/PinterestTool/pinterart/labels";

const dialog = (attributes: Record<string, string>) => ({ getAttribute: (name: string) => attributes[name] ?? null });

describe("Pinterest Tool: which dialogs get the Pinterest button", () => {
    it("takes Discord's own windows, which say aria-modal true (the \"Select an image\" one does)", () => {
        assert.equal(isModalDialog(dialog({ "aria-modal": "true", "aria-label": "Selecciona una imagen" })), true);
    });

    it("leaves out a pop-up that only has the role dialog, like the picker of GIFs, stickers and emoji (it has no aria-modal)", () => {
        assert.equal(isModalDialog(dialog({ "aria-label": "Selector de expresiones" })), false);
        assert.equal(isModalDialog(dialog({ "aria-modal": "false" })), false);
        assert.equal(isModalDialog(dialog({ "aria-modal": "" })), false);
    });
});

describe("Pinterest Tool: the two big tiles of the picker", () => {
    it("counts a box of 150 by 100 or more as a tile", () => {
        assert.equal(isBigTile({ width: 150, height: 100 }), true);
        assert.equal(isBigTile({ width: 300, height: 200 }), true);
    });

    it("does not count a small tab, like the word GIF at the top of the expressions picker", () => {
        assert.equal(isBigTile({ width: 40, height: 28 }), false);
        assert.equal(isBigTile({ width: 149, height: 100 }), false);
        assert.equal(isBigTile({ width: 150, height: 99 }), false);
        assert.equal(isBigTile({ width: 0, height: 0 }), false);
    });

    it("still finds the label of the Choose GIF tile in other languages, and the tab named GIF counts as a label too (which is why the size check is needed)", () => {
        for (const text of ["Choose GIF", "Elegir GIF", "GIF auswählen"]) assert.equal(isGifTileLabel(text), true, text);
        assert.equal(isGifTileLabel("GIF"), true);
        assert.equal(isGifTileLabel("Stickers"), false);
    });
});
