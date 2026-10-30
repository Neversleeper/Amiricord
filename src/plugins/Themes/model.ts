/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The data side of the Themes plugin, without Discord and without a page: reading the header of a theme file, finding the other computers a theme would contact, the list of
// themes as it is saved, and the export file (settings, plugins' choices, the quick CSS and the themes in one file) with its checks on the way back in.
// The header format is the one BetterDiscord themes use (a comment that starts with `/**` and has lines `@name`, `@author`...); the reader is written here from the format
// description, not copied (TestCord's `main/themes` file is Apache-2.0 BetterDiscord code and is not used).

import { parseSettings, type SettingsData } from "../../shared/settings";

export const MAX_THEMES = 40;
export const MAX_CSS_CHARS = 400_000;
export const MAX_NAME_CHARS = 60;
export const EXPORT_FORMAT = "amiricord-export";
export const EXPORT_VERSION = 1;

export interface ThemeMeta { name: string; author: string; description: string; version: string; }

/** The text of the comment of BetterDiscord's header, if the file starts with one (within its first 4000 characters). */
function headerBlock(css: string): string | undefined {
    const start = css.slice(0, 4000).indexOf("/**");
    if (start === -1) return undefined;
    const end = css.indexOf("*/", start + 3);
    return end === -1 ? undefined : css.slice(start + 3, end);
}

/** The name, author, description and version of a theme from its header; the file name is the name when the header has none. Never throws. */
export function parseHeader(css: string, fileName: string): ThemeMeta {
    const fields = new Map<string, string>();
    const block = headerBlock(css.charCodeAt(0) === 0xfeff ? css.slice(1) : css);
    if (block) {
        let current = "";
        for (const raw of block.split(/\r?\n/)) {
            const line = raw.replace(/^\s*\*?\s?/, "");
            const field = /^@(\w+)(?:\s+(.*))?$/.exec(line);
            if (field) {
                current = field[1]!.toLowerCase();
                if (!fields.has(current)) fields.set(current, (field[2] ?? "").trim());
                else current = "";
            } else if (current !== "" && line.trim() !== "") {
                fields.set(current, `${fields.get(current)} ${line.replace(/^\\@/, "@").trim()}`.trim());
            }
        }
    }
    const plain = fileName.replace(/\.theme\.css$/i, "").replace(/\.css$/i, "");
    const clean = (value: string | undefined, limit: number) => (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
    return {
        name: clean(fields.get("name"), MAX_NAME_CHARS) || clean(plain, MAX_NAME_CHARS) || "Theme",
        author: clean(fields.get("author"), 80),
        description: clean(fields.get("description"), 400),
        version: clean(fields.get("version"), 30)
    };
}

/** The hosts a stylesheet would ask for (`@import` and `url()` with an address on the web), once each, in order of appearance. `data:` addresses and local ones are not listed. */
export function remoteHosts(css: string): string[] {
    const hosts: string[] = [];
    const found = new Set<string>();
    const patterns = [/@import\s+(?:url\(\s*)?["']?\s*((?:https?:)?\/\/[^"')\s;]+)/gi, /url\(\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)/gi];
    for (const pattern of patterns) {
        for (const match of css.matchAll(pattern)) {
            let host: string;
            try {
                host = new URL(match[1]!.startsWith("//") ? `https:${match[1]}` : match[1]!).hostname.toLowerCase();
            } catch {
                continue;
            }
            if (host !== "" && !found.has(host)) { found.add(host); hosts.push(host); }
        }
    }
    return hosts;
}

export interface ThemeEntry { id: string; name: string; author: string; description: string; version: string; enabled: boolean; }

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A plain id made from a name, different from the ones in use. */
export function makeId(name: string, taken: readonly string[]): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";
    if (!taken.includes(base)) return base;
    for (let n = 2; n < 1000; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
    return `${base}-${Date.now()}`;
}

/** The saved list read back: only well-formed entries, each id once, at most `MAX_THEMES`. */
export function readIndex(value: unknown): ThemeEntry[] {
    if (!Array.isArray(value)) return [];
    const out: ThemeEntry[] = [];
    for (const raw of value) {
        if (out.length >= MAX_THEMES) break;
        if (typeof raw !== "object" || raw === null) continue;
        const entry = raw as Partial<ThemeEntry>;
        if (typeof entry.id !== "string" || !ID.test(entry.id) || out.some(other => other.id === entry.id)) continue;
        const text = (field: unknown, limit: number) => (typeof field === "string" ? field.slice(0, limit) : "");
        out.push({ id: entry.id, name: text(entry.name, MAX_NAME_CHARS) || entry.id, author: text(entry.author, 80), description: text(entry.description, 400), version: text(entry.version, 30), enabled: entry.enabled === true });
    }
    return out;
}

/** Why a stylesheet cannot be used, or null. */
export function cssProblem(css: unknown): string | null {
    if (typeof css !== "string") return "the style is not text";
    if (css.length > MAX_CSS_CHARS) return `the style is too big (the limit is ${MAX_CSS_CHARS} characters)`;
    return null;
}

export interface ExportParts {
    settings?: SettingsData;
    quickCss?: string;
    themes?: Array<{ name: string; enabled: boolean; css: string; }>;
}

export function buildExport(parts: ExportParts, version: string, now: Date): string {
    return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, amiricord: version, exportedAt: now.toISOString(), ...parts }, null, 1) + "\n";
}

export interface ParsedExport {
    settings?: SettingsData;
    quickCss?: string;
    themes: Array<{ name: string; enabled: boolean; css: string; }>;
    problems: string[];
}

/** Reads an export file. Anything not plain is left out and said in `problems`; a file that is not an Amiricord export gives an error. */
export function parseExport(text: string): { ok: true; value: ParsedExport; } | { ok: false; error: string; } {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { ok: false, error: "the file is not valid JSON" };
    }
    if (typeof data !== "object" || data === null || (data as { format?: unknown; }).format !== EXPORT_FORMAT) return { ok: false, error: "the file is not an Amiricord export" };
    const raw = data as { version?: unknown; settings?: unknown; quickCss?: unknown; themes?: unknown; };
    if (raw.version !== EXPORT_VERSION) return { ok: false, error: "the file comes from a version of the export this one does not know" };
    const problems: string[] = [];
    const value: ParsedExport = { themes: [], problems };
    if (raw.settings !== undefined) {
        const parsed = parseSettings(JSON.stringify(raw.settings));
        value.settings = parsed.settings;
        problems.push(...parsed.problems);
    }
    if (raw.quickCss !== undefined) {
        const problem = cssProblem(raw.quickCss);
        if (problem) problems.push(`the quick CSS was left out: ${problem}`); else value.quickCss = raw.quickCss as string;
    }
    if (Array.isArray(raw.themes)) {
        for (const item of raw.themes) {
            if (value.themes.length >= MAX_THEMES) { problems.push("too many themes, the rest were left out"); break; }
            const theme = item as { name?: unknown; enabled?: unknown; css?: unknown; } | null;
            const problem = cssProblem(theme?.css);
            if (typeof theme?.name !== "string" || theme.name.trim() === "") { problems.push("a theme without a name was left out"); continue; }
            if (problem) { problems.push(`the theme "${theme.name.slice(0, 40)}" was left out: ${problem}`); continue; }
            value.themes.push({ name: theme.name.trim().slice(0, MAX_NAME_CHARS), enabled: theme.enabled === true, css: theme.css as string });
        }
    } else if (raw.themes !== undefined) {
        problems.push("the list of themes is not a list and was left out");
    }
    return { ok: true, value };
}

/** The text that asks the owner before a theme that contacts other computers is switched on. */
export function hostsQuestion(name: string, hosts: readonly string[]): string {
    return `The theme "${name}" asks these addresses for files when it is on:\n\n${hosts.slice(0, 15).join("\n")}${hosts.length > 15 ? `\n...and ${hosts.length - 15} more` : ""}\n\nEach of them learns your internet address and that you use this theme. Turn it on?`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The library of themes (the catalogue TestCord shows, kept at themes.equicord.org) and themes added by address

export const LIBRARY_URL = "https://themes.equicord.org/api/themes";
/** The only computers a theme may be fetched from by address; each is declared in the manifest, so nothing else can be reached. */
export const THEME_HOSTS = ["themes.equicord.org", "raw.githubusercontent.com", "gist.githubusercontent.com"] as const;
export const MAX_LIBRARY = 3000;
/** Preview pictures are kept in this folder of the library's server; an address anywhere else is not used. */
export const THUMBNAIL_PREFIX = "https://themes.equicord.org/thumbnails/";
export const thumbnailAddress = (value: unknown): string => (typeof value === "string" && value.startsWith(THUMBNAIL_PREFIX) && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value) ? value : "");
/** The address of one theme's CSS in the library. */
export const libraryThemeUrl = (id: number): string => `https://themes.equicord.org/api/${id}`;

export interface LibraryTheme {
    id: number;
    name: string;
    author: string;
    description: string;
    tags: string[];
    downloads: number;
    likes: number;
    released: number;
    /** The address of the preview picture on the library's own server, or an empty text. */
    thumbnail: string;
}

/** The themes of a catalogue answer (an object or a list); entries that are not themes, have no name or have a style too big are left out. */
export function parseLibrary(data: unknown): LibraryTheme[] {
    const items = Array.isArray(data) ? data : typeof data === "object" && data !== null ? Object.values(data) : [];
    const out: LibraryTheme[] = [];
    const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "");
    const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
    for (const raw of items) {
        if (out.length >= MAX_LIBRARY) break;
        if (typeof raw !== "object" || raw === null) continue;
        const item = raw as Record<string, unknown>;
        if (item.type !== undefined && item.type !== "" && item.type !== "theme") continue;
        const name = text(item.name, MAX_NAME_CHARS);
        if (typeof item.id !== "number" || !Number.isSafeInteger(item.id) || name === "" || typeof item.content !== "string" || item.content === "" || item.content.length > MAX_CSS_CHARS * 2) continue;
        const author = typeof item.author === "object" && item.author !== null ? item.author as Record<string, unknown> : {};
        const released = typeof item.release_date === "string" ? Date.parse(item.release_date) : NaN;
        out.push({
            id: item.id, name, author: text(author.discord_name, 80) || text(author.github_name, 80), description: text(item.description, 400),
            tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string").map(tag => text(tag, 24)).filter(Boolean).slice(0, 6) : [],
            downloads: count(item.downloads), likes: count(item.likes), released: Number.isFinite(released) ? released : 0, thumbnail: thumbnailAddress(item.thumbnail_url)
        });
    }
    return out;
}

export type LibrarySort = "downloads" | "likes" | "name" | "newest";
export const LIBRARY_SORTS: ReadonlyArray<{ value: LibrarySort; label: string; }> = [
    { value: "downloads", label: "Most downloaded" }, { value: "likes", label: "Most liked" }, { value: "newest", label: "Newest" }, { value: "name", label: "Name" }
];

/** The themes whose name, author, description or tags hold every word of the search, in the chosen order. A new list; the given one is not changed. */
export function searchLibrary(list: readonly LibraryTheme[], query: string, sort: LibrarySort): LibraryTheme[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = list.filter(theme => {
        const haystack = `${theme.name} ${theme.author} ${theme.description} ${theme.tags.join(" ")}`.toLowerCase();
        return words.every(word => haystack.includes(word));
    });
    const order: Record<LibrarySort, (a: LibraryTheme, b: LibraryTheme) => number> = {
        downloads: (a, b) => b.downloads - a.downloads, likes: (a, b) => b.likes - a.likes, newest: (a, b) => b.released - a.released, name: (a, b) => a.name.localeCompare(b.name)
    };
    return found.sort(order[sort]);
}

/** Why a theme cannot be fetched from this address, or null. Only `https` and only the hosts in `THEME_HOSTS`. */
export function addressProblem(address: string): string | null {
    let url: URL;
    try {
        url = new URL(address.trim());
    } catch {
        return "that is not an address";
    }
    if (url.protocol !== "https:") return "the address must start with https://";
    if (!(THEME_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) return `themes can be fetched from ${THEME_HOSTS.join(", ")} only (use "Import a theme file" for others)`;
    return null;
}
