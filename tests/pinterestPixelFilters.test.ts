/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type Adjustments, NEUTRAL } from "../src/testcordplugins/PinterestTool/editorModel";
import { contrastFactor, filterPixels, hueMatrix, TINT_STRENGTH } from "../src/testcordplugins/PinterestTool/pixelFilters";

const run = (pixel: number[], changes: Partial<Adjustments>) => {
    const data = new Uint8ClampedArray(pixel);
    filterPixels(data, { ...NEUTRAL, ...changes });
    return [...data];
};

describe("Pinterest editor: the colour maths", () => {
    it("does nothing when the colours do nothing", () => {
        assert.deepEqual(run([100, 150, 200, 255], {}), [100, 150, 200, 255]);
        assert.deepEqual(run([100, 150, 200, 255], { tint: "#ff0000" }), [100, 150, 200, 255], "a colour without an amount changes nothing");
    });

    it("brightness adds or takes away", () => {
        assert.deepEqual(run([100, 150, 200, 255], { brightness: 10 }), [126, 176, 226, 255]);
        assert.deepEqual(run([100, 150, 200, 255], { brightness: -100 }), [0, 0, 0, 255]);
        assert.deepEqual(run([100, 150, 200, 255], { brightness: -20 }), [49, 99, 149, 255]);
        assert.deepEqual(run([100, 150, 200, 255], { brightness: 100 }), [255, 255, 255, 255]);
    });

    it("contrast pushes away from the middle", () => {
        assert.deepEqual(run([100, 150, 200, 255], { contrast: 100 }), [0, 255, 255, 255]);
        const flat = run([100, 150, 200, 255], { contrast: -100 });
        assert.ok(flat.slice(0, 3).every(value => Math.abs(value - 128) < 2), "everything goes near grey");
        assert.deepEqual(run([128, 128, 128, 255], { contrast: 60 }), [128, 128, 128, 255], "the middle stays");
    });

    it("saturation: none makes grey, more keeps the order of the colours", () => {
        assert.deepEqual(run([100, 150, 200, 255], { saturation: -100 }), [143, 143, 143, 255]);
        const more = run([100, 150, 200, 255], { saturation: 50 });
        assert.ok(more[0] < 100 && more[2] > 200, "red goes down and blue up");
        assert.deepEqual(run([90, 90, 90, 255], { saturation: 100 }), [90, 90, 90, 255], "grey has no colour to push");
    });

    it("black and white mixes towards the brightness of each pixel", () => {
        assert.deepEqual(run([100, 150, 200, 255], { grayscale: 100 }), [143, 143, 143, 255]);
        const half = run([100, 150, 200, 255], { grayscale: 50 });
        assert.deepEqual(half, [Math.round(100 + (142.98 - 100) / 2), Math.round(150 + (142.98 - 150) / 2), Math.round(200 + (142.98 - 200) / 2), 255]);
    });

    it("sepia gives warm tones", () => {
        assert.deepEqual(run([100, 100, 100, 255], { sepia: 100 }), [135, 120, 94, 255]);
        const half = run([100, 100, 100, 255], { sepia: 50 });
        assert.deepEqual(half, [Math.round(100 + 35.1 / 2), Math.round(100 + 20.3 / 2), Math.round(100 - 6.3 / 2), 255]);
    });

    it("hue turns the colours round the grey axis", () => {
        assert.deepEqual(run([255, 0, 0, 255], { hue: 180 }), [0, 109, 109, 255]);
        assert.deepEqual(run([100, 150, 200, 255], { hue: 0 }), [100, 150, 200, 255]);
        assert.deepEqual(run([90, 90, 90, 255], { hue: 90 }), [90, 90, 90, 255], "grey stays grey");
        const turned = run([255, 0, 0, 255], { hue: 120 });
        assert.ok(turned[1] > turned[0] && turned[1] > turned[2], "red turned by 120 degrees looks green");
    });

    it("hue turns every channel by its own row of the matrix", () => {
        assert.deepEqual(run([100, 150, 200, 255], { hue: 90 }), [200, 122, 186, 255]);
    });

    it("a tint mixes a colour over the picture, as much as asked and never more than the limit", () => {
        assert.deepEqual(run([100, 100, 100, 255], { tint: "#ff0000", tintAmount: 100 }), [193, 40, 40, 255]);
        assert.equal(TINT_STRENGTH, 0.6);
        assert.deepEqual(run([100, 100, 100, 255], { tint: "#ff0000", tintAmount: 50 }), [147, 70, 70, 255]);
        assert.deepEqual(run([100, 100, 100, 255], { tint: "#0000FF", tintAmount: 100 }), [40, 40, 193, 255], "capital letters read the same");
    });

    it("never touches alpha, changes every pixel, and ignores bytes that do not make a whole pixel", () => {
        const data = new Uint8ClampedArray([100, 100, 100, 77, 50, 50, 50, 0, 9, 9, 9]);
        filterPixels(data, { ...NEUTRAL, brightness: 20 });
        assert.deepEqual([...data], [151, 151, 151, 77, 101, 101, 101, 0, 9, 9, 9]);
    });

    it("works on a plain list of numbers too, and keeps values in 0 to 255", () => {
        const data = [250, 5, 128, 255];
        filterPixels(data, { ...NEUTRAL, contrast: 100 });
        assert.deepEqual(data, [255, 0, 128, 255]);
    });

    it("applies the steps in order: brightness first, then contrast, and so on", () => {
        const both = run([100, 150, 200, 255], { brightness: 20, contrast: 100 });
        const brightnessOnly = run([100, 150, 200, 255], { brightness: 20 });
        const contrastOnly = run([100, 150, 200, 255], { contrast: 100 });
        assert.notDeepEqual(both, brightnessOnly);
        assert.notDeepEqual(both, contrastOnly);
        assert.deepEqual(both, [Math.max(0, Math.min(255, Math.round(contrastFactor(100) * (100 + 51 - 128) + 128))), 255, 255, 255]);
    });

    it("contrastFactor and hueMatrix give the known values", () => {
        assert.equal(contrastFactor(0), 1);
        assert.ok(Math.abs(contrastFactor(100) - 129.5) < 1e-6);
        assert.ok(contrastFactor(-100) < 0.1 && contrastFactor(-100) > 0);
        const identity = hueMatrix(0);
        [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, i) => assert.ok(Math.abs(identity[i] - value) < 1e-9, `cell ${i}`));
        const full = hueMatrix(360);
        [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, i) => assert.ok(Math.abs(full[i] - value) < 1e-9, `cell ${i}`));
        for (const degrees of [30, 90, 200]) {
            const m = hueMatrix(degrees);
            for (const row of [0, 3, 6]) assert.ok(Math.abs(m[row] + m[row + 1] + m[row + 2] - 1) < 1e-9, "each row keeps grey as grey");
        }
    });
});
