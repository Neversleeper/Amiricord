/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The real pieces the updater is given in the program (the disk and a fetch function), and the answer to what the page asks. Kept out of `electronGlue.ts` so it is
// tested without Electron: the fetch function is handed in (`net.fetch` in the program, Chromium's network stack, so it follows the encrypted DNS choice).

import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";

import { parseUpdateRequest, type UpdateAnswer } from "../shared/updates";
import type { createUpdater, UpdaterFiles } from "./updater";

export const UPDATE_TIMEOUT_MS = 60_000;

export interface FetchResponseLike {
    ok: boolean;
    status: number;
    headers: { get(name: string): string | null; };
    arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init: { redirect: "follow"; signal: AbortSignal; }) => Promise<FetchResponseLike>;

export function realFiles(): UpdaterFiles {
    return {
        mkdir: async path => { await mkdir(path, { recursive: true }); },
        writeFile: (path, bytes) => writeFile(path, bytes),
        copyFile: (from, to) => copyFile(from, to),
        rename: (from, to) => rename(from, to),
        remove: path => rm(path, { recursive: true, force: true }),
        exists: path => stat(path).then(() => true, () => false)
    };
}

/** GET and read the whole body, refusing an answer that is not a success or is bigger than `maxBytes` (said by the header, and checked again on what arrived). */
export function makeFetchBytes(fetchImpl: FetchLike) {
    return async (url: string, maxBytes: number): Promise<Uint8Array> => {
        const response = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`the server answered ${response.status}`);
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) throw new Error("the file is bigger than expected");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > maxBytes) throw new Error("the file is bigger than expected");
        return bytes;
    };
}

/** What the page asked: only "check" and "install" are understood, and nothing else the page sent is used. Null when it was neither. */
export async function answerUpdateRequest(updater: ReturnType<typeof createUpdater>, request: unknown): Promise<UpdateAnswer | null> {
    const parsed = parseUpdateRequest(request);
    if (!parsed) return null;
    return parsed.type === "check" ? updater.check() : updater.install();
}
