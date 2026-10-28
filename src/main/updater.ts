/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The updater's work in the main process, without Electron: the network, the files and the clock are handed to it, so it is tested with fakes.
// It looks at the latest release of the project's repository on GitHub (`update.json`: the version, the SHA-256 and size of the four engine files, and the news), and when asked
// installs a newer one: every file is downloaded to a staging folder, checked against the manifest, and only when ALL four are right are they put in place; the files they replace
// are kept in `.previous` and put back if anything goes wrong half way. The page only says "check" or "install"; it never names an address or a file.
// Safety rests on HTTPS, on the SHA-256 in the release and on the owners' GitHub accounts (two-step login); there is no signature (the owners' decision, 2026-10-28).

import { createHash } from "node:crypto";
import { join } from "node:path";

import { compareVersions, isVersion, newsSince, parseManifest, UPDATE_FILES, type UpdateAnswer, type UpdateManifest } from "../shared/updates";

export const MANIFEST_NAME = "update.json";
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const STAGING_FOLDER = ".update";
export const PREVIOUS_FOLDER = ".previous";
export const UPDATE_HOST = "github.com";

export interface UpdaterFiles {
    mkdir(path: string): Promise<void>;
    writeFile(path: string, bytes: Uint8Array): Promise<void>;
    copyFile(from: string, to: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    /** Removes a file or a folder with what is in it. Nothing happens when it is not there. */
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}

export interface UpdaterDeps {
    /** `owner/name` of the GitHub repository whose releases are read. */
    repo: string;
    /** The version of the engine that is running. */
    currentVersion: string;
    /** The folder Discord loads the engine from (`%APPDATA%\Amiricord\<branch>\dist`). */
    distDir: string;
    /** GET an address and give its body; rejects when the answer is not a success or is bigger than `maxBytes`. Follows redirects. */
    fetchBytes(url: string, maxBytes: number): Promise<Uint8Array>;
    /** True when the owner blocked this host in the firewall. */
    isBlocked(hostname: string): boolean;
    files: UpdaterFiles;
}

const REPO = /^[A-Za-z0-9_.-]{1,60}\/[A-Za-z0-9_.-]{1,100}$/;

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sentence = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f]+/g, " ").slice(0, 160);

export function manifestUrl(repo: string): string {
    return `https://${UPDATE_HOST}/${repo}/releases/latest/download/${MANIFEST_NAME}`;
}

/** The release of one version is the tag `v<version>`; the version was checked to be digits and dots, so no other address can be made. */
export function fileUrl(repo: string, version: string, name: string): string {
    return `https://${UPDATE_HOST}/${repo}/releases/download/v${version}/${name}`;
}

export function createUpdater(deps: UpdaterDeps) {
    let busy = false;

    function ready(): string | null {
        if (!REPO.test(deps.repo)) return "the update source is not set up";
        if (!isVersion(deps.currentVersion)) return "this version has no valid number";
        if (deps.isBlocked(UPDATE_HOST)) return `${UPDATE_HOST} is on the list of sites you blocked`;
        return null;
    }

    async function readManifest(): Promise<UpdateManifest | string> {
        let bytes: Uint8Array;
        try {
            bytes = await deps.fetchBytes(manifestUrl(deps.repo), MAX_MANIFEST_BYTES);
        } catch (error) {
            return `could not reach the updates (${sentence(error)})`;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            return "the update file is not readable";
        }
        return parseManifest(parsed);
    }

    /** Looks at the latest release. Nothing is changed. */
    async function check(): Promise<UpdateAnswer> {
        const problem = ready();
        if (problem) return { status: "error", message: problem };
        const manifest = await readManifest();
        if (typeof manifest === "string") return { status: "error", message: manifest };
        if (compareVersions(manifest.version, deps.currentVersion) <= 0) return { status: "up-to-date", current: deps.currentVersion, latest: manifest.version };
        return { status: "available", current: deps.currentVersion, latest: manifest.version, news: newsSince(manifest.news, deps.currentVersion, manifest.version) };
    }

    /** Downloads a newer release, checks it, and puts it in place (or leaves everything as it was). The caller restarts Discord afterwards. */
    async function install(): Promise<UpdateAnswer> {
        const problem = ready();
        if (problem) return { status: "error", message: problem };
        if (busy) return { status: "error", message: "an update is already being installed" };
        busy = true;
        const staging = join(deps.distDir, STAGING_FOLDER);
        const previous = join(deps.distDir, PREVIOUS_FOLDER);
        const swapped: string[] = [];
        try {
            // Worked out again here: what the page saw earlier is not trusted.
            const manifest = await readManifest();
            if (typeof manifest === "string") return { status: "error", message: manifest };
            if (compareVersions(manifest.version, deps.currentVersion) <= 0) return { status: "error", message: "there is no newer version to install" };

            await deps.files.remove(staging);
            await deps.files.mkdir(staging);
            for (const name of UPDATE_FILES) {
                const expected = manifest.files[name];
                let bytes: Uint8Array;
                try {
                    bytes = await deps.fetchBytes(fileUrl(deps.repo, manifest.version, name), expected.size);
                } catch (error) {
                    return { status: "error", message: `could not download ${name} (${sentence(error)}); nothing was changed` };
                }
                if (bytes.length !== expected.size) return { status: "error", message: `${name} has not the size the release says; nothing was changed` };
                if (sha256Of(bytes) !== expected.sha256) return { status: "error", message: `${name} does not match its fingerprint, so it was not installed; nothing was changed` };
                await deps.files.writeFile(join(staging, name), bytes);
            }

            // Every file is right. The old ones are kept first, then each new one takes its place.
            await deps.files.remove(previous);
            await deps.files.mkdir(previous);
            for (const name of UPDATE_FILES) {
                if (await deps.files.exists(join(deps.distDir, name))) await deps.files.copyFile(join(deps.distDir, name), join(previous, name));
            }
            try {
                for (const name of UPDATE_FILES) {
                    await deps.files.rename(join(staging, name), join(deps.distDir, name));
                    swapped.push(name);
                }
            } catch (error) {
                for (const name of swapped) {
                    try {
                        if (await deps.files.exists(join(previous, name))) await deps.files.copyFile(join(previous, name), join(deps.distDir, name));
                    } catch {
                        // Nothing more can be done for this file; the message below says so.
                    }
                }
                return { status: "error", message: `could not put the new files in place (${sentence(error)}); the old ones were put back` };
            }
            return { status: "installed", current: deps.currentVersion, installed: manifest.version };
        } catch (error) {
            return { status: "error", message: `the update could not be installed (${sentence(error)})` };
        } finally {
            try {
                await deps.files.remove(staging);
            } catch {
                // A leftover staging folder is overwritten the next time.
            }
            busy = false;
        }
    }

    return { check, install };
}
