/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// What the main process does for GifCaptioner: download a picture or video of the GIF picker, and get the list and the files of Google Fonts. Every request goes
// through `host.fetch`, which reaches only the hosts declared in plugin.json and checks every redirect. Differences from the original (NOT verified against the
// real servers): the original tried a public "CORS proxy" (a third-party site that would see every address) when the direct download failed; that is NOT carried
// over, so a picture from a host that is not listed is simply not captioned; only the hosts listed in plugin.json can be asked for.

import type { NativeHostApi } from "../../main/nativeHost";

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_FONT_BYTES = 8 * 1024 * 1024;
export const FONT_LIST_URL = "https://fonts.google.com/$rpc/fonts.fe.catalog.actions.metadata.MetadataService/FontSearch";
export const FONT_LIST_BODY = JSON.stringify([["", null, null, null, null, null, 1], [5], null, 400]);
export const MAX_FAMILY_LENGTH = 100;
const FAMILY_PATTERN = /^[a-zA-Z0-9\s\-_']+$/;

/** The picture and video servers the GIF picker uses: Discord's, Tenor's and Klipy's. */
const MEDIA_SUFFIXES = ["discordapp.com", "discordapp.net", "tenor.com", "klipy.com"];

export function isMediaHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return MEDIA_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

export interface FetchedMedia {
    data: ArrayBuffer;
    contentType: string;
}

export interface FontInfo {
    family: string;
    displayName: string;
}

/** A font family name that is safe to put in an address and in CSS. */
export function isFamilyName(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_FAMILY_LENGTH && FAMILY_PATTERN.test(value);
}

export function createClient(host: NativeHostApi) {
    return {
        /** The bytes of a picture or video of the picker, or null when it is not from a listed host, is too big, or cannot be read. */
        async fetchMedia(rawUrl: unknown): Promise<FetchedMedia | null> {
            try {
                if (typeof rawUrl !== "string") return null;
                const url = new URL(rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl);
                if (url.protocol !== "https:" || !isMediaHost(url.hostname)) return null;
                const response = await host.fetch(url.href, { maxBytes: MAX_MEDIA_BYTES });
                if (!response.ok) return null;
                const finalHost = new URL(response.url ?? url.href).hostname;
                if (!isMediaHost(finalHost)) return null;
                const data = await response.arrayBuffer();
                if (data.byteLength === 0 || data.byteLength > MAX_MEDIA_BYTES) return null;
                return { data, contentType: response.headers.get("content-type") ?? "" };
            } catch {
                return null;
            }
        },

        /** The names of Google's fonts, sorted, or an empty list when Google did not answer in the expected form. */
        async fontList(): Promise<FontInfo[]> {
            try {
                const response = await host.fetch(FONT_LIST_URL, {
                    method: "POST",
                    headers: { "content-type": "application/json+protobuf", "x-user-agent": "grpc-web-javascript/0.1" },
                    body: FONT_LIST_BODY,
                    maxBytes: MAX_MEDIA_BYTES
                });
                if (!response.ok) return [];
                const data = JSON.parse((await response.text()).replace(/^\)\]\}'[\r\n]*/, "")) as unknown;
                const rows = Array.isArray(data) && Array.isArray(data[1]) ? data[1] as unknown[] : [];
                const fonts: FontInfo[] = [];
                for (const row of rows) {
                    if (!Array.isArray(row) || !Array.isArray(row[1])) continue;
                    const entry = row[1] as unknown[];
                    const family = entry[0];
                    if (!isFamilyName(family)) continue;
                    fonts.push({ family, displayName: typeof entry[1] === "string" ? entry[1] : family });
                }
                return fonts.sort((a, b) => a.family.localeCompare(b.family));
            } catch {
                return [];
            }
        },

        /** The font file of a family (its first source), or null. Only names that pass `isFamilyName` are asked for. */
        async fontFile(family: unknown): Promise<ArrayBuffer | null> {
            try {
                if (!isFamilyName(family)) return null;
                const css = await host.fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`, { maxBytes: MAX_FONT_BYTES });
                if (!css.ok) return null;
                const source = (await css.text()).match(/url\(([^)]+)\)/)?.[1]?.replace(/^['"]|['"]$/g, "");
                if (!source) return null;
                const address = new URL(source);
                if (address.protocol !== "https:" || address.hostname !== "fonts.gstatic.com") return null;
                const file = await host.fetch(address.href, { maxBytes: MAX_FONT_BYTES });
                if (!file.ok) return null;
                const data = await file.arrayBuffer();
                return data.byteLength > 0 && data.byteLength <= MAX_FONT_BYTES ? data : null;
            } catch {
                return null;
            }
        }
    };
}
