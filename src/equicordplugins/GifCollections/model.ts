/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The data side of GifCollections, without Discord and without a page: what a collection is, how the saved list is read back (only plain, well-formed data is kept), and the
// changes to it (add, remove, move, rename, delete, sort) as functions that give a new list. Written for Amiricord from the idea of the Equicord plugin (author creations).

export const COLLECTION_PREFIX = "gc:";
export const ITEM_PREFIX = "gc-item:";
export const MAX_COLLECTIONS = 100;
export const MAX_GIFS_PER_COLLECTION = 500;
/** All the collections are saved as one value of at most 1 MB (the plugin storage's limit); about 450 characters per GIF, so this many leave room. */
export const MAX_GIFS_TOTAL = 1500;
export const MAX_NAME_CHARS = 40;
/** A one-pixel transparent picture, shown for a collection with no GIFs (it is not fetched from anywhere). */
export const EMPTY_PICTURE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export enum Format { IMAGE = 1, VIDEO = 2 }

export interface Gif {
    id: string;
    src: string;
    url: string;
    height: number;
    width: number;
    addedAt?: number;
}

export interface Collection {
    /** With the prefix: the picker's categories are told apart from Discord's own by it. */
    name: string;
    type: "Category";
    src: string;
    format: Format;
    gifs: Gif[];
    createdAt: number;
    lastUpdated: number;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "ogg", "webm", "avi", "wmv", "flv", "mov", "mkv", "m4v"]);

/** The file ending of an address (without its query), lower case, or undefined. */
export function extensionOf(address: string): string | undefined {
    try {
        const name = new URL(address).pathname.split("/").pop() ?? "";
        const dot = name.lastIndexOf(".");
        return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
    } catch {
        return undefined;
    }
}

export const formatOf = (address: string): Format => (VIDEO_EXTENSIONS.has(extensionOf(address) ?? "") ? Format.VIDEO : Format.IMAGE);

const web = (value: unknown): value is string => typeof value === "string" && value.length <= 2000 && /^https:\/\//i.test(value);
const size = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 20000 ? Math.round(value) : fallback);
const when = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);

function readGif(raw: unknown, seen: Set<string>): Gif | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || item.id === "" || item.id.length > 80 || seen.has(item.id) || !web(item.src) || !web(item.url)) return undefined;
    seen.add(item.id);
    const gif: Gif = { id: item.id, src: item.src, url: item.url, height: size(item.height, 100), width: size(item.width, 100) };
    if (typeof item.addedAt === "number") gif.addedAt = item.addedAt;
    return gif;
}

/** The picture of a collection: its last GIF, or the empty picture. */
export const pictureOf = (gifs: readonly Gif[]): string => gifs[gifs.length - 1]?.src ?? EMPTY_PICTURE;

/** The saved list as plain collections: whatever has the wrong shape is dropped, names are unique and start with the prefix, and the sizes are bounded. */
export function readCollections(value: unknown): Collection[] {
    if (!Array.isArray(value)) return [];
    const out: Collection[] = [];
    const ids = new Set<string>();
    let total = 0;
    for (const raw of value) {
        if (out.length >= MAX_COLLECTIONS) break;
        if (typeof raw !== "object" || raw === null) continue;
        const item = raw as Record<string, unknown>;
        if (typeof item.name !== "string" || !item.name.startsWith(COLLECTION_PREFIX) || item.name.length > COLLECTION_PREFIX.length + MAX_NAME_CHARS || out.some(other => other.name === item.name)) continue;
        const gifs: Gif[] = [];
        for (const entry of Array.isArray(item.gifs) ? item.gifs : []) {
            if (gifs.length >= MAX_GIFS_PER_COLLECTION || total >= MAX_GIFS_TOTAL) break;
            const gif = readGif(entry, ids);
            if (gif) { gifs.push(gif); total++; }
        }
        const picture = pictureOf(gifs);
        out.push({ name: item.name, type: "Category", src: picture, format: formatOf(picture), gifs, createdAt: when(item.createdAt, 0), lastUpdated: when(item.lastUpdated, 0) });
    }
    return out;
}

export const displayName = (name: string): string => (name.startsWith(COLLECTION_PREFIX) ? name.slice(COLLECTION_PREFIX.length) : name);

/** A name without control characters or an edge of spaces, cut to the limit; empty when nothing is left. */
export const cleanName = (name: string): string => name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_NAME_CHARS).trim();

export const totalGifs = (list: readonly Collection[]): number => list.reduce((sum, collection) => sum + collection.gifs.length, 0);

const touch = (collection: Collection, gifs: Gif[], now: number): Collection => {
    const picture = pictureOf(gifs);
    return { ...collection, gifs, src: picture, format: formatOf(picture), lastUpdated: now };
};

export type Change = { ok: true; list: Collection[]; } | { ok: false; error: string; };

/** A new collection, with the given GIFs (maybe none). */
export function createCollection(list: readonly Collection[], name: string, gifs: readonly Gif[], now: number): Change {
    const clean = cleanName(name);
    if (clean === "") return { ok: false, error: "Give the collection a name." };
    if (list.length >= MAX_COLLECTIONS) return { ok: false, error: `There can be at most ${MAX_COLLECTIONS} collections.` };
    if (totalGifs(list) + gifs.length > MAX_GIFS_TOTAL) return { ok: false, error: `The collections can hold ${MAX_GIFS_TOTAL} GIFs in all.` };
    const full = `${COLLECTION_PREFIX}${clean}`;
    if (list.some(collection => collection.name === full)) return { ok: false, error: "That collection already exists." };
    const stamped = gifs.map(gif => ({ ...gif, addedAt: now }));
    return { ok: true, list: [...list, touch({ name: full, type: "Category", src: EMPTY_PICTURE, format: Format.IMAGE, gifs: [], createdAt: now, lastUpdated: now }, stamped, now)] };
}

export function addGif(list: readonly Collection[], name: string, gif: Gif, now: number, preventDuplicates: boolean): Change {
    const collection = list.find(candidate => candidate.name === name);
    if (!collection) return { ok: false, error: "That collection is not there any more." };
    if (preventDuplicates && collection.gifs.some(other => other.url === gif.url)) return { ok: false, error: "This GIF is already in the collection." };
    if (collection.gifs.length >= MAX_GIFS_PER_COLLECTION) return { ok: false, error: `A collection holds at most ${MAX_GIFS_PER_COLLECTION} GIFs.` };
    if (totalGifs(list) >= MAX_GIFS_TOTAL) return { ok: false, error: `The collections can hold ${MAX_GIFS_TOTAL} GIFs in all.` };
    return { ok: true, list: list.map(other => other === collection ? touch(other, [...other.gifs, { ...gif, addedAt: now }], now) : other) };
}

export function removeGif(list: readonly Collection[], id: string, now: number): Change {
    const collection = list.find(candidate => candidate.gifs.some(gif => gif.id === id));
    if (!collection) return { ok: false, error: "That GIF is not there any more." };
    return { ok: true, list: list.map(other => other === collection ? touch(other, other.gifs.filter(gif => gif.id !== id), now) : other) };
}

export function moveGif(list: readonly Collection[], id: string, toName: string, now: number): Change {
    const from = list.find(candidate => candidate.gifs.some(gif => gif.id === id));
    const to = list.find(candidate => candidate.name === toName);
    const gif = from?.gifs.find(candidate => candidate.id === id);
    if (!from || !to || !gif) return { ok: false, error: "That GIF or collection is not there any more." };
    if (from === to) return { ok: true, list: [...list] };
    if (to.gifs.length >= MAX_GIFS_PER_COLLECTION) return { ok: false, error: `A collection holds at most ${MAX_GIFS_PER_COLLECTION} GIFs.` };
    return { ok: true, list: list.map(other => other === from ? touch(other, other.gifs.filter(entry => entry.id !== id), now) : other === to ? touch(other, [...other.gifs, { ...gif, addedAt: now }], now) : other) };
}

export function renameCollection(list: readonly Collection[], name: string, newName: string, now: number): Change {
    const clean = cleanName(newName);
    if (clean === "") return { ok: false, error: "Give the collection a name." };
    const full = `${COLLECTION_PREFIX}${clean}`;
    if (list.some(collection => collection.name === full && collection.name !== name)) return { ok: false, error: "That collection already exists." };
    if (!list.some(collection => collection.name === name)) return { ok: false, error: "That collection is not there any more." };
    return { ok: true, list: list.map(collection => collection.name === name ? { ...collection, name: full, lastUpdated: now } : collection) };
}

export const deleteCollection = (list: readonly Collection[], name: string): Collection[] => list.filter(collection => collection.name !== name);

/** Replaces a GIF's addresses (when Discord's pictures expired and were refreshed). */
export const withRefreshed = (list: readonly Collection[], id: string, src: string, url: string): Collection[] => list.map(collection => collection.gifs.some(gif => gif.id === id)
    ? { ...collection, gifs: collection.gifs.map(gif => gif.id === id ? { ...gif, src, url } : gif) }
    : collection);

export type SortType = "name" | "created" | "modified";
export type SortOrder = "asc" | "desc";

export function sortCollections(list: readonly Collection[], type: SortType, order: SortOrder): Collection[] {
    const sign = order === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
        switch (type) {
            case "created": return (a.createdAt - b.createdAt) * sign;
            case "modified": return (a.lastUpdated - b.lastUpdated) * sign;
            default: return a.name.localeCompare(b.name) * sign;
        }
    });
}

/** Whether a Discord picture address has an expiry time in the past (`ex` is the time in hexadecimal seconds). Other addresses never expire here. */
export function isCdnUrlExpired(address: string, now: number): boolean {
    try {
        const url = new URL(address);
        if (!["cdn.discordapp.com", "media.discordapp.net", "images-ext-1.discordapp.net", "images-ext-2.discordapp.net"].includes(url.hostname)) return false;
        const expiry = url.searchParams.get("ex");
        return expiry !== null && /^[0-9a-f]{1,12}$/i.test(expiry) && parseInt(expiry, 16) * 1000 < now;
    } catch {
        return false;
    }
}

/** The address to save for a picture that was right-clicked: the link's, when it is one of the GIF sites' pages (that is what sending a GIF from the picker needs), else the picture's own. */
export function gifAddress(src: string, href: string | undefined): string {
    try {
        const host = href ? new URL(href).hostname.toLowerCase() : "";
        if (href && /^https:/i.test(href) && ["tenor.com", "klipy.com", "giphy.com"].some(site => host === site || host.endsWith(`.${site}`))) return href;
    } catch {
        // the link is not an address: the picture's own is used
    }
    return src;
}

/** The text of the export file and the collections read back from one. */
export function exportText(list: readonly Collection[]): string {
    return `${JSON.stringify({ format: "amiricord-gif-collections", version: 1, collections: list }, null, 1)}\n`;
}

export function readExport(text: string): Collection[] | undefined {
    try {
        const data = JSON.parse(text) as { format?: unknown; version?: unknown; collections?: unknown; };
        return data.format === "amiricord-gif-collections" && data.version === 1 ? readCollections(data.collections) : undefined;
    } catch {
        return undefined;
    }
}
