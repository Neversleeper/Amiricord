/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// What a downloaded file is (a GIF, a video, another picture) and how big it is, and how a caption is cut into lines. Nothing here touches the page except the
// function that opens a picture, which is handed in.

export interface CaptionMedia {
    buffer: ArrayBuffer;
    contentType: string;
    height: number;
    isVideo: boolean;
    release: () => void;
    url: string;
    width: number;
}

export interface CaptionTransform {
    height: number;
    text: string;
    size: number;
    sourceVideo?: HTMLVideoElement | null;
    type: "caption";
    width: number;
}

interface MediaLike {
    buffer: ArrayBuffer;
    contentType: string;
}

export interface MediaMetadata {
    height: number;
    isVideo: boolean;
    width: number;
}

const header = (buffer: ArrayBuffer, length: number) => new Uint8Array(buffer, 0, Math.min(buffer.byteLength, length));

export function looksLikeGif({ buffer, contentType }: MediaLike): boolean {
    const start = header(buffer, 3);
    return contentType.includes("gif") || (start.length >= 3 && start[0] === 0x47 && start[1] === 0x49 && start[2] === 0x46);
}

export function looksLikeVideo({ buffer, contentType }: MediaLike): boolean {
    const start = header(buffer, 12);
    const isMp4 = start.length >= 8 && start[4] === 0x66 && start[5] === 0x74 && start[6] === 0x79 && start[7] === 0x70;
    const isWebm = start.length >= 4 && start[0] === 0x1a && start[1] === 0x45 && start[2] === 0xdf && start[3] === 0xa3;
    return contentType.startsWith("video/") || isMp4 || isWebm;
}

function readGifDimensions(buffer: ArrayBuffer) {
    if (!looksLikeGif({ buffer, contentType: "" }) || buffer.byteLength < 10) return null;
    const view = new DataView(buffer);
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

interface Bitmap { width: number; height: number; close(): void; }

/** The size of a picture, or that it is a video (its size is read when it plays), or null when it is nothing this plugin can use. */
export async function inspectMedia(buffer: ArrayBuffer, contentType: string, openPicture: () => Promise<Bitmap>): Promise<MediaMetadata | null> {
    if (looksLikeVideo({ buffer, contentType })) return { height: 0, isVideo: true, width: 0 };
    try {
        const bitmap = await openPicture();
        try {
            return { height: bitmap.height, isVideo: false, width: bitmap.width };
        } finally {
            bitmap.close();
        }
    } catch {
        const dimensions = readGifDimensions(buffer);
        return dimensions ? { ...dimensions, isVideo: false } : null;
    }
}

interface MeasureTextContext {
    measureText(text: string): { width: number; };
}

/** Cuts a caption into lines that fit `maxWidth`, breaking between words. A word that is wider than the line stays alone on its line. */
export function getLines(ctx: MeasureTextContext, text: string, maxWidth: number): string[] {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = words[0] ?? "";
    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        if (ctx.measureText(`${line} ${word}`).width < maxWidth) line += ` ${word}`;
        else {
            lines.push(line);
            line = word;
        }
    }
    lines.push(line);
    return lines;
}
