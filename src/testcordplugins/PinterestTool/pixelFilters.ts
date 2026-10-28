/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The colour maths of the editor, on a raw RGBA array (what a canvas gives). Order: brightness, contrast, saturation, hue, grayscale, sepia, tint.
// The alpha channel is never touched. Design: docs/analysis-34-pinterest-tool-editor.md.

import { type Adjustments, isNeutral } from "./editorModel";

const LUMA = [0.2126, 0.7152, 0.0722] as const;

const byte = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);

function parseHex(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** How strong a tint of 100 % is. The picture still shows through. */
export const TINT_STRENGTH = 0.6;

/** The contrast factor for a value from -100 to 100. */
export function contrastFactor(contrast: number): number {
    const c = contrast * 2.55;
    return (259 * (c + 255)) / (255 * (259 - c));
}

/** The 3x3 matrix that turns the colours by `degrees` around the grey axis (the usual one used by CSS filters). */
export function hueMatrix(degrees: number): number[] {
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [
        0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072
    ];
}

/** Change the pixels in place. Does nothing when the adjustments do nothing. */
export function filterPixels(data: Uint8ClampedArray | number[], adjustments: Adjustments): void {
    if (isNeutral(adjustments)) return;

    const add = adjustments.brightness * 2.55;
    const factor = contrastFactor(adjustments.contrast);
    const saturation = 1 + adjustments.saturation / 100;
    const hue = adjustments.hue === 0 ? null : hueMatrix(adjustments.hue);
    const gray = adjustments.grayscale / 100;
    const sepia = adjustments.sepia / 100;
    const [tr, tg, tb] = parseHex(adjustments.tint);
    const tint = (adjustments.tintAmount / 100) * TINT_STRENGTH;

    for (let i = 0; i + 3 < data.length; i += 4) {
        let r = data[i] + add;
        let g = data[i + 1] + add;
        let b = data[i + 2] + add;

        r = factor * (r - 128) + 128;
        g = factor * (g - 128) + 128;
        b = factor * (b - 128) + 128;

        let luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
        r = luma + (r - luma) * saturation;
        g = luma + (g - luma) * saturation;
        b = luma + (b - luma) * saturation;

        if (hue) {
            const nr = hue[0] * r + hue[1] * g + hue[2] * b;
            const ng = hue[3] * r + hue[4] * g + hue[5] * b;
            const nb = hue[6] * r + hue[7] * g + hue[8] * b;
            r = nr;
            g = ng;
            b = nb;
        }

        if (gray > 0) {
            luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
            r += (luma - r) * gray;
            g += (luma - g) * gray;
            b += (luma - b) * gray;
        }

        if (sepia > 0) {
            const sr = 0.393 * r + 0.769 * g + 0.189 * b;
            const sg = 0.349 * r + 0.686 * g + 0.168 * b;
            const sb = 0.272 * r + 0.534 * g + 0.131 * b;
            r += (sr - r) * sepia;
            g += (sg - g) * sepia;
            b += (sb - b) * sepia;
        }

        if (tint > 0) {
            r += (tr - r) * tint;
            g += (tg - g) * tint;
            b += (tb - b) * tint;
        }

        data[i] = byte(Math.round(r));
        data[i + 1] = byte(Math.round(g));
        data[i + 2] = byte(Math.round(b));
    }
}
