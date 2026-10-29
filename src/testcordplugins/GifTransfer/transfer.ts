/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The part of GifTransfer that does not touch the page: reading and writing the file of favourite GIFs, and the import with its retries, its checking passes and the
// watch that puts back what Discord takes away. Everything it needs (the list, the way to add one, waiting, messages) is handed to it, so it is tested with fakes.
// Adapted for Amiricord (2026) from the plugin GifTransfer (by Neversleeper, who was called nnenaza) as found in TestCord (commit af92dba of its public repository).

export interface GifEntry {
    url: string;
    src: string;
    width: number;
    height: number;
    format: number;
    order: number;
}

export interface ExportFile {
    version: number;
    exportedAt: string;
    totalGifs: number;
    gifs: GifEntry[];
}

/** What is added to the favourites: an entry without its place in the list (Discord's side chooses the place). */
export type NewGif = Omit<GifEntry, "order">;

export interface TransferOptions {
    skipDuplicates: boolean;
    delayBetweenImports: number;
    autoIncreaseDelay: boolean;
    ensureCompleteImport: boolean;
    maxRetryPasses: number;
    retryPassDelay: number;
    settleWatch: boolean;
    settleWatchDuration: number;
}

export type ToastKind = "info" | "success" | "failure";

export interface TransferDeps {
    /** The favourites right now, by address. */
    current(): Record<string, { src?: string; width?: unknown; height?: unknown; format?: unknown; order?: unknown; }>;
    add(gif: NewGif): Promise<void>;
    /** Take one GIF out of the favourites, by its address. */
    remove(url: string): Promise<void>;
    /** Ask the person, before everything is deleted, whether they are sure. */
    confirm(count: number): boolean;
    sleep(ms: number): Promise<void>;
    now(): number;
    toast(message: string, kind?: ToastKind): void;
    log(message: string): void;
    warn(message: string, detail?: unknown): void;
    options(): TransferOptions;
}

export const DEFAULT_WIDTH = 498;
export const DEFAULT_HEIGHT = 280;
export const DEFAULT_FORMAT = 2;
export const MAX_DELAY_MS = 5000;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const MAX_SETTLE_ROUNDS = 5;
export const MAX_SETTLE_MS = 120_000;
export const WATCH_INTERVAL_MS = 1000;

function asNewGif(gif: Partial<GifEntry> & { url: string; }): NewGif {
    return {
        url: gif.url,
        src: gif.src ?? gif.url,
        width: Number(gif.width) || DEFAULT_WIDTH,
        height: Number(gif.height) || DEFAULT_HEIGHT,
        format: Number(gif.format) || DEFAULT_FORMAT
    };
}

/** True when Discord (or the network) answered "slow down". */
export function isRateLimit(error: unknown): boolean {
    const e = error as { status?: unknown; text?: unknown; body?: { retry_after?: unknown; }; } | null | undefined;
    return e?.status === 429 || (typeof e?.text === "string" && e.text.includes("rate limit")) || Boolean(e?.body?.retry_after);
}

/** The file to save, or null when there is nothing to export. */
export function buildExport(current: ReturnType<TransferDeps["current"]>, exportedAt: string): ExportFile | null {
    const entries = Object.entries(current);
    if (entries.length === 0) return null;
    const gifs: GifEntry[] = entries.map(([url, data]) => ({
        url,
        src: data.src ?? url,
        width: Number(data.width) || DEFAULT_WIDTH,
        height: Number(data.height) || DEFAULT_HEIGHT,
        format: Number(data.format) || DEFAULT_FORMAT,
        order: Number(data.order) || 0
    }));
    return { version: 2, exportedAt, totalGifs: gifs.length, gifs };
}

/** The parsed file when it has a list of GIFs, or null. */
export function parseExport(text: string): ExportFile | null {
    try {
        const data = JSON.parse(text) as ExportFile | null;
        return data && Array.isArray(data.gifs) ? data : null;
    } catch {
        return null;
    }
}

export interface VerifyReport {
    total: number;
    found: number;
    missing: string[];
    duplicates: number;
}

export function verifyFile(file: ExportFile, current: ReturnType<TransferDeps["current"]>): VerifyReport {
    const have = new Set(Object.keys(current));
    const missing: string[] = [];
    let found = 0;
    for (const gif of file.gifs) {
        if (have.has(gif.url)) found++;
        else missing.push(gif.url);
    }
    const seen = new Set<string>();
    let duplicates = 0;
    for (const gif of file.gifs) {
        if (seen.has(gif.url)) duplicates++;
        else seen.add(gif.url);
    }
    return { total: file.gifs.length, found, missing, duplicates };
}

export function makeTransfer(deps: TransferDeps) {
    const more = (list: string[]) => `${list.slice(0, 10).join("\n")}${list.length > 10 ? `\n...and ${list.length - 10} more` : ""}`;

    /** Puts back, for a while, what Discord removes after an import. */
    async function settleWatch(wanted: GifEntry[]): Promise<void> {
        const options = deps.options();
        if (!options.settleWatch) return;
        const duration = Math.max(0, Math.min(options.settleWatchDuration, MAX_SETTLE_MS));
        if (duration === 0) return;
        let delay = options.delayBetweenImports;
        deps.toast(`Watching favorites for ${Math.round(duration / 1000)}s to catch GIFs Discord removes...`);
        let deadline = deps.now() + duration;
        let rounds = 0;
        while (deps.now() < deadline) {
            await deps.sleep(WATCH_INTERVAL_MS);
            const current = deps.current();
            const missing = wanted.filter(gif => current[gif.url] === undefined);
            if (missing.length === 0) continue;
            rounds++;
            if (rounds > MAX_SETTLE_ROUNDS) {
                deps.log(`Settle watch stopped after ${MAX_SETTLE_ROUNDS} re-add rounds with ${missing.length} still missing.`);
                break;
            }
            deps.toast(`Discord removed ${missing.length} GIFs, re-adding...`);
            for (const gif of missing) {
                try {
                    await deps.add(asNewGif(gif));
                } catch (error) {
                    if (isRateLimit(error) && options.autoIncreaseDelay) {
                        delay = Math.min(delay * 2, MAX_DELAY_MS);
                        await deps.sleep(delay * 2);
                        continue;
                    }
                    deps.warn(`Settle watch failed to re-add ${gif.url}`, error);
                }
                await deps.sleep(delay);
            }
            deadline = deps.now() + duration;
        }
        const final = deps.current();
        const still = wanted.filter(gif => final[gif.url] === undefined);
        if (still.length === 0) deps.toast(`All ${wanted.length} GIFs stayed in your favorites.`, "success");
        else {
            deps.log(`Settle watch: still missing:\n${more(still.map(gif => gif.url))}`);
            deps.toast(`${still.length} GIFs disappeared again. Run Import again to retry.`, "failure");
        }
    }

    async function importText(text: string): Promise<void> {
        const data = parseExport(text);
        if (!data) {
            deps.toast("Invalid file format.", "failure");
            return;
        }
        const options = deps.options();
        const seen = new Set<string>();
        let invalid = 0;
        const wanted = data.gifs.filter(gif => {
            if (typeof gif?.url !== "string" || !gif.url) { invalid++; return false; }
            if (seen.has(gif.url)) return false;
            seen.add(gif.url);
            return true;
        });
        const fileDuplicates = data.gifs.length - wanted.length - invalid;
        if (fileDuplicates > 0) deps.log(`Removed ${fileDuplicates} duplicate URLs from import file.`);
        if (invalid > 0) deps.log(`Skipped ${invalid} entries without a URL.`);

        const have = new Set(Object.keys(deps.current()));
        const toImport = options.skipDuplicates ? wanted.filter(gif => !have.has(gif.url)) : wanted;
        const skipped = wanted.length - toImport.length;
        if (toImport.length === 0) {
            deps.toast("All GIFs are already in your favorites. Nothing to import.");
            return;
        }
        deps.toast(`Importing ${toImport.length} GIFs... (${skipped} skipped as duplicates)`);

        let ok = 0;
        let err = 0;
        let delay = options.delayBetweenImports;
        for (const gif of toImport) {
            let retries = 0;
            for (;;) {
                try {
                    await deps.add(asNewGif(gif));
                    ok++;
                    break;
                } catch (error) {
                    if (isRateLimit(error) && options.autoIncreaseDelay && retries < MAX_RATE_LIMIT_RETRIES) {
                        retries++;
                        delay = Math.min(delay * 2, MAX_DELAY_MS);
                        deps.toast(`Rate limited. Increased delay to ${delay}ms. Retrying...`, "failure");
                        await deps.sleep(delay * 2);
                        continue;
                    }
                    err++;
                    deps.warn(`Failed to import GIF ${gif.url}`, error);
                    break;
                }
            }
            await deps.sleep(delay);
            if ((ok + err) % 50 === 0) deps.log(`Progress: ${ok + err}/${toImport.length} | OK: ${ok} | Errors: ${err} | Delay: ${delay}ms`);
        }

        if (!options.ensureCompleteImport) {
            deps.toast(`Import complete! ${ok} GIFs added, ${skipped} duplicates skipped, ${err} errors.`, ok > 0 ? "success" : "failure");
            if (ok > 0) await settleWatch(wanted);
            return;
        }

        const passes = options.maxRetryPasses;
        const passDelay = Math.max(0, options.retryPassDelay);
        for (let pass = 1; pass <= passes; pass++) {
            await deps.sleep(passDelay);
            const current = deps.current();
            const missing = wanted.filter(gif => current[gif.url] === undefined);
            if (missing.length === 0) {
                deps.toast(`All ${wanted.length} GIFs are now in your favorites.`, "success");
                await settleWatch(wanted);
                return;
            }
            deps.toast(`Verifying import, pass ${pass}: re-adding ${missing.length} missing GIFs...`);
            for (const gif of missing) {
                try {
                    await deps.add(asNewGif(gif));
                } catch (error) {
                    if (isRateLimit(error) && options.autoIncreaseDelay) {
                        delay = Math.min(delay * 2, MAX_DELAY_MS);
                        await deps.sleep(delay * 2);
                        continue;
                    }
                    deps.warn(`Failed to re-add GIF ${gif.url}`, error);
                }
                await deps.sleep(delay);
            }
        }

        await deps.sleep(passDelay);
        const final = deps.current();
        const still = wanted.filter(gif => final[gif.url] === undefined);
        if (still.length === 0) {
            deps.toast(`All ${wanted.length} GIFs are now in your favorites.`, "success");
            await settleWatch(wanted);
        } else {
            deps.log(`Still missing:\n${more(still.map(gif => gif.url))}`);
            deps.toast(`Import finished with ${still.length} GIFs still missing. Run Import again to retry.`, "failure");
        }
    }

    function verifyText(text: string): void {
        const file = parseExport(text);
        if (!file) {
            deps.toast("Invalid file format.", "failure");
            return;
        }
        const report = verifyFile(file, deps.current());
        deps.log([
            "=== GIF Verification Report ===",
            `Total in file: ${report.total}`,
            `Found in favorites: ${report.found}`,
            `Missing from favorites: ${report.missing.length}`,
            `Duplicate URLs in file: ${report.duplicates}`,
            report.missing.length > 0 ? `\nMissing GIFs:\n${more(report.missing)}` : "\nAll GIFs are present!"
        ].join("\n"));
        if (report.missing.length === 0) deps.toast(`All ${report.found} GIFs verified! No missing GIFs.`, "success");
        else deps.toast(`Missing ${report.missing.length} GIFs. Press Import again to retry. Check console for details.`, "failure");
    }

    /** Deletes every favourite GIF, after asking, one at a time with the same wait as the import, and checks at the end that none came back. */
    async function clearAll(): Promise<void> {
        const options = deps.options();
        const urls = Object.keys(deps.current());
        if (urls.length === 0) {
            deps.toast("You have no favorite GIFs to delete.");
            return;
        }
        if (!deps.confirm(urls.length)) return;
        deps.toast(`Deleting ${urls.length} favorite GIFs...`);
        let delay = options.delayBetweenImports;
        let failed = 0;
        for (let pass = 0; pass <= Math.max(0, options.maxRetryPasses); pass++) {
            const left = pass === 0 ? urls : Object.keys(deps.current());
            if (left.length === 0) break;
            if (pass > 0) await deps.sleep(options.retryPassDelay);
            for (const url of left) {
                let retries = 0;
                for (;;) {
                    try {
                        await deps.remove(url);
                        break;
                    } catch (error) {
                        if (isRateLimit(error) && options.autoIncreaseDelay && retries < MAX_RATE_LIMIT_RETRIES) {
                            retries++;
                            delay = Math.min(delay * 2, MAX_DELAY_MS);
                            await deps.sleep(delay * 2);
                            continue;
                        }
                        failed++;
                        deps.warn(`Failed to delete GIF ${url}`, error);
                        break;
                    }
                }
                await deps.sleep(delay);
            }
        }
        const still = Object.keys(deps.current()).length;
        if (still === 0) deps.toast(`Deleted all ${urls.length} favorite GIFs.`, "success");
        else deps.toast(`Deleted ${urls.length - still} of ${urls.length} favorite GIFs; ${still} are still there (${failed} failed). Press Delete all again to retry.`, "failure");
    }

    return { importText, verifyText, clearAll };
}
