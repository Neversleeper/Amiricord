/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository).
// The person's own collection: favourite icons and banners, and the last searches, kept in the plugin's storage (`ctx.storage`), plus an export and an import so
// the favourites are not lost when Discord's data is cleared. Differences from the original: limits (300 favourites per kind, 10 searches of at most 80 characters),
// every favourite is rebuilt from a whitelist of fields when it is read or imported (a damaged or hand-edited entry cannot carry anything else), changes are made one at
// a time so two quick clicks never lose one, and the export can be read back safely. The cookie is a secret and is never part of any of this.

import type { PluginStorage } from "../../api/storage";
import type { JsonValue } from "../../shared/settings";
import { normalizeQuery } from "./searchRanking";
import type { PinterestImageResult } from "./types";

export type FavouriteKind = "AVATAR" | "BANNER";

export interface Favourite extends PinterestImageResult {
    target: FavouriteKind;
    savedAt: number;
}

export const LIBRARY_LIMITS = { favouritesPerKind: 300, recent: 10, recentChars: 80, importChars: 5 * 1024 * 1024 } as const;

export const EXPORT_FORMAT = "amiricord-pinterest-tool";
export const EXPORT_VERSION = 1;

const KEYS = { AVATAR: "favourites-avatar", BANNER: "favourites-banner", recent: "recent-searches" } as const;

const KINDS: readonly FavouriteKind[] = ["AVATAR", "BANNER"];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const IMAGE_HOSTS = new Set(["i.pinimg.com", "s.pinimg.com"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function text(value: unknown, max: number): string {
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

function httpsUrl(value: unknown, hosts: ReadonlySet<string>, max = 600): string | null {
    if (typeof value !== "string" || value.length > max) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.username === "" && url.password === "" && hosts.has(url.hostname.toLowerCase()) ? url.href : null;
    } catch {
        return null;
    }
}

const PAGE_HOSTS = new Set(["www.pinterest.com"]);

function dimension(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 20_000 ? value : null;
}

/**
 * A favourite rebuilt from a whitelist of fields, or null when it is not usable: it needs an id, a Pinterest image address and a size. Everything else is optional
 * and dropped when it does not look right. Addresses must be https on Pinterest's own servers, so a damaged or hand-made entry cannot point anywhere else.
 */
export function sanitizeFavourite(raw: unknown, target: FavouriteKind, now: number): Favourite | null {
    if (!isRecord(raw) || typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    const url = httpsUrl(raw.url, IMAGE_HOSTS);
    const width = dimension(raw.width);
    const height = dimension(raw.height);
    if (!url || width === null || height === null) return null;

    const thumbUrl = httpsUrl(raw.thumbUrl, IMAGE_HOSTS);
    const fallbackUrl = httpsUrl(raw.fallbackUrl, IMAGE_HOSTS);
    const author = text(raw.author, 100);
    const authorUrl = httpsUrl(raw.authorUrl, PAGE_HOSTS, 300);
    return {
        id: raw.id,
        title: text(raw.title, 300),
        description: text(raw.description, 600),
        url,
        width,
        height,
        dominantColor: typeof raw.dominantColor === "string" && COLOR_RE.test(raw.dominantColor) ? raw.dominantColor.toLowerCase() : null,
        pinterestUrl: httpsUrl(raw.pinterestUrl, PAGE_HOSTS, 300),
        isGif: raw.isGif === true,
        ...(thumbUrl ? { thumbUrl } : {}),
        ...(fallbackUrl ? { fallbackUrl } : {}),
        source: "PINTEREST",
        ...(author ? { author } : {}),
        ...(authorUrl ? { authorUrl } : {}),
        target,
        savedAt: typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt) && raw.savedAt > 0 ? raw.savedAt : now
    };
}

/** The search text to remember, or null when it is empty or too long. */
export function recentEntry(query: unknown): string | null {
    if (typeof query !== "string") return null;
    const clean = normalizeQuery(query);
    return clean && clean.length <= LIBRARY_LIMITS.recentChars ? clean : null;
}

export interface LibraryExport {
    format: typeof EXPORT_FORMAT;
    version: typeof EXPORT_VERSION;
    exportedAt: number;
    favourites: Record<FavouriteKind, Favourite[]>;
    recent: string[];
}

export interface ImportReport {
    addedFavourites: number;
    alreadyThere: number;
    /** Entries that were not usable (wrong shape, an address outside Pinterest's servers, no size). */
    refused: number;
    /** Entries left out because the kind was full. */
    overLimit: number;
    addedRecent: number;
}

export type AddResult = "added" | "exists" | "full";

export class Library {
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly storage: PluginStorage, private readonly now: () => number = Date.now) { }

    /** One change at a time, so two quick clicks never read the same list and lose one of them. A failed change does not stop the next. */
    private run<T>(work: () => Promise<T>): Promise<T> {
        const result = this.queue.then(work, work);
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async read(kind: FavouriteKind): Promise<Favourite[]> {
        const saved = await this.storage.get(KEYS[kind]);
        if (!Array.isArray(saved)) return [];
        const now = this.now();
        const seen = new Set<string>();
        const out: Favourite[] = [];
        for (const item of saved) {
            const favourite = sanitizeFavourite(item, kind, now);
            if (!favourite || seen.has(favourite.id)) continue;
            seen.add(favourite.id);
            out.push(favourite);
            if (out.length >= LIBRARY_LIMITS.favouritesPerKind) break;
        }
        return out;
    }

    private async write(kind: FavouriteKind, list: Favourite[]) {
        // A favourite is made only of text, numbers and booleans (see `sanitizeFavourite`), so it survives the round trip unchanged.
        await this.storage.set(KEYS[kind], JSON.parse(JSON.stringify(list)) as JsonValue);
    }

    /** The favourites of one kind, or of both, newest first. */
    favourites(kind?: FavouriteKind): Promise<Favourite[]> {
        return this.run(async () => {
            const kinds = kind ? [kind] : KINDS;
            const lists = await Promise.all(kinds.map(k => this.read(k)));
            return lists.flat().sort((a, b) => b.savedAt - a.savedAt);
        });
    }

    async isFavourite(result: Pick<PinterestImageResult, "id">, kind: FavouriteKind): Promise<boolean> {
        return (await this.favourites(kind)).some(item => item.id === result.id);
    }

    addFavourite(result: PinterestImageResult, kind: FavouriteKind): Promise<AddResult> {
        return this.run(async () => {
            const favourite = sanitizeFavourite(result, kind, this.now());
            if (!favourite) throw new Error("That image cannot be saved as a favourite.");
            // Saving is a new act: it counts from now, whatever time the result carried.
            favourite.savedAt = this.now();
            const list = await this.read(kind);
            if (list.some(item => item.id === favourite.id)) return "exists";
            if (list.length >= LIBRARY_LIMITS.favouritesPerKind) return "full";
            await this.write(kind, [favourite, ...list]);
            return "added";
        });
    }

    removeFavourite(result: Pick<PinterestImageResult, "id">, kind: FavouriteKind): Promise<boolean> {
        return this.run(async () => {
            const list = await this.read(kind);
            const next = list.filter(item => item.id !== result.id);
            if (next.length === list.length) return false;
            await this.write(kind, next);
            return true;
        });
    }

    recent(): Promise<string[]> {
        return this.run(() => this.readRecent());
    }

    private async readRecent(): Promise<string[]> {
        const saved = await this.storage.get(KEYS.recent);
        if (!Array.isArray(saved)) return [];
        const out: string[] = [];
        for (const item of saved) {
            const entry = recentEntry(item);
            if (entry && !out.some(known => known.toLowerCase() === entry.toLowerCase())) out.push(entry);
            if (out.length >= LIBRARY_LIMITS.recent) break;
        }
        return out;
    }

    /** Put a search at the top of the list (without a repeat in another letter case). Returns the new list. */
    rememberSearch(query: string): Promise<string[]> {
        return this.run(async () => {
            const entry = recentEntry(query);
            const current = await this.readRecent();
            if (!entry) return current;
            const next = [entry, ...current.filter(item => item.toLowerCase() !== entry.toLowerCase())].slice(0, LIBRARY_LIMITS.recent);
            await this.storage.set(KEYS.recent, next);
            return next;
        });
    }

    clearRecent(): Promise<void> {
        return this.run(async () => { await this.storage.set(KEYS.recent, []); });
    }

    /** Everything worth keeping, in the format `importData` reads. Never anything secret. */
    exportData(): Promise<LibraryExport> {
        return this.run(async () => ({
            format: EXPORT_FORMAT,
            version: EXPORT_VERSION,
            exportedAt: this.now(),
            favourites: { AVATAR: await this.read("AVATAR"), BANNER: await this.read("BANNER") },
            recent: await this.readRecent()
        }));
    }

    async exportText(): Promise<string> {
        return JSON.stringify(await this.exportData(), null, 2);
    }

    /**
     * Read an export (the text or the parsed object) and ADD what it holds to what is already there; nothing is replaced or removed. Every favourite is rebuilt from
     * the whitelist; those that are not usable, or that do not fit in a full kind, are counted and left out. Throws a plain error when it is not an export at all.
     */
    importData(source: unknown): Promise<ImportReport> {
        return this.run(async () => {
            let data = source;
            if (typeof source === "string") {
                if (source.length > LIBRARY_LIMITS.importChars) throw new Error("That file is too big to be a Pinterest Tool export.");
                try {
                    data = JSON.parse(source);
                } catch {
                    throw new Error("That is not a Pinterest Tool export (it is not valid JSON).");
                }
            }
            if (!isRecord(data) || data.format !== EXPORT_FORMAT) throw new Error("That is not a Pinterest Tool export.");
            if (data.version !== EXPORT_VERSION) throw new Error(`That export is version ${String(data.version).slice(0, 20)}; this one reads version ${EXPORT_VERSION}.`);

            const report: ImportReport = { addedFavourites: 0, alreadyThere: 0, refused: 0, overLimit: 0, addedRecent: 0 };
            const incoming = isRecord(data.favourites) ? data.favourites : {};
            const now = this.now();
            for (const kind of KINDS) {
                const entries = Array.isArray(incoming[kind]) ? incoming[kind] as unknown[] : [];
                const list = await this.read(kind);
                const known = new Set(list.map(item => item.id));
                const added: Favourite[] = [];
                // At most the limit is looked at, so a huge file cannot make this run for long; the rest is counted as refused.
                for (const [index, raw] of entries.entries()) {
                    if (index >= LIBRARY_LIMITS.favouritesPerKind * 2) { report.refused++; continue; }
                    const favourite = sanitizeFavourite(raw, kind, now);
                    if (!favourite) { report.refused++; continue; }
                    if (known.has(favourite.id)) { report.alreadyThere++; continue; }
                    if (list.length + added.length >= LIBRARY_LIMITS.favouritesPerKind) { report.overLimit++; continue; }
                    known.add(favourite.id);
                    added.push(favourite);
                }
                if (added.length) await this.write(kind, [...list, ...added].sort((a, b) => b.savedAt - a.savedAt));
                report.addedFavourites += added.length;
            }

            if (Array.isArray(data.recent)) {
                const current = await this.readRecent();
                const next = [...current];
                for (const item of data.recent) {
                    const entry = recentEntry(item);
                    if (entry && next.length < LIBRARY_LIMITS.recent && !next.some(known => known.toLowerCase() === entry.toLowerCase())) next.push(entry);
                }
                report.addedRecent = next.length - current.length;
                if (report.addedRecent) await this.storage.set(KEYS.recent, next);
            }
            return report;
        });
    }
}
