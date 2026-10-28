/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pictures for the grid. The page does not load Pinterest's pictures itself: the main process fetches them (only Pinterest's declared hosts) and the page shows
// them from a `blob:` address. This keeps a small cache, loads a few at a time, skips a picture whose card is gone before its turn comes, and takes every address
// back when the window closes. Design: docs/analysis-33-pinterest-tool-window.md.

import type { MediaResult } from "./types";

export const THUMB_LIMITS = { concurrent: 4, cached: 600 } as const;

export interface ThumbDeps {
    fetchMedia(url: string): Promise<MediaResult>;
    createUrl(blob: Blob): string;
    revokeUrl(url: string): void;
}

type Done = (blobUrl: string | null) => void;

interface Pending {
    url: string;
    waiting: Set<Done>;
    started: boolean;
}

export class ThumbLoader {
    private readonly cache = new Map<string, string>();
    private readonly failed = new Set<string>();
    private readonly pending = new Map<string, Pending>();
    private readonly queue: Pending[] = [];
    private running = 0;
    private disposed = false;
    private held = false;

    constructor(private readonly deps: ThumbDeps) { }

    /**
     * Ask for a picture. `done` is called once with the `blob:` address, or null if it could not be had. Returns a function that says the card no longer needs it
     * (a picture nobody waits for and that has not started is never fetched). After `dispose` the answer is always null.
     */
    request(url: string, done: Done): () => void {
        if (this.disposed || this.failed.has(url)) {
            queueMicrotask(() => { done(null); });
            return () => undefined;
        }
        const cached = this.cache.get(url);
        if (cached !== undefined) {
            // Used again: it becomes the newest, so it is the last to be let go.
            this.cache.delete(url);
            this.cache.set(url, cached);
            queueMicrotask(() => { done(cached); });
            return () => undefined;
        }
        let entry = this.pending.get(url);
        if (!entry) {
            entry = { url, waiting: new Set(), started: false };
            this.pending.set(url, entry);
            this.queue.push(entry);
        }
        entry.waiting.add(done);
        const waiting = entry;
        this.pump();
        return () => {
            waiting.waiting.delete(done);
            if (waiting.waiting.size === 0 && !waiting.started) {
                this.pending.delete(url);
                const at = this.queue.indexOf(waiting);
                if (at >= 0) this.queue.splice(at, 1);
            }
        };
    }

    private pump() {
        while (!this.held && this.running < THUMB_LIMITS.concurrent && this.queue.length > 0) {
            const entry = this.queue.shift()!;
            entry.started = true;
            this.running++;
            void this.load(entry).finally(() => {
                this.running--;
                this.pump();
            });
        }
    }

    private async load(entry: Pending) {
        let result: string | null = null;
        try {
            const media = await this.deps.fetchMedia(entry.url);
            if (typeof media.type === "string" && media.type.startsWith("image/") && Object.prototype.toString.call(media.data) === "[object ArrayBuffer]") {
                const blobUrl = this.deps.createUrl(new Blob([media.data], { type: media.type }));
                if (this.disposed) this.deps.revokeUrl(blobUrl);
                else result = this.keep(entry.url, blobUrl);
            }
        } catch {
            // The card shows a plain box.
        }
        if (result === null && !this.disposed) this.failed.add(entry.url);
        this.pending.delete(entry.url);
        for (const done of [...entry.waiting]) {
            try {
                done(result);
            } catch {
                // A card that fails to update must not stop the others.
            }
        }
    }

    private keep(url: string, blobUrl: string): string {
        this.cache.set(url, blobUrl);
        while (this.cache.size > THUMB_LIMITS.cached) {
            const oldest = this.cache.keys().next().value as string;
            this.deps.revokeUrl(this.cache.get(oldest)!);
            this.cache.delete(oldest);
        }
        return blobUrl;
    }

    /** While held, no new picture is started (those in flight finish). Used while the person's own pick is being downloaded, so it does not wait behind the grid. */
    hold(on: boolean) {
        this.held = on;
        if (!on) this.pump();
    }

    /** Close: take back every address and let nothing more start. */
    dispose() {
        this.disposed = true;
        for (const blobUrl of this.cache.values()) this.deps.revokeUrl(blobUrl);
        this.cache.clear();
        this.queue.length = 0;
        this.failed.clear();
    }
}
