/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository).
// The search and the image download, written against the host helper of Amiricord's main process: every request goes through `host.fetch`, which only
// reaches the hosts declared in plugin.json, checks every redirect and caps the size of what it reads. The state (the anonymous session, the cache of next
// pages) belongs to one client object, so tests start from nothing. Differences from the original (NOT verified against Pinterest itself):
//   - no network at all until a search is made (the original opened a session at start);
//   - the image download keeps one copy of the bytes (the original also built a base64 copy) and reads at most 60 MB while reading, not only by the declared length;
//   - the download must end on one of Pinterest's two image hosts, so a redirect to www.pinterest.com is refused too;
//   - DeviantArt is not a source any more.

import type { NativeHostApi } from "../../main/nativeHost";
import {
    addSearchVariation, BASE_URL, buildSearchUrl, decodeFeeds, encodeFeeds, extractBookmarks, type Feed, getCsrfToken, getSearchQuery, isAllowedMediaHost, isSearchPayload,
    MAX_MEDIA_BYTES, mediaFilename, normalizeGuide, normalizePin, PAGE_SIZE, readSetCookies, sanitizeCookie, SUPPORTED_IMAGE_TYPE, toBookmarkList
} from "./pinterest";
import { normalizeQuery, rankResults, shapeFits } from "./searchRanking";
import type { MediaFilter, MediaResult, PinterestGuide, PinterestImageResult, PinterestSearchPayload, SearchKind, SearchOptions } from "./types";

// What Pinterest's own web servers have been seen to accept. Not verified today; kept as the original had them.
const SEARCH_USER_AGENT = "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";
const IMAGE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const COOKIE_SECRET = "pinterestCookie";
const SESSION_TTL_MS = 15 * 60 * 1000;
const SEARCH_CACHE_TTL = 3 * 60 * 1000;
const SEARCH_CACHE_SIZE = 64;
const SEARCH_BUDGET_MS = 14_000;

export interface ClientDeps {
    host: NativeHostApi;
    now?: () => number;
    /** Like `Math.random`: a number from 0 up to (not including) 1. */
    random?: () => number;
}

export class PinterestClient {
    private session: { cookie: string; createdAt: number; } | null = null;
    private sessionRequest: Promise<string> | null = null;
    private readonly cache = new Map<string, { at: number; payload: PinterestSearchPayload; }>();
    private readonly pending = new Map<string, Promise<PinterestSearchPayload>>();

    constructor(private readonly deps: ClientDeps) { }

    private now() {
        return (this.deps.now ?? Date.now)();
    }

    private async request(url: string, headers: Record<string, string>, deadline: number) {
        if (deadline - this.now() <= 0) throw new Error("Search timed out.");
        return this.deps.host.fetch(url, { headers });
    }

    /** One anonymous session, kept for 15 minutes, so every "next page" continues the cursor of the session that made it. */
    private async sessionCookie() {
        if (this.session && this.now() - this.session.createdAt < SESSION_TTL_MS) return this.session.cookie;
        if (this.sessionRequest) return this.sessionRequest;
        this.sessionRequest = this.openSession();
        try {
            return await this.sessionRequest;
        } finally {
            this.sessionRequest = null;
        }
    }

    private async openSession() {
        const home = await this.request(BASE_URL, { "User-Agent": SEARCH_USER_AGENT }, this.now() + 12_000);
        if (!home.ok) throw new Error("Could not initialize Pinterest search.");
        const cookie = readSetCookies(home.headers).map(value => value.split(";", 1)[0]).join("; ");
        if (!cookie) throw new Error("Could not initialize Pinterest cookies.");
        this.session = { cookie, createdAt: this.now() };
        return cookie;
    }

    /** Opens the anonymous session ahead of time. Only called when the person asks for it: nothing contacts Pinterest on its own. */
    async warmUp() {
        try {
            await this.sessionCookie();
        } catch {
            // The real search reports any problem.
        }
    }

    /** One feed: the query as given (with its hints), one page, or two for sparse GIF results. */
    private async searchFeed(rawQuery: string, mediaFilter: MediaFilter, bookmarks: string[], target: SearchKind, customCookie: string): Promise<PinterestSearchPayload & { bookmark: string[] | null; }> {
        const deadline = this.now() + SEARCH_BUDGET_MS;
        const query = getSearchQuery(normalizeQuery(rawQuery), mediaFilter, target);
        if (!query) throw new Error("Search query is required.");
        const cursor = toBookmarkList(bookmarks);

        const cookieHeader = customCookie || await this.sessionCookie();
        const csrfToken = customCookie ? getCsrfToken(customCookie) : "";

        // Pinterest often shows animated pins as video previews instead of direct .gif files. For GIFs, up to two result pages are read inside one request,
        // and it returns as soon as one visible page is filled.
        const desired = mediaFilter === "GIFS" ? Math.min(PAGE_SIZE, target === "BANNER" ? 4 : 8) : PAGE_SIZE;
        const maxRequests = mediaFilter === "GIFS" ? 2 : 1;
        const desiredWide = Math.min(desired, 8);

        const collected: PinterestImageResult[] = [];
        const seenIds = new Set<string>();
        const seenUrls = new Set<string>();
        let guides: PinterestGuide[] = [];
        let next = cursor;
        let returned: string[] | null = cursor.length ? cursor : null;
        let previousKey = "";

        for (let index = 0; index < maxRequests; index++) {
            const response = await this.request(buildSearchUrl(query, PAGE_SIZE, next, this.now()), {
                "User-Agent": SEARCH_USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "x-pinterest-pws-handler": "www/pin/[id].js",
                Cookie: cookieHeader,
                ...(csrfToken ? { "X-CSRFToken": csrfToken } : {})
            }, deadline);

            if (!response.ok) {
                // Drop the anonymous session so the next search starts with a fresh one.
                if (!customCookie) this.session = null;
                throw new Error(customCookie && (response.status === 401 || response.status === 403)
                    ? `Pinterest rejected your session cookie (HTTP ${response.status}). It may have expired.`
                    : `Pinterest search failed with HTTP ${response.status}.`);
            }

            const json = await response.json();
            if (!isSearchPayload(json)) throw new Error("Pinterest returned an invalid response.");

            if (!guides.length) {
                guides = (json.resource_response?.data?.guides ?? [])
                    .map(normalizeGuide)
                    .filter((guide): guide is PinterestGuide => guide !== null)
                    .slice(0, 8);
            }

            const normalized = (json.resource_response?.data?.results ?? [])
                .map(normalizePin)
                .filter((pin): pin is PinterestImageResult => pin !== null)
                .filter(pin => mediaFilter !== "STATIC" || !pin.isGif)
                .filter(pin => mediaFilter !== "GIFS" || pin.isGif);

            for (const pin of normalized) {
                if (seenIds.has(pin.id) || seenUrls.has(pin.url)) continue;
                seenIds.add(pin.id);
                seenUrls.add(pin.url);
                collected.push(pin);
            }

            returned = extractBookmarks(json);
            // A cursor identical to the one just sent cannot advance the feed.
            if (returned && JSON.stringify(returned) === JSON.stringify(next)) returned = null;

            const enough = mediaFilter !== "GIFS" && target === "BANNER"
                ? collected.filter(pin => shapeFits(pin, target)).length >= desiredWide
                : collected.length >= desired;
            if (enough || !returned?.length || this.now() >= deadline - 800) break;

            const key = JSON.stringify(returned);
            if (key === previousKey) {
                // A cursor that does not advance: stop.
                returned = null;
                break;
            }
            previousKey = key;
            next = returned;
        }

        return { query, guides, results: rankResults([collected], rawQuery, target), bookmark: returned };
    }

    /** Two feeds at the same time (the query with its hints, and a style variation of it), ranked together and de-duplicated. */
    private async searchFeeds(options: Required<Pick<SearchOptions, "mediaFilter" | "target" | "randomize">> & { query: string; bookmarks: string[]; cookie: string; }): Promise<PinterestSearchPayload> {
        const { mediaFilter, target, randomize, bookmarks, cookie } = options;
        const plain = normalizeQuery(options.query);
        if (!plain) throw new Error("Search query is required.");
        const incoming = toBookmarkList(bookmarks);
        const random = this.deps.random ?? Math.random;
        let feeds = incoming.length ? decodeFeeds(incoming) : null;

        if (!feeds) {
            const base = getSearchQuery(plain, mediaFilter, target);
            if (incoming.length) {
                // A cursor from an older version: continue it as a single feed.
                feeds = [{ q: base, b: incoming }];
            } else {
                const first = randomize ? addSearchVariation(base, target, mediaFilter, random) : base;
                let second = addSearchVariation(base, target, mediaFilter, random);
                for (let tries = 0; second === first && tries < 6; tries++) second = addSearchVariation(base, target, mediaFilter, random);
                feeds = [{ q: first, b: [] }, { q: second, b: [] }];
            }
        }
        if (!feeds.length) return { query: plain, guides: [], results: [], bookmark: null };

        const outcomes = await Promise.allSettled(feeds.map(feed => this.searchFeed(feed.q, mediaFilter, feed.b, target, cookie)));
        const ok = outcomes.filter((o): o is PromiseFulfilledResult<PinterestSearchPayload> => o.status === "fulfilled").map(o => o.value);
        if (!ok.length) {
            const failure = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
            throw failure?.reason instanceof Error ? failure.reason : new Error("Pinterest search failed.");
        }

        const next: Feed[] = feeds.map((feed, index) => {
            const outcome = outcomes[index];
            // A feed that failed keeps its cursor, so the next page retries it.
            if (outcome.status === "rejected") return feed;
            return { q: feed.q, b: outcome.value.bookmark ?? [] };
        });

        const seen = new Set<string>();
        return {
            query: plain,
            guides: ok.flatMap(payload => payload.guides).filter(guide => {
                const key = guide.label.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, 8),
            results: rankResults(ok.map(payload => payload.results), plain, target),
            bookmark: encodeFeeds(next)
        };
    }

    private cacheGet(key: string) {
        const hit = this.cache.get(key);
        if (!hit) return null;
        if (this.now() - hit.at > SEARCH_CACHE_TTL) {
            this.cache.delete(key);
            return null;
        }
        // Most recently used goes last.
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit.payload;
    }

    private cacheSet(key: string, payload: PinterestSearchPayload) {
        this.cache.set(key, { at: this.now(), payload });
        if (this.cache.size > SEARCH_CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    }

    /**
     * Search Pinterest. First pages always include a fresh variation feed, so only follow-up pages (fixed cursors) are cached for three minutes, and identical
     * requests in flight are shared. The cache key holds the cookie, in memory only: it is never written, logged or sent anywhere.
     */
    async search(options: SearchOptions): Promise<PinterestSearchPayload> {
        const query = normalizeQuery(typeof options?.query === "string" ? options.query : "");
        if (!query) throw new Error("Search query is required.");
        const mediaFilter: MediaFilter = options.mediaFilter === "GIFS" || options.mediaFilter === "STATIC" ? options.mediaFilter : "ALL";
        const target: SearchKind = options.target === "AVATAR" || options.target === "BANNER" ? options.target : "IMAGE";
        // The person's own cookie is a secret of this plugin: only the main process can read it, the page never has it.
        const cookie = sanitizeCookie(this.deps.host.secret(COOKIE_SECRET) ?? "");
        const cursor = toBookmarkList(options.bookmarks);

        const key = cursor.length ? JSON.stringify([mediaFilter, target, cursor, cookie]) : "";
        const cached = key ? this.cacheGet(key) : null;
        if (cached) return cached;
        const running = key ? this.pending.get(key) : undefined;
        if (running) return running;

        const request = this.searchFeeds({ query, mediaFilter, target, randomize: options.randomize === true, bookmarks: cursor, cookie });
        if (key) this.pending.set(key, request);
        try {
            const payload = await request;
            if (key) this.cacheSet(key, payload);
            return payload;
        } finally {
            if (key) this.pending.delete(key);
        }
    }

    /** Download one image from Pinterest's image servers. The answer must come from one of them, even after redirects. */
    async fetchMedia(rawUrl: string): Promise<MediaResult> {
        let url: URL;
        try {
            url = new URL(rawUrl);
        } catch {
            throw new Error("Invalid media URL.");
        }
        if (url.protocol !== "https:" || !isAllowedMediaHost(url.hostname)) throw new Error("Invalid media URL.");

        const response = await this.deps.host.fetch(url.href, {
            headers: { Accept: "image/avif,image/webp,image/gif,image/png,image/jpeg", "User-Agent": IMAGE_USER_AGENT },
            maxBytes: MAX_MEDIA_BYTES
        });
        const finalUrl = new URL(response.url ?? url.href);
        if (finalUrl.protocol !== "https:" || !isAllowedMediaHost(finalUrl.hostname)) throw new Error("Invalid image redirect.");
        if (!response.ok) throw new Error(`Failed to fetch media with HTTP ${response.status}.`);

        const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
        if (!SUPPORTED_IMAGE_TYPE.test(type)) throw new Error("That link is not a supported image.");
        const data = await response.arrayBuffer();
        return { data, type, filename: mediaFilename(finalUrl.pathname, type) };
    }
}
