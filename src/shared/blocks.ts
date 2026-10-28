/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Privacy & Security tab may learn about recent blocks (design 05 piece P7c, docs/analysis-24-recent-blocks.md): groups of the same kind of block to the same host and path
// shape, each with a count and an age. The page only reads. The answer is rebuilt field by field; anything that is not in the expected form gives null. Nothing here can hold a
// query, a header, a body, an id or a token: the main process never keeps them, and the page refuses text that is not a plain host name or a plain path shape.

import { NETWORK_KINDS, NetworkKind } from "./shields";

/** The most groups one answer carries. */
export const BLOCK_MAX_GROUPS = 200;

export interface BlockGroup {
    kind: NetworkKind;
    method: string;
    host: string;
    /** The shape of the path: plain words and `*`, never a query. */
    path: string;
    count: number;
    /** How long ago the last one happened, in milliseconds, worked out by the main process when it answered. */
    agoMs: number;
}

export interface BlockLog {
    /** Grows with every block, so the page asks for the list only when this changed. */
    version: number;
    groups: BlockGroup[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function parseGroup(value: unknown): BlockGroup | null {
    if (!isRecord(value)) return null;
    const kind = (NETWORK_KINDS as readonly unknown[]).includes(value.kind) ? value.kind as NetworkKind : null;
    if (kind === null || typeof value.method !== "string" || !/^[A-Z?]{1,12}$/.test(value.method)) return null;
    if (typeof value.host !== "string" || !/^[a-z0-9.-]{1,253}$/.test(value.host)) return null;
    if (typeof value.path !== "string" || !/^(?:\/|(?:\/(?:\*|[a-z0-9-]{1,24})){1,8})$/.test(value.path)) return null;
    if (!isCount(value.count) || value.count < 1 || !isCount(value.agoMs)) return null;
    return { kind, method: value.method, host: value.host, path: value.path, count: value.count, agoMs: value.agoMs };
}

/** Rebuild the answer of the main process about recent blocks. Null when it is not in the expected form. */
export function parseBlockLog(value: unknown): BlockLog | null {
    if (!isRecord(value) || !isCount(value.version) || !Array.isArray(value.groups) || value.groups.length > BLOCK_MAX_GROUPS) return null;
    const groups = value.groups.map(parseGroup);
    if (groups.includes(null)) return null;
    return { version: value.version, groups: groups as BlockGroup[] };
}
