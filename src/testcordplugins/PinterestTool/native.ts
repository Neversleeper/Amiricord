/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository).
// The main-process entry: the three functions the page may call. Each gets Amiricord's `host` first, whose `fetch` is the only way out to the network
// (only the hosts in plugin.json). The work is in `native.client.ts`; one client lives as long as the main process, so the anonymous session and the cache of
// next pages are shared by all searches. Everything exported here is callable from the page, so nothing else may be exported.

import type { NativeHostApi } from "../../main/nativeHost";
import { PinterestClient } from "./native.client";
import type { MediaResult, PinterestSearchPayload, SearchOptions } from "./types";

let client: PinterestClient | undefined;

/** The host object of a plugin is the same for every call, so the first one is kept with the client. */
const clientFor = (host: NativeHostApi) => (client ??= new PinterestClient({ host }));

export function search(host: NativeHostApi, options: SearchOptions): Promise<PinterestSearchPayload> {
    return clientFor(host).search(options);
}

export async function warmUp(host: NativeHostApi): Promise<void> {
    await clientFor(host).warmUp();
}

export function fetchMedia(host: NativeHostApi, url: string): Promise<MediaResult> {
    return clientFor(host).fetchMedia(url);
}
