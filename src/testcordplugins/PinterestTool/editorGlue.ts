/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Puts the editor together with the page: gets the picture through the main process, makes the bitmap, draws on canvases and hands a PNG to the browser as a
// download. Everything the page provides comes in through `PageTools`, so the tests give fakes. Design: docs/analysis-34-pinterest-tool-editor.md.

import { type CanvasLike, drawPlan, exportPng } from "./editorCanvas";
import type { PresetStore } from "./editorModel";
import { type EditorDeps, EditorSession } from "./editorSession";
import type { FavouriteKind } from "./library";
import type { MediaResult, PinterestImageResult } from "./types";

export interface Bitmap { width: number; height: number; close?(): void; }

export interface PageTools {
    fetchMedia(url: string): Promise<MediaResult>;
    createBitmap(blob: Blob): Promise<Bitmap>;
    makeCanvas(): CanvasLike;
    /** Give the file to the person (a download). */
    download(blob: Blob, filename: string): void;
}

/** A name that is safe as the start of a file name. */
export function fileBase(id: string): string {
    const clean = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    return `pinterest-${clean || "picture"}`;
}

export function createEditorFor(result: PinterestImageResult, kind: FavouriteKind, tools: PageTools, presets: Pick<PresetStore, "list" | "save" | "remove">): EditorSession {
    const deps: EditorDeps = {
        async load() {
            const addresses = [result.url, ...(result.fallbackUrl && result.fallbackUrl !== result.url ? [result.fallbackUrl] : [])];
            let failure: unknown;
            for (const address of addresses) {
                try {
                    const media = await tools.fetchMedia(address);
                    if (typeof media.type !== "string" || !media.type.startsWith("image/")) throw new Error("That address is not a picture.");
                    const bitmap = await tools.createBitmap(new Blob([media.data], { type: media.type }));
                    return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => { bitmap.close?.(); } };
                } catch (error) {
                    failure = error;
                }
            }
            throw failure instanceof Error ? failure : new Error("The picture could not be loaded.");
        },
        draw: (canvas, source, plan, adjustments) => { drawPlan(canvas as CanvasLike, source, source as Bitmap, plan, adjustments, tools.makeCanvas); },
        exportPng: (source, plan, adjustments) => exportPng(source, source as Bitmap, plan, adjustments, tools.makeCanvas),
        saveFile: (blob, filename) => { tools.download(blob, filename); },
        presets
    };
    return new EditorSession(deps, kind, fileBase(result.id));
}
