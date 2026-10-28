/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The engine files that Discord loads live in `%APPDATA%\Amiricord\<branch>\dist` (one folder per Discord: stable, canary, ptb), a copy of the project's `dist`, so Discord
// does not depend on the project folder staying where it is. The copy is first made next to it (staging), checked file
// by file, and only then swapped in as part of the same transaction as the Discord patch.

import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { hashFile } from "./hash";
import type { Step } from "./transaction";

/** What the build produces and the loader needs. */
export const DIST_FILES = ["main.js", "preload.js", "renderer.js", "registry.json"] as const;

/** The file Discord's loader requires. */
export const DIST_ENTRY = "main.js";

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Names of build files that are missing from the source folder. Empty means it is complete. */
export async function missingDistFiles(source: string): Promise<string[]> {
    const missing: string[] = [];
    for (const name of DIST_FILES) {
        if (!(await exists(join(source, name)))) missing.push(name);
    }
    return missing;
}

export interface DistPaths {
    /** `%APPDATA%\Amiricord\dist`: what the loader points into. */
    target: string;
    staging: string;
    old: string;
}

/** The files of the owner's choices that the old layout (everything in the root of the data folder) kept, and that a new folder starts from. */
export const CARRIED_FILES = ["settings.json", "firewall.json"] as const;

/**
 * The first time a Discord gets its own folder, its settings and host rules start from the old ones (copied, never moved or deleted). Nothing else is
 * carried: the health report, the boot state, the probe dumps, the trace and the development flag start clean. A file the new folder already has is left alone.
 */
export async function carryOldFiles(oldFolder: string, newFolder: string): Promise<Step[]> {
    const steps: Step[] = [];
    for (const name of CARRIED_FILES) {
        const from = join(oldFolder, name);
        const to = join(newFolder, name);
        const info = await stat(from).catch(() => null);
        if (info?.isFile() && !(await exists(to))) steps.push({ type: "copy", from, to });
    }
    return steps;
}

/** `dataDir` is the folder of ONE Discord (`%APPDATA%\Amiricord\<branch>`). */
export function distPaths(dataDir: string): DistPaths {
    return { target: join(dataDir, "dist"), staging: join(dataDir, "dist.staging"), old: join(dataDir, "dist.old") };
}

/** Copy the build into the staging folder and check every copy. Leftovers of an earlier try (ours) are cleared first. */
export async function stageDist(source: string, paths: DistPaths): Promise<Record<string, string>> {
    await rm(paths.staging, { recursive: true, force: true });
    await rm(paths.old, { recursive: true, force: true });
    await mkdir(paths.staging, { recursive: true });

    const hashes: Record<string, string> = {};
    try {
        for (const name of DIST_FILES) {
            await copyFile(join(source, name), join(paths.staging, name));
            const [from, to] = await Promise.all([hashFile(join(source, name)), hashFile(join(paths.staging, name))]);
            if (from !== to) throw new Error(`the copy of ${name} does not match the build`);
            hashes[name] = to;
        }
        return hashes;
    } catch (error) {
        await rm(paths.staging, { recursive: true, force: true });
        throw error;
    }
}

/** The swap as transaction steps: the old copy (if any) moves aside, the staged one takes its place. */
export async function distSwapSteps(paths: DistPaths): Promise<{ steps: Step[]; remove: string[]; }> {
    const steps: Step[] = [];
    const remove: string[] = [];
    if (await exists(paths.target)) {
        steps.push({ type: "rename", from: paths.target, to: paths.old });
        remove.push(paths.old);
    }
    steps.push({ type: "rename", from: paths.staging, to: paths.target });
    return { steps, remove };
}

/** Check that the installed copy is exactly what was staged. Returns the problems found. */
export async function verifyInstalledDist(target: string, hashes: Record<string, string>): Promise<string[]> {
    const problems: string[] = [];
    for (const [name, hash] of Object.entries(hashes)) {
        try {
            if ((await hashFile(join(target, name))) !== hash) problems.push(`${name} in ${target} does not match the build`);
        } catch {
            problems.push(`${name} is missing from ${target}`);
        }
    }
    return problems;
}
