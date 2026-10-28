/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main-process entry of GifCaptioner: the three functions the page may call. Each gets Amiricord's `host` first, whose `fetch` is the only way out to the
// network (only the hosts in plugin.json). The work is in `native.client.ts`. Everything exported here is callable from the page, so nothing else may be exported.

import type { NativeHostApi } from "../../main/nativeHost";
import { createClient, type FetchedMedia, type FontInfo } from "./native.client";

export function fetchMedia(host: NativeHostApi, url: unknown): Promise<FetchedMedia | null> {
    return createClient(host).fetchMedia(url);
}

export function fontList(host: NativeHostApi): Promise<FontInfo[]> {
    return createClient(host).fontList();
}

export function fontFile(host: NativeHostApi, family: unknown): Promise<ArrayBuffer | null> {
    return createClient(host).fontFile(family);
}
