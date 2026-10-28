/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reads and writes the boot state file in the data folder. Main process only (uses Node).
// The read is synchronous on purpose: the decision about safe mode and quarantine must exist
// before the first patch is registered.

import { join } from "node:path";

import { BootState, defaultBootState, parseBootState, ParseResult, serializeBootState } from "../shared/bootState";
import { readTextFile, writeTextAtomic } from "./atomicFile";

export const BOOT_STATE_FILE_NAME = "state.json";

export function bootStatePath(dataDir: string): string {
    return join(dataDir, BOOT_STATE_FILE_NAME);
}

/**
 * A missing file is the normal first start. A file that cannot be read gives the defaults
 * and a problem that the health report shows. This function never throws.
 */
export function readBootStateFile(path: string): ParseResult {
    const read = readTextFile(path);
    if (read.kind === "missing") return { state: defaultBootState(), problems: [] };
    if (read.kind === "error") return { state: defaultBootState(), problems: [`boot state could not be read (${read.message}), using defaults`] };
    return parseBootState(read.text);
}

/** Returns an error text instead of throwing, or null when the file was written. */
export function writeBootStateFile(path: string, state: BootState): string | null {
    const error = writeTextAtomic(path, serializeBootState(state));
    return error === null ? null : `boot state could not be written (${error})`;
}
