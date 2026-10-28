/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Says what state a Discord `resources` folder is in, by looking at `app.asar` and `_app.asar`. Nothing is changed.
// Every command starts from this: an action is only allowed from the states that make sense for it.

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

import { LOADER_MARKER, parseAsar } from "./asar";

export type State =
    /** Discord's own `app.asar`, nothing of ours. */
    | "pristine"
    /** Our loader is `app.asar` and the original is `_app.asar`. */
    | "patched"
    /** `app.asar` is another mod's loader (Vencord, TestCord...). We do not touch it. */
    | "foreign-loader"
    /** `app.asar` looks like Discord's own but `_app.asar` exists too (an update or a half-done restore). */
    | "desynced"
    /** Something is missing that should be there. */
    | "broken"
    /** A folder, a link or a file type we never create. */
    | "unsupported";

/** Temporary files that an interrupted operation of ours would leave in `resources`. */
export const LEFTOVER_NAMES = ["app.asar.amiricord-new", "app.asar.amiricord-old", "_app.asar.amiricord-restore"] as const;

/** A loader is tiny; Discord's real `app.asar` weighs megabytes. */
const MAX_LOADER_BYTES = 64 * 1024;

export interface PathInfo {
    kind: "missing" | "file" | "directory" | "symlink" | "other";
    size: number;
}

/** `lstat` without following links. */
export async function inspectPath(path: string): Promise<PathInfo> {
    try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink()) return { kind: "symlink", size: stat.size };
        if (stat.isFile()) return { kind: "file", size: stat.size };
        if (stat.isDirectory()) return { kind: "directory", size: 0 };
        return { kind: "other", size: stat.size };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing", size: 0 };
        throw error;
    }
}

export interface LoaderInfo {
    /** Looks like a mod loader: `package.json` says `main: index.js` and `index.js` requires something. */
    isLoader: boolean;
    /** Carries our marker. */
    ours: boolean;
    /** The path the loader requires, when it can be read. */
    modPath: string | null;
}

const NOT_A_LOADER: LoaderInfo = { isLoader: false, ours: false, modPath: null };

/** Read a small file as an asar and decide whether it is a loader. Never throws. */
async function readLoader(path: string, info: PathInfo): Promise<LoaderInfo> {
    if (info.kind !== "file" || info.size > MAX_LOADER_BYTES) return NOT_A_LOADER;
    try {
        const asar = parseAsar(await readFile(path));
        if (!asar || !asar.names.includes("index.js") || !asar.names.includes("package.json")) return NOT_A_LOADER;

        const index = asar.read("index.js").toString("utf8");
        let main: unknown;
        try {
            main = (JSON.parse(asar.read("package.json").toString("utf8")) as { main?: unknown; }).main;
        } catch {
            return NOT_A_LOADER;
        }

        const required = /require\(\s*("(?:[^"\\]|\\.)*")\s*\)/.exec(index);
        let modPath: string | null = null;
        if (required) {
            try {
                modPath = JSON.parse(required[1]) as string;
            } catch {
                modPath = null;
            }
        }
        // "ours" means the very first line is our marker; a marker somewhere in the middle proves nothing.
        return { isLoader: main === "index.js" && required !== null, ours: index.startsWith(LOADER_MARKER), modPath };
    } catch {
        return NOT_A_LOADER;
    }
}

export interface Classification {
    state: State;
    /** Plain text for the owner and the report. */
    reason: string;
    app: PathInfo;
    original: PathInfo;
    loader: LoaderInfo | null;
    /** Names of temporary files of ours found in `resources`. */
    leftovers: string[];
}

export async function classifyResources(resources: string): Promise<Classification> {
    const [app, original] = await Promise.all([inspectPath(join(resources, "app.asar")), inspectPath(join(resources, "_app.asar"))]);

    const leftovers: string[] = [];
    for (const name of LEFTOVER_NAMES) {
        if ((await inspectPath(join(resources, name))).kind !== "missing") leftovers.push(name);
    }

    const result = (state: State, reason: string, loader: LoaderInfo | null = null): Classification =>
        ({ state, reason, app, original, loader, leftovers });

    const odd = (info: PathInfo) => info.kind === "symlink" || info.kind === "other" || info.kind === "directory";
    if (odd(app) || odd(original)) {
        return result("unsupported", "app.asar or _app.asar is a folder, a link or another kind of file that this installer never creates");
    }
    if (app.kind === "missing") {
        return result("broken", original.kind === "file" ? "app.asar is missing but _app.asar exists (use restore)" : "app.asar is missing");
    }

    const loader = await readLoader(join(resources, "app.asar"), app);
    const hasOriginal = original.kind === "file";

    if (loader.isLoader && loader.ours) {
        return hasOriginal
            ? result("patched", "our loader is app.asar and Discord's original is _app.asar", loader)
            : result("broken", "our loader is in place but _app.asar (Discord's original) is missing", loader);
    }
    if (loader.isLoader) return result("foreign-loader", "app.asar is the loader of another mod", loader);
    return hasOriginal
        ? result("desynced", "app.asar is not a loader but _app.asar exists (Discord was updated while patched, or a restore was cut short)")
        : result("pristine", "app.asar is Discord's own and nothing is patched");
}
