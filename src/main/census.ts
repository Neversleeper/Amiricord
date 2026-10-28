/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The request census (design 05, piece P4a): a handler for the request hub that only looks. It counts what Discord asks for, by host and by the SHAPE of the
// path, so the firewall rules (P4b) can be written from what build 650200 really sends and not from other projects' notes.
// It never answers a request. P5a (the token census) adds one more fact per row: HOW MANY of its requests carried an `Authorization` header (only that it was there,
// never its value), and in total how many carried it to a host that is not Discord's, which is what the token guard (P5b) is about. It keeps no query, no header, no body, no id: a path part is kept only when it is a plain word or a version (`v9`), anything else
// becomes `*`. Memory only, bounded. Design: docs/analysis-16-firewall.md section 2.

import { isProtectedHost } from "../shared/hostRules";
import type { RequestHandler } from "./requestHub";

export const CENSUS_NAME = "census";
export const CENSUS_MAX_ROWS = 300;
/** How many path parts are kept: `/api/v9/science` is three. */
export const CENSUS_PATH_PARTS = 3;

export interface CensusRow {
    method: string;
    host: string;
    path: string;
    type: string;
    count: number;
    /** How many of those requests carried an `Authorization` header. Only the fact, never the value. */
    withAuth: number;
    first: number;
    last: number;
}

export interface CensusSnapshot {
    rows: CensusRow[];
    /** Requests of shapes that did not fit in the table. */
    other: number;
    total: number;
    /** Requests that carried an `Authorization` header, in all, and the ones sent to a host that is NOT one of Discord's own hosts (the token guard's concern). */
    authTotal: number;
    authOutsideDiscord: number;
}

export interface CensusDeps {
    now(): number;
    maxRows?: number;
}

/** A part of a path is kept only when it is a version (`v9`) or a plain lowercase word; ids, hashes, file names and tokens all become `*`. */
const PART = /^(?:v\d{1,2}|[a-z][a-z-]{0,23})$/;

/** The shape of a path: its first parts, each one a plain word or `*`. Never contains the query. */
export function pathShape(pathname: string): string {
    const parts = pathname.split("/").filter(part => part !== "").slice(0, CENSUS_PATH_PARTS);
    return "/" + parts.map(part => (PART.test(part) ? part : "*")).join("/");
}

const SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
const word = (value: unknown, fallback: string) => (typeof value === "string" && /^[A-Za-z-]{1,24}$/.test(value) ? value : fallback);

export interface Census {
    handler: RequestHandler;
    snapshot(): CensusSnapshot;
}

export function makeCensus(deps: CensusDeps): Census {
    const maxRows = deps.maxRows ?? CENSUS_MAX_ROWS;
    const rows = new Map<string, CensusRow>();
    let other = 0;
    let total = 0;
    let authTotal = 0;
    let authOutsideDiscord = 0;

    /** The row of a request, or its key when it has none (the table was full). Null for what is not web traffic. */
    const parse = (details: { url: string; method?: string; resourceType?: string; }) => {
        let address: URL;
        try {
            address = new URL(details.url);
        } catch {
            return null;
        }
        if (!SCHEMES.has(address.protocol)) return null;
        const method = word(details.method, "?").toUpperCase();
        const type = word(details.resourceType, "?");
        // The address parser already gives the host in lowercase.
        const host = address.hostname;
        const path = pathShape(address.pathname);
        return { method, type, host, path, key: `${method} ${host} ${path} ${type}` };
    };

    return {
        handler: {
            name: CENSUS_NAME,
            beforeRequest(details) {
                const seen = parse(details);
                if (!seen) return;
                total++;
                const now = deps.now();
                const row = rows.get(seen.key);
                if (row) {
                    row.count++;
                    row.last = now;
                } else if (rows.size < maxRows) {
                    rows.set(seen.key, { method: seen.method, host: seen.host, path: seen.path, type: seen.type, count: 1, withAuth: 0, first: now, last: now });
                } else {
                    other++;
                }
            },
            beforeSendHeaders(details) {
                const seen = parse(details);
                if (!seen || !details.requestHeaders) return;
                if (!Object.keys(details.requestHeaders).some(name => name.toLowerCase() === "authorization")) return;
                authTotal++;
                if (!isProtectedHost(seen.host)) authOutsideDiscord++;
                const row = rows.get(seen.key);
                if (row) row.withAuth++;
            }
        },
        snapshot: () => ({
            rows: [...rows.values()].map(row => ({ ...row })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host) || a.path.localeCompare(b.path)),
            other,
            total,
            authTotal,
            authOutsideDiscord
        })
    };
}
