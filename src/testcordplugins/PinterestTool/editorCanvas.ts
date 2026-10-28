/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The part of the editor that touches a real canvas: draw the plan (turn, mirror, cut, scale), apply the colours and make a PNG. Kept thin on purpose: only
// typecheck covers it, because no test here runs a canvas. The maths it uses is in `editorModel.ts` and `pixelFilters.ts`. Design: docs/analysis-34-pinterest-tool-editor.md.

import type { Adjustments, OutputPlan } from "./editorModel";
import { filterPixels } from "./pixelFilters";

interface ImageDataLike { data: Uint8ClampedArray; }

interface Context2D {
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    scale(x: number, y: number): void;
    drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    drawImage(image: unknown, dx: number, dy: number): void;
    getImageData(x: number, y: number, w: number, h: number): ImageDataLike;
    putImageData(data: ImageDataLike, x: number, y: number): void;
    imageSmoothingQuality?: string;
}

export interface CanvasLike {
    width: number;
    height: number;
    getContext(kind: "2d"): Context2D | null;
    toBlob?(callback: (blob: Blob | null) => void, type?: string): void;
}

export interface SourceSize { width: number; height: number; }

/** Turn and mirror the whole picture on a scratch canvas, so the cut can be taken from the result in plain pixels. */
function turned(image: unknown, size: SourceSize, plan: OutputPlan, make: () => CanvasLike): CanvasLike {
    const sideways = plan.rotation === 90 || plan.rotation === 270;
    const scratch = make();
    scratch.width = sideways ? size.height : size.width;
    scratch.height = sideways ? size.width : size.height;
    const context = scratch.getContext("2d");
    if (!context) throw new Error("The page could not give a canvas.");
    context.translate(scratch.width / 2, scratch.height / 2);
    context.rotate((plan.rotation * Math.PI) / 180);
    context.scale(plan.flipH ? -1 : 1, plan.flipV ? -1 : 1);
    context.drawImage(image, -size.width / 2, -size.height / 2);
    return scratch;
}

/** Draw the result of `plan` on `target`, which takes the output size. */
export function drawPlan(target: CanvasLike, image: unknown, size: SourceSize, plan: OutputPlan, adjustments: Adjustments, make: () => CanvasLike): void {
    const scratch = turned(image, size, plan, make);
    target.width = plan.outWidth;
    target.height = plan.outHeight;
    const context = target.getContext("2d");
    if (!context) throw new Error("The page could not give a canvas.");
    context.imageSmoothingQuality = "high";
    context.drawImage(scratch, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.outWidth, plan.outHeight);
    const pixels = context.getImageData(0, 0, plan.outWidth, plan.outHeight);
    filterPixels(pixels.data, adjustments);
    context.putImageData(pixels, 0, 0);
}

export function exportPng(image: unknown, size: SourceSize, plan: OutputPlan, adjustments: Adjustments, make: () => CanvasLike): Promise<Blob> {
    const target = make();
    drawPlan(target, image, size, plan, adjustments, make);
    return new Promise((resolve, reject) => {
        if (!target.toBlob) {
            reject(new Error("The page cannot make a PNG."));
            return;
        }
        target.toBlob(blob => { if (blob) resolve(blob); else reject(new Error("The page could not make the PNG.")); }, "image/png");
    });
}
