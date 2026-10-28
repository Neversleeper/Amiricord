/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the network firewall (main process, `src/main/firewall.ts`) and the page both need to agree on: the names of the shields and the shape of the counters the
// page may read. The page only reads; the counters are changed by the code that cancels a request, never by a message. Design: docs/analysis-16-firewall.md.

export const SHIELD_IDS = ["usage-reports", "metrics", "crash-reports", "telemetry-host"] as const;
export type ShieldId = typeof SHIELD_IDS[number];

/** What the firewall counts: the four shields, what the owner's own host rules cancelled, and the requests that had the token removed (not cancelled: they go on without it). */
export const NETWORK_KINDS = [...SHIELD_IDS, "host-rules", "token-stripped"] as const;
export type NetworkKind = typeof NETWORK_KINDS[number];

/** What the network firewall cancelled this session, per kind. Never added to what NoTrack stopped inside Discord. */
export type NetworkCounts = Record<NetworkKind, number>;

export const emptyNetworkCounts = (): NetworkCounts => ({ "usage-reports": 0, metrics: 0, "crash-reports": 0, "telemetry-host": 0, "host-rules": 0, "token-stripped": 0 });

/** Rebuild the counters from what the main process answered, field by field. Anything that is not a plain count gives null. */
export function parseNetworkCounts(value: unknown): NetworkCounts | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const source = (value as { cancelled?: unknown; }).cancelled;
    if (typeof source !== "object" || source === null || Array.isArray(source)) return null;
    const counts = emptyNetworkCounts();
    for (const id of NETWORK_KINDS) {
        const count = Object.prototype.hasOwnProperty.call(source, id) ? (source as Record<string, unknown>)[id] : undefined;
        if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
        counts[id] = count;
    }
    return counts;
}

/** The most characters of the encrypted DNS line that the page keeps. */
export const DNS_TEXT_MAX = 300;

/** The line the main process wrote about encrypted DNS, kept only if it is plain printable text; anything else gives an empty line. */
export function parseDnsText(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/[^\x20-\x7e]/g, "").slice(0, DNS_TEXT_MAX);
}

export interface FirewallAnswer {
    counts: NetworkCounts;
    /** One plain line about encrypted DNS ("" when the main process did not say). */
    dns: string;
}

/** Rebuild the whole answer of the main process about the firewall: the counters and the encrypted DNS line. Null when the counters are not plain counts. */
export function parseFirewallAnswer(value: unknown): FirewallAnswer | null {
    const counts = parseNetworkCounts(value);
    if (counts === null) return null;
    return { counts, dns: parseDnsText((value as { dns?: unknown; }).dns) };
}
