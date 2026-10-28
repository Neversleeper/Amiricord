/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The list of recent blocks for the Privacy & Security tab (design 05 piece P7c, docs/analysis-24-recent-blocks.md): the log of the firewall and the log of the token guard, put
// into groups (the same kind of block to the same host and path shape, with a count and the time of the last one), newest first, and the two files the person may ask for (JSON and
// CSV). Pure code. The entries never held a query, a header, a body, an id or a token, so neither do the groups or the files. The age is worked out here so that the clock of the page
// never matters.

import { BLOCK_MAX_GROUPS, BlockGroup, BlockLog } from "../shared/blocks";
import type { NetworkKind } from "../shared/shields";

export interface RawBlock {
    at: number;
    kind: NetworkKind;
    method: string;
    host: string;
    path: string;
}

/** Group the entries, newest group first, at most `max` groups. `now` is the time of the answer, for the ages. */
export function groupBlocks(entries: readonly RawBlock[], now: number, max = BLOCK_MAX_GROUPS): BlockGroup[] {
    const groups = new Map<string, { block: RawBlock; count: number; last: number; }>();
    for (const entry of entries) {
        const key = `${entry.kind}\n${entry.method}\n${entry.host}\n${entry.path}`;
        const found = groups.get(key);
        if (found) {
            found.count++;
            if (entry.at > found.last) found.last = entry.at;
        } else {
            groups.set(key, { block: entry, count: 1, last: entry.at });
        }
    }
    return [...groups.values()]
        .sort((a, b) => b.last - a.last)
        .slice(0, max)
        .map(({ block, count, last }) => ({ kind: block.kind, method: block.method, host: block.host, path: block.path, count, agoMs: Math.max(0, Math.round(now - last)) }));
}

export interface BlockSources {
    firewall: ReadonlyArray<{ at: number; shield: NetworkKind; method: string; host: string; path: string; }>;
    token: ReadonlyArray<{ at: number; method: string; host: string; path: string; }>;
}

/** The two logs together. `version` is the number of blocks counted so far (it only grows), so the page can tell when the list changed. */
export function buildBlockLog(sources: BlockSources, version: number, now: number): BlockLog {
    const entries: RawBlock[] = [
        ...sources.firewall.map(entry => ({ at: entry.at, kind: entry.shield, method: entry.method, host: entry.host, path: entry.path })),
        ...sources.token.map(entry => ({ at: entry.at, kind: "token-stripped" as const, method: entry.method, host: entry.host, path: entry.path }))
    ];
    return { version: Math.max(0, Math.floor(version)), groups: groupBlocks(entries, now) };
}

export type ExportFormat = "json" | "csv";

/** What the file says about itself, so nobody wonders what is in it. */
export const EXPORT_NOTE = "Host, path shape, kind, count and time of the last one. No query values, no headers, no bodies, no ids, no tokens. Only what this session saw.";

const pad = (value: number) => String(value).padStart(2, "0");

/** `20261026-031400` in UTC. */
export function stamp(at: number): string {
    const date = new Date(at);
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export const exportName = (format: ExportFormat, at: number): string => `recent-blocks-${stamp(at)}.${format}`;

/** One cell of a CSV file: quoted, and made harmless for a spreadsheet that would read a leading `=`, `+`, `-` or `@` as a formula. */
function cell(text: string): string {
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, "\"\"")}"`;
}

export function exportText(format: ExportFormat, groups: readonly BlockGroup[], at: number): string {
    const lastAt = (group: BlockGroup) => new Date(Math.max(0, at - group.agoMs)).toISOString();
    if (format === "json") {
        return JSON.stringify({
            about: EXPORT_NOTE,
            exportedAt: new Date(at).toISOString(),
            blocks: groups.map(group => ({ kind: group.kind, method: group.method, host: group.host, path: group.path, count: group.count, last: lastAt(group) }))
        }, null, 2) + "\n";
    }
    const lines = [["kind", "method", "host", "path", "count", "last"].map(cell).join(",")];
    for (const group of groups) lines.push([group.kind, group.method, group.host, group.path, String(group.count), lastAt(group)].map(cell).join(","));
    return lines.join("\r\n") + "\r\n";
}
