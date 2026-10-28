/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Small file helpers for the main process. Writes go through a temporary file and a rename,
// so a crash leaves the old content or the new content, never a mix.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ReadResult =
    | { kind: "text"; text: string; }
    | { kind: "missing"; }
    | { kind: "error"; message: string; };

/** Read a text file. A missing file is a normal result (first start), not an error. Never throws. */
export function readTextFile(path: string): ReadResult {
    try {
        // A byte order mark would break JSON.parse with a confusing message.
        return { kind: "text", text: readFileSync(path, "utf8").replace(/^﻿/, "") };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
        return { kind: "error", message: (err as Error).message };
    }
}

/** Write a text file safely. Returns the error message instead of throwing, or null when it worked. */
export function writeTextAtomic(path: string, text: string): string | null {
    const temporary = `${path}.${process.pid}.tmp`;
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(temporary, text);
        renameSync(temporary, path);
        return null;
    } catch (err) {
        try { rmSync(temporary, { force: true }); } catch { /* nothing more to do */ }
        return (err as Error).message;
    }
}
