/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the updater's two sides share: the question the page may ask, the answer it gets, the file a release carries (`update.json`) and how versions are compared.
// Everything here is plain data checked field by field, because the manifest comes from the network and the question from a page that runs Discord's code.
// The updater is the one exception to "no network except Discord" (docs/decisions.md, 2026-10-28): it only talks to the project's GitHub releases, only when the
// person presses a button, and installs nothing whose SHA-256 differs from the one in the manifest.

/** The files of an install that an update replaces. The same four the installer copies into `%APPDATA%\Amiricord\<branch>\dist`. */
export const UPDATE_FILES = ["main.js", "preload.js", "renderer.js", "registry.json"] as const;
export type UpdateFileName = typeof UPDATE_FILES[number];

/** Largest file an update may bring (the biggest today is about 1.5 MB). */
export const MAX_UPDATE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_NEWS_ENTRIES = 20;
export const MAX_NEWS_NOTES = 12;
export const MAX_NEWS_TEXT = 240;

export interface NewsEntry {
    version: string;
    /** `YYYY-MM-DD`, or empty. */
    date: string;
    title: string;
    /** Short sentences about what changed, for people. */
    notes: string[];
    /** The GitHub name of the person who published the version, when the entry says it. */
    author?: string;
}

export interface UpdateFile {
    sha256: string;
    size: number;
}

/** The `update.json` file of a release. */
export interface UpdateManifest {
    version: string;
    files: Record<UpdateFileName, UpdateFile>;
    news: NewsEntry[];
}

/** What the page may ask. It never sends an address or a file name: the main process works those out. */
export type UpdateRequest = { type: "check"; } | { type: "install"; };

export type UpdateAnswer =
    | { status: "up-to-date"; current: string; latest: string; }
    | { status: "available"; current: string; latest: string; news: NewsEntry[]; }
    | { status: "installed"; current: string; installed: string; }
    | { status: "error"; message: string; };

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

export const isVersion = (value: unknown): value is string => isString(value) && VERSION.test(value);

/** Negative when `a` is older than `b`, zero when they are the same, positive when `a` is newer. Both must be `major.minor.patch`. */
export function compareVersions(a: string, b: string): number {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

const clean = (value: unknown, limit = MAX_NEWS_TEXT): string => (isString(value) ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit) : "");

/** One news entry, rebuilt with only the known fields, or null when it is not one. */
export function parseNewsEntry(value: unknown): NewsEntry | null {
    if (!isRecord(value) || !isVersion(value.version)) return null;
    const title = clean(value.title, 120);
    if (title === "") return null;
    const notes = Array.isArray(value.notes) ? value.notes.map(note => clean(note)).filter(note => note !== "").slice(0, MAX_NEWS_NOTES) : [];
    const entry: NewsEntry = { version: value.version, date: isString(value.date) && DATE.test(value.date) ? value.date : "", title, notes };
    if (isString(value.author) && GITHUB_NAME.test(value.author)) entry.author = value.author;
    return entry;
}

/** The `update.json` of a release, rebuilt with only the known fields, or a sentence saying what is wrong with it. */
export function parseManifest(value: unknown): UpdateManifest | string {
    if (!isRecord(value)) return "the update file is not in the expected form";
    if (value.schema !== 1) return "the update file is of a kind this version does not know";
    if (!isVersion(value.version)) return "the update file has no valid version";
    if (!isRecord(value.files)) return "the update file lists no files";
    const files = {} as Record<UpdateFileName, UpdateFile>;
    for (const name of UPDATE_FILES) {
        const file = value.files[name];
        if (!isRecord(file) || !isString(file.sha256) || !SHA256.test(file.sha256)
            || typeof file.size !== "number" || !Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_UPDATE_FILE_BYTES) {
            return `the update file does not describe ${name} properly`;
        }
        files[name] = { sha256: file.sha256, size: file.size };
    }
    const news = (Array.isArray(value.news) ? value.news : []).map(parseNewsEntry).filter((entry): entry is NewsEntry => entry !== null).slice(0, MAX_NEWS_ENTRIES);
    return { version: value.version, files, news };
}

/** The entries that are newer than `current` and not newer than `latest`, newest first. */
export function newsSince(news: readonly NewsEntry[], current: string, latest: string): NewsEntry[] {
    return news
        .filter(entry => compareVersions(entry.version, current) > 0 && compareVersions(entry.version, latest) <= 0)
        .sort((a, b) => compareVersions(b.version, a.version));
}

/** The patch notes that come inside the program (NEWS.json): the entries up to the version that is running, newest first. Anything that is not an entry is left out. */
export function releasedNews(raw: unknown, current: string): NewsEntry[] {
    const entries = (Array.isArray(raw) ? raw : []).map(parseNewsEntry).filter((entry): entry is NewsEntry => entry !== null);
    return entries.filter(entry => compareVersions(entry.version, current) <= 0).sort((a, b) => compareVersions(b.version, a.version)).slice(0, MAX_NEWS_ENTRIES);
}

/** What the page asked, or null when it is not one of the two questions. Anything extra the page sent is dropped. */
export function parseUpdateRequest(value: unknown): UpdateRequest | null {
    if (!isRecord(value)) return null;
    return value.type === "check" || value.type === "install" ? { type: value.type } : null;
}

/** The answer in the page, rebuilt field by field, or null when it is not one. */
export function parseUpdateAnswer(value: unknown): UpdateAnswer | null {
    if (!isRecord(value) || !isString(value.status)) return null;
    switch (value.status) {
        case "up-to-date":
            return isVersion(value.current) && isVersion(value.latest) ? { status: "up-to-date", current: value.current, latest: value.latest } : null;
        case "available": {
            if (!isVersion(value.current) || !isVersion(value.latest)) return null;
            const news = (Array.isArray(value.news) ? value.news : []).map(parseNewsEntry).filter((entry): entry is NewsEntry => entry !== null).slice(0, MAX_NEWS_ENTRIES);
            return { status: "available", current: value.current, latest: value.latest, news };
        }
        case "installed":
            return isVersion(value.current) && isVersion(value.installed) ? { status: "installed", current: value.current, installed: value.installed } : null;
        case "error":
            return { status: "error", message: clean(value.message, 300) || "something went wrong" };
        default:
            return null;
    }
}
