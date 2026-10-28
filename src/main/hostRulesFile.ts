/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The owner's host rules on disk (design 05, piece P4c): `firewall.json` in the data folder, apart from `settings.json` so neither can damage the other.
// Read once at the start (a change made by hand while Discord runs is noticed at the next start, and the tab, which holds the list in memory, would write over it); written through a temporary file and a rename.
// The checks of what is read are in `src/shared/hostRules.ts`. Nothing here throws.

import { constants, copyFileSync } from "node:fs";
import { join } from "node:path";

import { HostRule, ParsedRules, parseRuleFile, serializeRules } from "../shared/hostRules";
import { readTextFile, writeTextAtomic } from "./atomicFile";

export const HOST_RULES_FILE = "firewall.json";

export const hostRulesPath = (dataDir: string): string => join(dataDir, HOST_RULES_FILE);

/** The rules in the file. A missing file is normal (no rules); a file that cannot be read gives no rules and says so. */
export function loadHostRules(path: string): ParsedRules {
    const read = readTextFile(path);
    if (read.kind === "missing") return { rules: [], problems: [] };
    if (read.kind === "error") return { rules: [], problems: [`firewall.json could not be read (${read.message}), so no host rule is in force`], broken: true };
    return parseRuleFile(read.text);
}

/** The name of the copy made before the tab first rewrites the file. */
export const BACKUP_SUFFIX = ".before-tab";

/**
 * Keep a copy of the owner's file before the tab rewrites it: `firewall.json.before-tab`, made once and never replacing an older copy. A missing file needs no copy.
 * Returns the error text, or null when there is a copy now or nothing to copy.
 */
export function backupHostRules(path: string): string | null {
    try {
        copyFileSync(path, path + BACKUP_SUFFIX, constants.COPYFILE_EXCL);
        return null;
    } catch (err) {
        const code = (err as { code?: unknown; }).code;
        return code === "ENOENT" || code === "EEXIST" ? null : (err as Error).message;
    }
}

/** Write the rules. Returns the error text, or null when it worked. */
export function saveHostRules(path: string, rules: readonly HostRule[]): string | null {
    return writeTextAtomic(path, serializeRules(rules));
}
