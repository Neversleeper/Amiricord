/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository; read from
// GitHub on 2026-10-25). Types shared by the page side and the main-process side. Difference from the original: the DeviantArt source is gone
// (only Pinterest's own hosts are declared in plugin.json).

export type SearchTarget = "IMAGE" | "ALL" | "AVATAR" | "BANNER";
export type SearchKind = Exclude<SearchTarget, "ALL">;
export type MediaFilter = "ALL" | "GIFS" | "STATIC";
export type ResultSource = "PINTEREST";

export interface PinterestGuide {
    label: string;
    query: string;
}

export interface PinterestImageResult {
    id: string;
    title: string;
    description: string;
    url: string;
    width: number;
    height: number;
    dominantColor: string | null;
    pinterestUrl: string | null;
    isGif: boolean;
    /** Lightweight preview used by the grid (the full-size `url` is used when applying). */
    thumbUrl?: string;
    /** The 736 px copy, for pins that have no downloadable original. */
    fallbackUrl?: string;
    source?: ResultSource;
    author?: string;
    authorUrl?: string | null;
}

export interface PinterestSearchPayload {
    query: string;
    guides: PinterestGuide[];
    results: PinterestImageResult[];
    /** Opaque cursors for the next page, or null when there is no more. */
    bookmark: string[] | null;
}

/** What the page asks for. Plain data, so it can cross to the main process. */
export interface SearchOptions {
    query: string;
    mediaFilter?: MediaFilter;
    target?: SearchKind;
    /** Cursors returned by the previous page. */
    bookmarks?: string[];
    /** Add a random style word to a first page (less precise, more variety). */
    randomize?: boolean;
}

export interface MediaResult {
    data: ArrayBuffer;
    type: string;
    filename: string;
}
