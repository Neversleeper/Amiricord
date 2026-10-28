/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A trace of how each start went, kept in one small file in the data folder. The console of Discord's main process is seen by nobody, so
// without this a start where the engine did not run (or stopped half way) leaves no clue. One line per event, with the time and the process
// number, never anything about the person: no names of accounts, no messages, no paths of the user's files. The file is cut when it
// grows past 64 KB, so it can never fill a disk. The loader writes to the same file (see `src/installer/asar.ts`).

import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TRACE_FILE = "boot-trace.log";
export const TRACE_MAX_BYTES = 64 * 1024;

/** Add a line to the trace in `dataDir`. Never throws: a trace that cannot be written must not stop Discord. */
export function trace(dataDir: string, text: string, now: () => Date = () => new Date(), pid: number = process.pid): void {
    try {
        const file = join(dataDir, TRACE_FILE);
        try {
            if (statSync(file).size > TRACE_MAX_BYTES) writeFileSync(file, "");
        } catch {
            // No file yet.
        }
        appendFileSync(file, `${now().toISOString()} pid=${pid} ${text.replace(/[\r\n]+/g, " ").slice(0, 300)}\n`);
    } catch {
        // Nothing more can be done.
    }
}
