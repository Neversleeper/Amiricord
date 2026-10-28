/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The part of `pnpm release` that decides what `update.json` says, without touching the disk, so it is tested. The same checks the app makes when it reads the file
// are made here first (`parseManifest`), so a release that the app would refuse is never made.

import { createHash } from "node:crypto";

import { compareVersions, isVersion, MAX_NEWS_ENTRIES, type NewsEntry, parseManifest, parseNewsEntry, UPDATE_FILES, type UpdateManifest } from "../src/shared/updates";

export interface ReleaseInput {
    /** The version of package.json. */
    version: string;
    /** The built engine files, by name. */
    files: Record<string, Uint8Array>;
    /** The text of NEWS.json. */
    newsText: string;
}

export interface ReleaseResult {
    /** The text to write as `update.json`. */
    manifestText: string;
    manifest: UpdateManifest;
}

/** The `update.json` of a release, or a list of what is wrong. */
export function makeRelease(input: ReleaseInput): ReleaseResult | string[] {
    const problems: string[] = [];
    if (!isVersion(input.version)) problems.push(`the version "${input.version}" is not major.minor.patch`);

    const files: Record<string, { sha256: string; size: number; }> = {};
    for (const name of UPDATE_FILES) {
        const bytes = input.files[name];
        if (!bytes || bytes.length === 0) {
            problems.push(`${name} is missing or empty (run pnpm build first)`);
            continue;
        }
        files[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
    }

    let rawNews: unknown;
    try {
        rawNews = JSON.parse(input.newsText);
    } catch {
        problems.push("NEWS.json is not valid JSON");
    }
    const news: NewsEntry[] = [];
    if (Array.isArray(rawNews)) {
        for (const [index, entry] of rawNews.entries()) {
            const parsed = parseNewsEntry(entry);
            if (!parsed) problems.push(`NEWS.json entry ${index + 1} needs a version (major.minor.patch) and a title`);
            else news.push(parsed);
        }
    } else if (rawNews !== undefined) {
        problems.push("NEWS.json must be a list of entries");
    }
    if (isVersion(input.version)) {
        if (!news.some(entry => entry.version === input.version)) problems.push(`NEWS.json has no entry for version ${input.version}: write what changed first`);
        if (news.some(entry => compareVersions(entry.version, input.version) > 0)) problems.push(`NEWS.json has an entry newer than ${input.version}`);
    }
    if (problems.length > 0) return problems;

    news.sort((a, b) => compareVersions(b.version, a.version));
    const manifestObject = { schema: 1, version: input.version, files, news: news.slice(0, MAX_NEWS_ENTRIES) };
    const manifest = parseManifest(manifestObject);
    if (typeof manifest === "string") return [manifest];
    return { manifestText: `${JSON.stringify(manifestObject, null, 4)}\n`, manifest };
}
