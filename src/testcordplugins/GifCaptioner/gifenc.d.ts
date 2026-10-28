/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The part of the `gifenc` package this plugin uses (the package has no types of its own).
declare module "gifenc" {
    export interface GifWriteOptions {
        delay?: number;
        palette?: number[][];
        transparent?: boolean;
        transparentIndex?: number;
    }

    export interface GifEncoderInstance {
        writeFrame(index: Uint8Array, width: number, height: number, options?: GifWriteOptions): void;
        finish(): void;
        bytesView(): Uint8Array;
    }

    export function GIFEncoder(): GifEncoderInstance;
    export function quantize(data: Uint8ClampedArray | Uint8Array, maxColors: number): number[][];
    export function nearestColorIndex(palette: number[][], color: number[]): number;
}
