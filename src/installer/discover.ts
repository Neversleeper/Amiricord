/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Finds Discord on Windows. Discord installs itself in `%LOCALAPPDATA%\<name>` with one `app-X.Y.Z` folder per version;
// the newest one is the one that runs.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type Branch = "stable" | "canary" | "ptb";

export const BRANCHES: readonly Branch[] = ["stable", "canary", "ptb"];

/** Folder of each branch inside `%LOCALAPPDATA%`. */
export const BRANCH_DIRS: Record<Branch, string> = { stable: "Discord", canary: "DiscordCanary", ptb: "DiscordPTB" };

/** Program that each branch runs. */
export const BRANCH_EXES: Record<Branch, string> = { stable: "Discord.exe", canary: "DiscordCanary.exe", ptb: "DiscordPTB.exe" };

export function isBranch(value: unknown): value is Branch {
    return typeof value === "string" && (BRANCHES as readonly string[]).includes(value);
}

/** `app-1.0.9265` gives `[1, 0, 9265]`; anything else gives null. */
export function parseAppVersion(folderName: string): number[] | null {
    const match = /^app-(\d+(?:\.\d+)*)$/.exec(folderName);
    return match ? match[1].split(".").map(Number) : null;
}

/** Numbers are compared as numbers (so 9265 comes before 10000), and a longer version wins a tie. */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return a.length - b.length;
}

export interface AppFolder {
    /** `app-1.0.1281` */
    name: string;
    version: number[];
    path: string;
    resources: string;
}

export interface Install {
    branch: Branch;
    /** `%LOCALAPPDATA%\DiscordCanary` and the like. */
    root: string;
    /** Every `app-X` folder that has a `resources` folder, oldest first. */
    apps: AppFolder[];
    /** The newest one: the one that runs. Null when there is none. */
    active: AppFolder | null;
}

const isDirectory = async (path: string) => {
    try {
        const entries = await readdir(path);
        return Array.isArray(entries);
    } catch {
        return false;
    }
};

/** Look for one branch. Returns null when its folder does not exist. */
export async function findInstall(localAppData: string, branch: Branch): Promise<Install | null> {
    const root = join(localAppData, BRANCH_DIRS[branch]);
    let names: string[];
    try {
        names = await readdir(root);
    } catch {
        return null;
    }

    const apps: AppFolder[] = [];
    for (const name of names) {
        const version = parseAppVersion(name);
        if (!version) continue;
        const path = join(root, name);
        const resources = join(path, "resources");
        if (await isDirectory(resources)) apps.push({ name, version, path, resources });
    }
    apps.sort((a, b) => compareVersions(a.version, b.version));
    return { branch, root, apps, active: apps.at(-1) ?? null };
}
