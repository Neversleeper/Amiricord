/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Part of the Amiricord port of AutoRedeem (original plugin: TestCord, by x2b and irritably).
 */

// Stand-in for TestCord's `TestcordRequestCoordinator.request({ key, ttlMs, run })`, which Amiricord does not have. AutoRedeem only uses it for two things:
// the gift pre-check (one request per code) and the connection warm-up (not more than one every few seconds). The contract kept here is the one those two
// uses need: calls with the same `key` while the first one is running share it, and a call that succeeded is answered again from memory for `ttlMs`.
// A call that failed is NOT remembered, so the next attempt asks again (the queue decides when, from `retry_after`).
// It lives inside one plugin run: `createRequestCoordinator()` is made at start, so nothing is kept after the plugin stops.

export interface CoordinatedRequest<T> {
    key: string;
    ttlMs: number;
    run: () => Promise<T>;
}

export interface RequestCoordinator {
    request<T>(options: CoordinatedRequest<T>): Promise<T>;
    clear(): void;
}

const MAX_ENTRIES = 500;

export function createRequestCoordinator(now: () => number = Date.now): RequestCoordinator {
    const entries = new Map<string, { at: number; ttlMs: number; promise: Promise<unknown>; }>();

    const prune = () => {
        if (entries.size <= MAX_ENTRIES) return;
        const time = now();
        for (const [key, entry] of entries) {
            if (time - entry.at >= entry.ttlMs) entries.delete(key);
        }
        while (entries.size > MAX_ENTRIES) {
            const oldest = entries.keys().next();
            if (oldest.done) break;
            entries.delete(oldest.value);
        }
    };

    return {
        request<T>({ key, ttlMs, run }: CoordinatedRequest<T>): Promise<T> {
            const time = now();
            const known = entries.get(key);
            if (known && time - known.at < known.ttlMs) return known.promise as Promise<T>;

            const promise = run();
            const entry = { at: time, ttlMs, promise };
            entries.set(key, entry);
            promise.then(undefined, () => {
                if (entries.get(key) === entry) entries.delete(key);
            });
            prune();
            return promise;
        },

        clear() {
            entries.clear();
        }
    };
}
