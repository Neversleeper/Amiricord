/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isApplyLabel, isCancelLabel, isCloseLabel, isGifTileLabel } from "../src/testcordplugins/PinterestTool/pinterart/labels";

describe("the words of Discord's buttons in other languages", () => {
    it("knows Apply, Cancel and Close in English and Spanish, ignoring case and spaces", () => {
        assert.ok(isApplyLabel("Apply") && isApplyLabel("  aplicar ") && isApplyLabel("APLICAR"));
        assert.ok(isCancelLabel("Cancel") && isCancelLabel("Cancelar"));
        assert.ok(isCloseLabel("Close") && isCloseLabel("Cerrar"));
    });

    it("knows them in other languages too", () => {
        assert.ok(isApplyLabel("Anwenden") && isApplyLabel("Применить") && isApplyLabel("適用"));
        assert.ok(isCancelLabel("Annuler") && isCancelLabel("Отмена") && isCancelLabel("취소"));
        assert.ok(isCloseLabel("Fermer") && isCloseLabel("閉じる"));
    });

    it("keeps the three kinds apart and refuses other words, empty or missing text", () => {
        assert.equal(isApplyLabel("Cancel"), false);
        assert.equal(isCancelLabel("Apply"), false);
        assert.equal(isCloseLabel("Apply"), false);
        assert.equal(isApplyLabel("Apply changes now"), false);
        for (const value of ["", "   ", null, undefined]) {
            assert.equal(isApplyLabel(value), false);
            assert.equal(isCancelLabel(value), false);
            assert.equal(isCloseLabel(value), false);
        }
    });

    it("tells the Choose GIF tile in any language by its short label with the word GIF", () => {
        for (const label of ["Choose GIF", "Elegir GIF", "GIF auswählen", "GIF", " Choisir un GIF ", "GIFを選択", "elegir gif"]) assert.equal(isGifTileLabel(label), true, label);
    });

    it("does not take other text for the GIF tile", () => {
        assert.equal(isGifTileLabel("Upload Image"), false);
        assert.equal(isGifTileLabel("Subir imagen"), false);
        assert.equal(isGifTileLabel("Giraffe"), false);
        assert.equal(isGifTileLabel("GIFT"), false);
        assert.equal(isGifTileLabel("x".repeat(41) + " GIF"), false, "a whole dialog's text is not a label");
        assert.equal(isGifTileLabel(""), false);
        assert.equal(isGifTileLabel(null), false);
        assert.equal(isGifTileLabel(undefined), false);
    });
});
