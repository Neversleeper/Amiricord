/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// Draws the caption on a white band above each frame and writes the frames into a new GIF. The canvas, the font, the size limit and what happens with the result
// are handed in, so it is tested with fakes; the real ones are the page's `OffscreenCanvas`, the chosen font and the upload (see `index.ts`).

import { GIFEncoder, type GifEncoderInstance, nearestColorIndex, quantize } from "./codec";
import { type CaptionTransform, getLines } from "./media";

export const MAX_CANVAS_PIXELS = 4_000_000;
export const TRANSPARENT_INDEX = 255;
export const MAX_COLORS = 255;
export const CAPTION_PADDING = 10;

export interface Context2D {
    font: string;
    fillStyle: string;
    textAlign: string;
    textBaseline: string;
    measureText(text: string): { width: number; };
    fillRect(x: number, y: number, width: number, height: number): void;
    fillText(text: string, x: number, y: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    drawImage(source: unknown, x: number, y: number, width?: number, height?: number): void;
    getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray; };
    createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number; };
    putImageData(data: unknown, x: number, y: number): void;
}

export interface CanvasLike {
    width: number;
    height: number;
    getContext(kind: "2d", options?: { willReadFrequently: boolean; }): Context2D | null;
}

export interface EncodeDeps {
    makeCanvas(width: number, height: number): CanvasLike;
    /** The font family the caption is drawn in. */
    font(): string;
    /** The largest file Discord lets this account send, in bytes. */
    maxFileSize(): number;
    /** Tell the person something went wrong. */
    fail(message: string): void;
    /** Hand over the finished file. */
    deliver(file: File): void;
    /** A fresh GIF writer (the real one by default). */
    encoder?(): GifEncoderInstance;
}

export interface FrameSource {
    patch: Uint8ClampedArray;
    delay: number;
    disposalType?: number;
    dims: { width: number; height: number; left: number; top: number; };
}

export interface GifScreen { lsd: { width: number; height: number; }; }

function rgb888ToRgb565(r: number, g: number, b: number): number {
    return ((r << 8) & 0xf800) | ((g << 3) & 0x07e0) | (b >> 3);
}

/** For each pixel, the number of its colour in the palette; a pixel that is mostly transparent gets the transparent number. */
export function applyPaletteTransparent(data: Uint8ClampedArray, palette: number[][], threshold: number): Uint8Array {
    const cache = new Array<number>(2 ** 16);
    const index = new Uint8Array(Math.floor(data.length / 4));
    for (let i = 0; i < index.length; i++) {
        const r = data[4 * i];
        const g = data[4 * i + 1];
        const b = data[4 * i + 2];
        const a = data[4 * i + 3];
        if (a < threshold) {
            index[i] = TRANSPARENT_INDEX;
            continue;
        }
        const key = rgb888ToRgb565(r, g, b);
        index[i] = cache[key] ?? (cache[key] = nearestColorIndex(palette, [r, g, b]));
    }
    return index;
}

/** How much smaller than the original the result must be to stay under the size limit and the canvas limit (1 means not smaller). */
export function scaleFactorFor(fullWidth: number, fullHeight: number, frames: number, maxFileSize: number): number {
    const fullSize = fullHeight * fullWidth;
    return Math.max(1, Math.sqrt((fullSize * frames) / maxFileSize), Math.sqrt(fullSize / MAX_CANVAS_PIXELS));
}

export class GifRenderer {
    private readonly canvas: CanvasLike;
    private readonly ctx: Context2D;
    private readonly gif: GifEncoderInstance;
    private topOffset = 0;
    private width: number;
    private height: number;
    private hasFrames = false;
    private tempCanvas?: CanvasLike;
    private tempCtx?: Context2D;
    private gifCanvas?: CanvasLike;
    private gifCtx?: Context2D;
    private frameImageData?: { data: Uint8ClampedArray; width: number; height: number; };
    private needsDisposal = false;

    constructor(private readonly deps: EncodeDeps, { frames, width, height, transform }: { frames: number; width: number; height: number; transform: CaptionTransform; }) {
        this.canvas = deps.makeCanvas(1, 1);
        this.ctx = this.contextOf(this.canvas);
        this.gif = deps.encoder?.() ?? GIFEncoder();
        this.width = width;
        this.height = height;

        this.ctx.font = `${transform.size}px ${deps.font()}`;
        const lines = getLines(this.ctx, transform.text, this.width);
        const fullHeight = lines.length * transform.size + CAPTION_PADDING + this.height;
        const scale = scaleFactorFor(this.width, fullHeight, frames, deps.maxFileSize());

        const newWidth = Math.max(1, Math.floor(this.width / scale));
        this.height = Math.max(1, Math.floor(this.height / scale));
        this.width = this.canvas.width = newWidth;
        this.canvas.height = Math.max(1, Math.floor(fullHeight / scale));
        this.drawCaption(transform.text, newWidth, Math.max(1, Math.floor(transform.size / scale)));
    }

    private contextOf(canvas: CanvasLike): Context2D {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Failed to create canvas context.");
        return context;
    }

    /** Draws one frame of a GIF (patches over the previous ones, as GIFs do) under the caption and writes it. */
    addGifFrame(source: FrameSource, parsed: GifScreen) {
        this.tempCanvas ??= this.deps.makeCanvas(1, 1);
        this.tempCtx ??= this.contextOf(this.tempCanvas);
        if (!this.gifCanvas) {
            this.gifCanvas = this.deps.makeCanvas(parsed.lsd.width, parsed.lsd.height);
            this.gifCanvas.width = parsed.lsd.width;
            this.gifCanvas.height = parsed.lsd.height;
        }
        this.gifCtx ??= this.contextOf(this.gifCanvas);

        if (this.needsDisposal) {
            this.gifCtx.clearRect(0, 0, this.gifCanvas.width, this.gifCanvas.height);
            this.needsDisposal = false;
        }
        if (source.disposalType === 2) this.needsDisposal = true;

        if (!this.frameImageData || source.dims.width !== this.frameImageData.width || source.dims.height !== this.frameImageData.height) {
            this.tempCanvas.width = source.dims.width;
            this.tempCanvas.height = source.dims.height;
            this.frameImageData = this.tempCtx.createImageData(source.dims.width, source.dims.height);
        }

        this.frameImageData.data.set(source.patch);
        this.tempCtx.putImageData(this.frameImageData, 0, 0);
        this.gifCtx.drawImage(this.tempCanvas, source.dims.left, source.dims.top);

        this.ctx.clearRect(0, this.topOffset, this.width, this.height);
        this.ctx.drawImage(this.gifCanvas, 0, this.topOffset, this.width, this.height);
        this.addFrameToGif(source.delay);
    }

    /** Draws one frame of a video (or any picture source) under the caption and writes it. */
    addVideoFrame(source: unknown, delay: number) {
        this.ctx.clearRect(0, this.topOffset, this.width, this.height);
        this.ctx.drawImage(source, 0, this.topOffset, this.width, this.height);
        this.addFrameToGif(delay);
    }

    /** Finishes the GIF and hands it over, or says why it cannot. */
    render() {
        if (!this.hasFrames) {
            this.deps.fail("Failed to encode GIF.");
            return;
        }
        this.gif.finish();
        const bytes = this.gif.bytesView() as Uint8Array<ArrayBuffer>;
        const file = new File([bytes], "rendered.gif", { type: "image/gif" });
        if (file.size > this.deps.maxFileSize()) {
            this.deps.fail("Rendered GIF is too large to upload.");
            return;
        }
        this.deps.deliver(file);
    }

    private addFrameToGif(delay: number) {
        const { data } = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        const palette = quantize(data, MAX_COLORS);
        const index = applyPaletteTransparent(data, palette, 1);
        this.gif.writeFrame(index, this.canvas.width, this.canvas.height, { delay, palette, transparent: true, transparentIndex: TRANSPARENT_INDEX });
        this.hasFrames = true;
    }

    private drawCaption(text: string, width: number, size: number) {
        this.ctx.font = `${size}px ${this.deps.font()}`;
        const lines = getLines(this.ctx, text, width);
        this.topOffset = lines.length * size + CAPTION_PADDING;
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, width, this.topOffset);
        this.ctx.fillStyle = "black";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) this.ctx.fillText(lines[i], width / 2, size * i + 5);
    }
}
