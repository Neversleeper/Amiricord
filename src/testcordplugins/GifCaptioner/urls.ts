/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// Which addresses to try when the person asks to caption a GIF of the picker: the one the item shows, then the others found inside the item, the ones from
// Discord's own servers first.

export const MAX_DEPTH = 2;
const URL_KEYWORDS = ["url", "src", "proxy"];
const URL_CONTAINER_KEYS = ["gif", "media", "image", "video", "thumbnail", "preview", "result", "item"];

export const normalizeUrl = (url: string) => (url.startsWith("//") ? `https:${url}` : url);

export const looksLikeUrl = (value: string) => value.startsWith("http://") || value.startsWith("https://") || value.startsWith("//");

/** Tenor serves a video and a GIF at addresses that differ by one letter; for a GIF item the address is kept, for a video the letter is set to "o" (the mp4). */
export function applyTenorMp4Fix(url: string, isGif: boolean): string {
    if (isGif) return url;
    try {
        if (!new URL(url).host.endsWith("tenor.com")) return url;
    } catch {
        return url;
    }
    const typeIndex = url.lastIndexOf("/") - 1;
    if (typeIndex <= 0) return url;
    return `${url.slice(0, typeIndex)}o${url.slice(typeIndex + 1)}`;
}

/** The web addresses inside an item's properties: values of keys that say url, src or proxy, and inside keys that say gif, media, image and the like. */
export function collectCandidateUrls(source: unknown, depth = 0, out = new Set<string>()): Set<string> {
    if (!source || depth > MAX_DEPTH) return out;
    if (typeof source === "string") {
        if (looksLikeUrl(source)) out.add(normalizeUrl(source));
        return out;
    }
    if (Array.isArray(source)) {
        for (const entry of source) collectCandidateUrls(entry, depth + 1, out);
        return out;
    }
    if (typeof source !== "object") return out;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
        const name = key.toLowerCase();
        if (typeof value === "string") {
            if (looksLikeUrl(value) && URL_KEYWORDS.some(keyword => name.includes(keyword))) out.add(normalizeUrl(value));
        } else if (value && typeof value === "object" && URL_CONTAINER_KEYS.some(keyword => name.includes(keyword))) {
            collectCandidateUrls(value, depth + 1, out);
        }
    }
    return out;
}

export function scoreUrl(url: string): number {
    let host = "";
    try {
        host = new URL(url).host;
    } catch { /* an address that cannot be read scores for its text only */ }
    let score = 0;
    if (host.endsWith("discordapp.net") || host.endsWith("discordapp.com")) score += 100;
    if (host.includes("images-ext")) score += 20;
    if (host.includes("media.discordapp.net") || host.includes("cdn.discordapp.com")) score += 10;
    if (host.endsWith("klipy.com")) score += 5;
    if (host.endsWith("tenor.com")) score += 5;
    if (url.includes(".gif")) score += 1;
    return score;
}

/** The preferred address first, then the others from best to worst. */
export function orderCandidateUrls(preferred: string | null, candidates: Set<string>): string[] {
    const all = Array.from(candidates);
    if (!all.length) return [];
    const rest = preferred ? all.filter(url => url !== preferred) : all;
    rest.sort((a, b) => scoreUrl(b) - scoreUrl(a));
    return preferred ? [preferred, ...rest] : rest;
}

export interface ItemProps { format?: number; src?: string; [key: string]: unknown; }

/** The addresses to try for one item of the picker, in order. */
export function addressesFor(props: ItemProps): string[] {
    const isGif = props.format === 1;
    const direct = typeof props.src === "string" ? props.src : null;
    const preferred = direct ? applyTenorMp4Fix(normalizeUrl(direct), isGif) : null;
    const adjusted = new Set<string>();
    if (preferred) adjusted.add(preferred);
    for (const candidate of collectCandidateUrls(props)) adjusted.add(applyTenorMp4Fix(candidate, isGif));
    return orderCandidateUrls(preferred, adjusted);
}
