/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository).
// The pure part of the search: building Pinterest's request, reading its answer, the paging cursors and the query hints. No network here (that is `native.client.ts`),
// so everything in this file is tested with plain values. Differences from the original: the random style word comes from a function the caller gives (so tests
// are exact), and the image host check also covers where a download finally came from.

import { hasBannerIntent, hasProfileIntent } from "./searchRanking";
import type { MediaFilter, PinterestGuide, PinterestImageResult, SearchKind } from "./types";

export const BASE_URL = "https://www.pinterest.com";
/** Pinterest's own web client asks for 25 pins per request. */
export const PAGE_SIZE = 25;
export const MAX_MEDIA_BYTES = 60 * 1024 * 1024;

const MEDIA_HOSTS = new Set(["i.pinimg.com", "s.pinimg.com"]);

/** Whether an image may be downloaded from this host: Pinterest's image servers only. */
export function isAllowedMediaHost(hostname: string) {
    return MEDIA_HOSTS.has(hostname.toLowerCase());
}

export interface PinterestSearchImage {
    width?: number;
    height?: number;
    url?: string;
}

export interface PinterestSearchPin {
    id?: string;
    type?: string;
    title?: string;
    grid_title?: string;
    description?: string;
    dominant_color?: string;
    link?: string | null;
    images?: Record<string, PinterestSearchImage>;
    videos?: unknown;
    video_list?: unknown;
}

export interface PinterestGuideEntry {
    type?: string;
    action?: { search_query?: string; };
    display?: { display_text?: string; };
}

export interface PinterestSearchJson {
    resource?: { options?: { bookmarks?: string[] | string; }; };
    resource_response?: {
        // Pinterest usually sends this cursor as a single string, not an array.
        bookmark?: string[] | string;
        data?: { results?: PinterestSearchPin[]; guides?: PinterestGuideEntry[]; };
    };
}

export function isSearchPayload(value: unknown): value is PinterestSearchJson {
    return typeof value === "object" && value !== null;
}

/** Every Set-Cookie value of an answer, whether the headers offer them one by one or merged in a single line. */
export function readSetCookies(headers: { get(name: string): string | null; getSetCookie?(): string[]; }): string[] {
    const values = headers.getSetCookie?.() ?? [];
    if (values.length) return values;
    const merged = headers.get("set-cookie");
    if (!merged) return [];
    // The merged line has a space after each comma; the original kept it, which left a double space in the cookie it sent.
    return merged.split(/,(?=[^;,]+=)/g).map(value => value.trim());
}

/** Cursors as a clean list: both a single text and a list are accepted, empty ones and Pinterest's "-end-" marker are dropped. */
export function toBookmarkList(value: unknown): string[] {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return list.filter((item): item is string => typeof item === "string" && item.length > 0 && item !== "-end-");
}

/** The cursors of the next page, or null when there is none ("-end-" wins over echoed request options). */
export function extractBookmarks(json: PinterestSearchJson): string[] | null {
    const marker = json.resource_response?.bookmark;
    if (marker === "-end-" || (Array.isArray(marker) && marker.includes("-end-"))) return null;
    const fromResponse = toBookmarkList(json.resource_response?.bookmark);
    if (fromResponse.length) return fromResponse;

    const fromOptions = toBookmarkList(json.resource?.options?.bookmarks);
    return fromOptions.length ? fromOptions : null;
}

export function buildSearchUrl(query: string, pageSize: number, bookmarks: string[] = [], now: number = Date.now()) {
    const endpoint = new URL("/resource/BaseSearchResource/get/", BASE_URL);
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const data = {
        options: {
            appliedProductFilters: "---",
            auto_correction_disabled: false,
            bookmarks,
            page_size: pageSize,
            query,
            redux_normalize_feed: true,
            rs: "typed",
            scope: "pins",
            source_url: sourceUrl
        },
        context: {}
    };

    endpoint.searchParams.set("source_url", sourceUrl);
    endpoint.searchParams.set("data", JSON.stringify(data));
    endpoint.searchParams.set("_", `${now}`);

    return endpoint.toString();
}

export function normalizeGuide(entry: PinterestGuideEntry): PinterestGuide | null {
    const label = entry.display?.display_text?.trim();
    const query = entry.action?.search_query?.trim();

    if (!label || !query) return null;
    return { label, query };
}

export function isGifUrl(rawUrl: string) {
    try {
        return new URL(rawUrl).pathname.toLowerCase().endsWith(".gif");
    } catch {
        return /\.gif(?:$|\?)/i.test(rawUrl);
    }
}

export function normalizePin(entry: PinterestSearchPin): PinterestImageResult | null {
    if (entry.type !== "pin") return null;

    const image = entry.images?.orig ?? entry.images?.["736x"] ?? entry.images?.["474x"] ?? entry.images?.["236x"];
    if (!image?.url || !image.width || !image.height || !entry.id) return null;

    const isGif = isGifUrl(image.url);
    if (!isGif && (entry.videos || entry.video_list)) return null;

    return {
        id: entry.id,
        title: entry.title?.trim() || entry.grid_title?.trim() || "",
        description: entry.description?.trim() || "",
        url: image.url,
        width: image.width,
        height: image.height,
        dominantColor: entry.dominant_color ?? null,
        pinterestUrl: `${BASE_URL}/pin/${entry.id}/`,
        isGif,
        thumbUrl: entry.images?.["474x"]?.url ?? entry.images?.["736x"]?.url ?? image.url,
        // Some pins have no downloadable original; the 736 px copy is the fallback.
        fallbackUrl: entry.images?.["736x"]?.url && entry.images["736x"].url !== image.url ? entry.images["736x"].url : undefined,
        source: "PINTEREST"
    };
}

/** The query as sent: avatar and banner searches get a hint word, GIF searches ask for animated ones. */
export function getSearchQuery(query: string, mediaFilter: MediaFilter, target: SearchKind) {
    let finalQuery = query.trim();

    if (target === "AVATAR" && !hasProfileIntent(finalQuery)) {
        finalQuery = `${finalQuery} pfp icon`;
    } else if (target === "BANNER" && !hasBannerIntent(finalQuery)) {
        // "wallpaper" on Pinterest mostly returns tall phone wallpapers, which crop badly into a 5:2 profile banner.
        // "banner" surfaces wide header-style pins for the same subject.
        finalQuery = `${finalQuery} banner`;
    }

    if (mediaFilter === "GIFS" && !/\b(gif|animated)\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} animated gif`;
    }

    return finalQuery;
}

const VARIANTS: Record<SearchKind, Record<"gif" | "still", string[]>> = {
    IMAGE: { gif: ["loop", "animation", "animated art", "motion", "edit", "reaction"], still: ["aesthetic", "fanart", "art", "edit", "illustration", "photography"] },
    AVATAR: { gif: ["loop", "animated icon", "anime edit", "motion", "reaction", "scene", "edit"], still: ["aesthetic", "fanart", "icon edit", "dark aesthetic", "portrait art", "minimal", "anime icon"] },
    BANNER: { gif: ["loop", "animated wallpaper", "cinematic loop", "anime scene", "motion background", "scenery loop", "animated art"], still: ["header", "aesthetic", "desktop wallpaper", "dark aesthetic", "cinematic", "scenery", "landscape", "widescreen"] }
};

/** The query plus one style word. `random` gives a number from 0 up to (not including) 1, like `Math.random`. */
export function addSearchVariation(query: string, target: SearchKind, mediaFilter: MediaFilter, random: () => number = Math.random) {
    const variants = VARIANTS[target][mediaFilter === "GIFS" ? "gif" : "still"];

    // Skip variations whose words are already in the query ("icon edit" on "... pfp icon").
    const words = new Set(query.toLowerCase().split(/\s+/));
    const useful = variants.filter(variant => variant.split(" ").some(word => !words.has(word)) && !variant.split(" ").some(word => words.has(word)));
    const pool = useful.length ? useful : variants;
    return `${query} ${pool[Math.floor(random() * pool.length)]}`;
}

/**
 * The person's own cookie, cleaned: the first line only, without a "Cookie:" prefix, no control characters, printable ASCII only, at most 8192 characters.
 * Anything else gives "" (no cookie). It is only ever sent to www.pinterest.com as the Cookie header.
 */
export function sanitizeCookie(raw: string | undefined) {
    if (!raw) return "";
    const cleaned = raw
        .trim()
        .split(/[\r\n]/, 1)[0]
        .replace(/^\s*cookie\s*:\s*/i, "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim();
    return cleaned.length > 0 && cleaned.length <= 8192 && /^[\x20-\x7e]+$/.test(cleaned) ? cleaned : "";
}

export function getCsrfToken(cookie: string) {
    return /(?:^|;\s*)csrftoken=([^;]+)/i.exec(cookie)?.[1] ?? "";
}

// Two Pinterest feeds per search, for variety. The page's opaque cursor carries one entry per feed that still has more pages:
//   "F|" + encodeURIComponent(JSON.stringify({ q: feed query, b: bookmarks }))
export interface Feed { q: string; b: string[]; }

export function encodeFeeds(feeds: Feed[]) {
    const list = feeds.filter(feed => feed.b.length).map(feed => `F|${encodeURIComponent(JSON.stringify(feed))}`);
    return list.length ? list : null;
}

/** The feeds a cursor list stands for, or null when the list is not made of feeds (a cursor from an older version). */
export function decodeFeeds(bookmarks: string[]): Feed[] | null {
    const feeds: Feed[] = [];
    for (const item of bookmarks) {
        if (!item.startsWith("F|")) return null;
        try {
            const feed = JSON.parse(decodeURIComponent(item.slice(2))) as Feed;
            if (typeof feed?.q === "string" && Array.isArray(feed.b)) feeds.push({ q: feed.q, b: toBookmarkList(feed.b) });
        } catch {
            return null;
        }
    }
    return feeds;
}

/** The file name for a download: the last part of the path, with an extension added when there is none. */
export function mediaFilename(pathname: string, contentType: string) {
    const last = pathname.split("/").pop() || "pinterest-image";
    return last.includes(".") ? last : `${last}.${contentType.includes("gif") ? "gif" : "jpg"}`;
}

export const SUPPORTED_IMAGE_TYPE = /^image\/(?:png|jpeg|gif|webp|avif)$/;
