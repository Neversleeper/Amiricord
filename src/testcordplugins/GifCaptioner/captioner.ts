/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// What the caption window holds as plain data (the text, the size, the font, the size of the media) and the drawing of its preview. The window only draws this.

import type { Context2D } from "./encode";
import { type CaptionMedia, type CaptionTransform, getLines } from "./media";

export const MIN_SIZE = 5;
export const MAX_SIZE = 200;
export const MAX_TEXT_LENGTH = 300;
export const DEFAULT_WIDTH = 480;
export const DEFAULT_HEIGHT = 270;
export const DEFAULT_FONT = "Arial";
export const PLACEHOLDER = "Enter caption...";

export interface CaptionState {
    text: string;
    size: number;
    font: string;
    /** Goes up every time a font finishes loading, so the preview is drawn again with it. */
    fontRevision: number;
    width: number;
    height: number;
}

export interface CaptionerDeps {
    /** Download and register a font of the list; true when it is ready to draw with. */
    loadFont(family: string): Promise<boolean>;
}

export function createCaptioner(media: Pick<CaptionMedia, "width" | "height">, deps: CaptionerDeps, startFont = DEFAULT_FONT) {
    let video: unknown = null;
    let state: CaptionState = {
        text: "",
        size: Math.max(16, Math.round((media.width || DEFAULT_WIDTH) / 10)),
        font: startFont,
        fontRevision: 0,
        width: Math.max(1, media.width || DEFAULT_WIDTH),
        height: Math.max(1, media.height || DEFAULT_HEIGHT)
    };
    const listeners = new Set<() => void>();
    let closed = false;
    const set = (change: Partial<CaptionState>) => {
        if (closed) return;
        state = { ...state, ...change };
        for (const listener of [...listeners]) listener();
    };

    const useFont = async (family: string) => {
        if (await deps.loadFont(family).catch(() => false)) set({ fontRevision: state.fontRevision + 1 });
    };
    void useFont(startFont);

    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        setText(text: string) { set({ text: String(text).slice(0, MAX_TEXT_LENGTH) }); },
        setSize(size: number) {
            const value = Number(size);
            if (!Number.isFinite(value)) return;
            set({ size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, value)) });
        },
        setFont(family: string) {
            if (family === state.font) return;
            set({ font: family });
            void useFont(family);
        },
        /** The size of the video, once it knows it. Zero or negative sizes are ignored. */
        setMediaSize(width: number, height: number) {
            set({ ...(width > 0 ? { width } : {}), ...(height > 0 ? { height } : {}) });
        },
        setVideo(element: unknown) { video = element; },
        /** What to draw on the media: the text, the size and the media's own size. */
        transform(): CaptionTransform {
            return { height: state.height, sourceVideo: video as HTMLVideoElement | null, text: state.text, size: state.size, type: "caption", width: state.width };
        },
        dispose() {
            closed = true;
            listeners.clear();
        }
    };
}

export type Captioner = ReturnType<typeof createCaptioner>;

/** Draws the caption band as it will look above the media. */
export function drawPreview(canvas: { width: number; height: number; getContext(kind: "2d"): Context2D | null; }, state: Pick<CaptionState, "text" | "size" | "font" | "width">): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const text = state.text || PLACEHOLDER;
    const width = Math.max(1, state.width);
    ctx.font = `${state.size}px ${state.font}`;
    const lines = getLines(ctx, text, width);
    const height = lines.length * state.size + 10;
    canvas.width = width;
    canvas.height = height;
    ctx.font = `${state.size}px ${state.font}`;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "black";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], width / 2, state.size * i + 5);
}
