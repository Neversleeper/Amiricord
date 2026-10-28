/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Remembers where each finder found its module in the current Discord build, so the next start can go straight there.
// An entry is only trusted after the module's source is compared with the fingerprint saved with it.
// Pure: reading and writing the file belongs to the main process. Parsing never throws.

export interface CacheEntry {
    moduleId: string;
    /** Property of the module's exports that matched, or null when the exports themselves matched. */
    path: string | null;
    fingerprint: string;
}

/** A short hash of a module's source (FNV-1a, 32 bits) plus its length. Detects changes, it is not a security hash. */
export function fingerprint(source: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${(hash >>> 0).toString(16)}-${source.length}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function isEntry(value: unknown): value is CacheEntry {
    return isRecord(value)
        && typeof value.moduleId === "string"
        && (value.path === null || typeof value.path === "string")
        && typeof value.fingerprint === "string";
}

export class ResolutionCache {
    private readonly entries = new Map<string, CacheEntry>();
    /** Something changed since the cache was loaded or last saved. */
    dirty = false;

    constructor(readonly build: number | null) { }

    get size(): number {
        return this.entries.size;
    }

    get(key: string): CacheEntry | undefined {
        return this.entries.get(key);
    }

    set(key: string, entry: CacheEntry): void {
        const old = this.entries.get(key);
        if (old && old.moduleId === entry.moduleId && old.path === entry.path && old.fingerprint === entry.fingerprint) return;
        this.entries.set(key, entry);
        this.dirty = true;
    }

    delete(key: string): void {
        if (this.entries.delete(key)) this.dirty = true;
    }

    /** Text for the file. Keys are sorted so the same content always gives the same text. */
    serialize(): string {
        const entries: Record<string, CacheEntry> = {};
        for (const key of [...this.entries.keys()].sort()) entries[key] = this.entries.get(key)!;
        this.dirty = false;
        return JSON.stringify({ build: this.build, entries }, null, 1) + "\n";
    }
}

/**
 * Read a cache file. A file from another build, or one that cannot be understood, gives an empty cache for `build`.
 * Single bad entries are dropped and the rest is kept. Returns what was found wrong.
 */
export function parseResolutionCache(text: string | null, build: number | null): { cache: ResolutionCache; problems: string[]; } {
    const cache = new ResolutionCache(build);
    const problems: string[] = [];
    if (text === null) return { cache, problems };

    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { cache, problems: ["the module cache is not valid JSON, starting empty"] };
    }
    if (!isRecord(data) || !isRecord(data.entries)) return { cache, problems: ["the module cache has an unexpected shape, starting empty"] };

    // Without a known build number nothing can be trusted to belong to it.
    if (build === null || data.build !== build) return { cache, problems };

    for (const [key, entry] of Object.entries(data.entries)) {
        if (isEntry(entry)) cache.set(key, { moduleId: entry.moduleId, path: entry.path, fingerprint: entry.fingerprint });
        else problems.push(`the module cache entry "${key}" is not valid and was dropped`);
    }
    cache.dirty = false;
    return { cache, problems };
}
