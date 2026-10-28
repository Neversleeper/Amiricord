/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// Downloads the first address that works and works out what it is. The download, the way to open a picture and the page's address maker are handed in.

import { type CaptionMedia, inspectMedia } from "./media";

export const MAX_MEDIA_PIXELS = 4_000_000;

export interface ResolveDeps {
    /** Download one address through the main process; null when it could not be had. */
    fetchMedia(url: string): Promise<{ data: ArrayBuffer; contentType: string; } | null>;
    /** Open a downloaded picture to read its size. */
    openPicture(blob: Blob): Promise<{ width: number; height: number; close(): void; }>;
    makeUrl(blob: Blob): string;
    revokeUrl(url: string): void;
}

/** The first address that gives a usable file of a size that is safe to work with, or null. */
export async function resolveMedia(deps: ResolveDeps, urls: string[]): Promise<CaptionMedia | null> {
    for (const url of urls) {
        const result = await deps.fetchMedia(url).catch(() => null);
        if (!result) continue;
        const blob = new Blob([result.data], { type: result.contentType });
        const metadata = await inspectMedia(result.data, result.contentType, () => deps.openPicture(blob));
        if (!metadata) continue;
        if (metadata.width * metadata.height > MAX_MEDIA_PIXELS) continue;
        const previewUrl = deps.makeUrl(blob);
        let released = false;
        return {
            buffer: result.data,
            contentType: result.contentType,
            ...metadata,
            release: () => {
                if (released) return;
                released = true;
                deps.revokeUrl(previewUrl);
            },
            url: previewUrl
        };
    }
    return null;
}
