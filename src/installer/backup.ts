/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A copy of the files the installer is about to touch, checked byte by byte (SHA-256) before anything is changed.
// If the copy does not match, the operation stops before Discord is touched.

import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PROJECT_NAME } from "../shared/project";
import { hashFile } from "./hash";

/** What gets copied from `resources`, when it exists. */
export const BACKUP_FILES = ["app.asar", "_app.asar", "build_info.json"] as const;

export const BACKUP_MANIFEST = "manifest.json";

export interface BackupFile {
    name: string;
    size: number;
    sha256: string;
}

export interface BackupManifest {
    schema: 1;
    tool: string;
    branch: string;
    /** `app-1.0.1281` */
    appVersion: string;
    /** State of `resources` when the copy was made. */
    state: string;
    createdAt: string;
    files: BackupFile[];
}

export interface BackupInfo {
    dir: string;
    manifest: BackupManifest;
}

/** `20261024-103045`, in UTC, safe to use in a folder name. */
export function timestamp(date: Date): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, "0");
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

const exists = async (path: string) => stat(path).then(() => true, () => false);

export interface CreateBackupArgs {
    resources: string;
    /** `%APPDATA%\Amiricord\backups` */
    backupRoot: string;
    branch: string;
    appVersion: string;
    state: string;
    now?: Date;
    /** How a file is copied. Only tests change this, to make a copy go wrong. */
    copy?: (from: string, to: string) => Promise<void>;
    /** How a backup folder is made (one level, failing with EEXIST when it is taken). Only tests change this. */
    makeDir?: (dir: string) => Promise<unknown>;
}

/** How many names are tried before giving up. A folder that is really taken has a few neighbours at most; more means the answer "taken" cannot be trusted. */
export const MAX_BACKUP_NAME_TRIES = 200;

/**
 * Create a new folder for a backup. A name that is already taken gets `-2`, `-3`...: a backup is never written over another. It gives up after
 * `MAX_BACKUP_NAME_TRIES` names: a data folder that is a link (to another drive, made by some tools) can answer "already exists" to every name, and without a limit
 * this looped for ever.
 */
async function makeUniqueDir(root: string, name: string, make: (dir: string) => Promise<unknown> = dir => mkdir(dir)): Promise<string> {
    await mkdir(root, { recursive: true });
    for (let n = 1; n <= MAX_BACKUP_NAME_TRIES; n++) {
        const dir = join(root, n === 1 ? name : `${name}-${n}`);
        try {
            await make(dir);
            return dir;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
    }
    throw new Error(`no backup folder could be made in ${root}: every name looked taken (${MAX_BACKUP_NAME_TRIES} tried). If this folder is a link to another place, use the real folder`);
}

/** Copy the files, check the copies, write the manifest. A copy that fails any check is removed and the error is thrown. */
export async function createBackup(args: CreateBackupArgs): Promise<BackupInfo> {
    const now = args.now ?? new Date();
    const dir = await makeUniqueDir(args.backupRoot, `${args.branch}-${args.appVersion}-${timestamp(now)}`, args.makeDir);

    try {
        const files: BackupFile[] = [];
        for (const name of BACKUP_FILES) {
            const source = join(args.resources, name);
            if (!(await exists(source))) continue;

            const target = join(dir, name);
            await (args.copy ?? copyFile)(source, target);
            const [sourceHash, targetHash] = await Promise.all([hashFile(source), hashFile(target)]);
            if (sourceHash !== targetHash) throw new Error(`the backup copy of ${name} does not match the original`);
            files.push({ name, size: (await stat(target)).size, sha256: targetHash });
        }
        if (files.length === 0) throw new Error("there is nothing to back up in the resources folder");

        const manifest: BackupManifest = {
            schema: 1, tool: PROJECT_NAME, branch: args.branch, appVersion: args.appVersion, state: args.state, createdAt: now.toISOString(), files
        };
        await writeFile(join(dir, BACKUP_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
        return { dir, manifest };
    } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
    }
}

function isManifest(value: unknown): value is BackupManifest {
    if (typeof value !== "object" || value === null) return false;
    const m = value as Record<string, unknown>;
    return m.schema === 1 && typeof m.branch === "string" && typeof m.appVersion === "string" && typeof m.state === "string"
        && typeof m.createdAt === "string" && Array.isArray(m.files)
        && m.files.every(f => typeof f === "object" && f !== null && typeof (f as BackupFile).name === "string"
            && typeof (f as BackupFile).sha256 === "string" && typeof (f as BackupFile).size === "number");
}

/** Read one backup's manifest. Returns null when it is missing or damaged. */
export async function readBackup(dir: string): Promise<BackupInfo | null> {
    try {
        const manifest: unknown = JSON.parse(await readFile(join(dir, BACKUP_MANIFEST), "utf8"));
        return isManifest(manifest) ? { dir, manifest } : null;
    } catch {
        return null;
    }
}

/** Every readable backup, newest first. Folders without a valid manifest are skipped. */
export async function listBackups(backupRoot: string): Promise<BackupInfo[]> {
    let names: string[];
    try {
        names = await readdir(backupRoot);
    } catch {
        return [];
    }
    const found: BackupInfo[] = [];
    for (const name of names) {
        const info = await readBackup(join(backupRoot, name));
        if (info) found.push(info);
    }
    return found.sort((a, b) => (a.manifest.createdAt < b.manifest.createdAt ? 1 : a.manifest.createdAt > b.manifest.createdAt ? -1 : 0));
}

/** Check every file of a backup against its manifest. Returns the problems found; empty means it is intact. */
export async function verifyBackup(info: BackupInfo): Promise<string[]> {
    const problems: string[] = [];
    for (const file of info.manifest.files) {
        const path = join(info.dir, file.name);
        try {
            if ((await hashFile(path)) !== file.sha256) problems.push(`${file.name} does not match its saved hash`);
        } catch {
            problems.push(`${file.name} is missing or cannot be read`);
        }
    }
    return problems;
}
