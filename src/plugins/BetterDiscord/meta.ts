/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reads the header comment of a BetterDiscord plugin file (`/** @name ... */`). Written for Amiricord from BetterDiscord's documented format; the fields it
// knows are the ones BetterDiscord documents. Never runs the file.

export interface BdMeta {
    name: string;
    version: string;
    description: string;
    /** Authors as written, one string for all of them (BetterDiscord allows `@author A, B`). */
    author: string;
    authorId?: string;
    authorLink?: string;
    source?: string;
    website?: string;
    invite?: string;
    updateUrl?: string;
    donate?: string;
    patreon?: string;
}

const STRING_FIELDS = ["version", "description", "author", "authorId", "authorLink", "source", "website", "invite", "updateUrl", "donate", "patreon"] as const;

/** The first doc comment of the file that has at least one `@field` line. */
function headerBlock(text: string): string | undefined {
    for (const match of text.matchAll(/\/\*\*([\s\S]*?)\*\//g)) {
        if (/^\s*\*?\s*@\w+/m.test(match[1])) return match[1];
    }
    return undefined;
}

/** `@field value` lines of a block, a field may continue on the lines that do not start with `@`. The first value of a repeated field wins. */
function fieldsOf(block: string): Map<string, string> {
    const fields = new Map<string, string>();
    let name: string | undefined;
    let value = "";
    const flush = () => {
        if (name !== undefined && !fields.has(name)) fields.set(name, value.trim());
    };
    for (const raw of block.split(/\r?\n/)) {
        const line = raw.replace(/^\s*\*? ?/, "");
        const start = /^@(\w+)(?:\s+(.*))?$/.exec(line);
        if (start) {
            flush();
            name = start[1];
            value = start[2] ?? "";
        } else if (name !== undefined && line.trim()) {
            value += ` ${line.trim()}`;
        }
    }
    flush();
    return fields;
}

/** An id safe to use in a CSS id, a storage key and a plugin list: letters, digits and underscores. */
export function idOf(name: string): string {
    return name.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
}

/** The meta of a plugin file. A file without a usable header still gets a name (from the file name) so it can be listed. */
export function parseBdMeta(text: string, fileName: string): BdMeta {
    const meta: BdMeta = { name: fileName.replace(/\.plugin\.js$/i, ""), version: "unknown", description: "", author: "unknown" };
    const block = headerBlock(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
    if (block) {
        const fields = fieldsOf(block);
        const name = fields.get("name");
        if (name) meta.name = name;
        for (const key of STRING_FIELDS) {
            const value = fields.get(key);
            if (value) meta[key] = value;
        }
        return meta;
    }
    // The old format: //META{"name":"Plugin"}*//
    const legacy = /\/\/META(\{[\s\S]*?\})\*\//.exec(text);
    if (legacy) {
        try {
            const parsed = JSON.parse(legacy[1]) as Record<string, unknown>;
            if (typeof parsed.name === "string" && parsed.name) meta.name = parsed.name;
            for (const key of ["version", "description", "author"] as const) if (typeof parsed[key] === "string" && parsed[key]) meta[key] = parsed[key] as string;
        } catch {
            // A header that cannot be read leaves the defaults.
        }
    }
    return meta;
}
