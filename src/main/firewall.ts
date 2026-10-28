/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The telemetry shields of the network firewall (design 05, piece P4b): a handler for the request hub that cancels the few requests whose address is KNOWN
// to carry usage reports, metrics, crash reports or Discord's telemetry pings. NoTrack (page) stops most of these before they exist; this is the net below it.
// Rules are data: an id, a reason, what was seen, and an exact test of the parsed address (host and whole path), never of text found anywhere in it.
// Anything that fails lets the request through. Counters and the log are in memory, bounded, and never hold a query, a header, a body or an id.
// Design: docs/analysis-16-firewall.md sections 3 to 6.

import { emptyNetworkCounts, NetworkCounts, NetworkKind, ShieldId } from "../shared/shields";
import { pathShape } from "./census";
import type { RequestHandler } from "./requestHub";

export const FIREWALL_NAME = "firewall";
export const LOG_DEFAULT_ENTRIES = 500;

/** Which of NoTrack's switches turns a shield off. The firewall reads the same ones, so one switch covers both layers. */
export type ShieldSwitch = "disableAnalytics" | "disableCrashReports";

/** What we know about the address of a rule: seen in a real census of the client, only partly seen, or taken from other projects' notes. */
export type Evidence = "seen" | "partly" | "not-seen";

export interface Rule {
    id: ShieldId;
    /** In plain words, for the log and for the tab to come. */
    reason: string;
    evidence: Evidence;
    switch: ShieldSwitch;
    /** The registrable host the rule is about, shown in the log instead of the full host (some hosts carry a random label). */
    host: string;
    matches(address: URL): boolean;
}

/** `host` is `base` or a subdomain of it, on the parsed host name (so `sentry.io.evil.test` and `notsentry.io` do not match). */
export const hostIs = (host: string, base: string): boolean => host === base || host.endsWith("." + base);

export const RULES: readonly Rule[] = [
    {
        id: "usage-reports", host: "discord.com", switch: "disableAnalytics", evidence: "partly",
        reason: "Discord's usage reports (science, track). `science` was seen in a real census; `track` was not.",
        matches: address => hostIs(address.hostname, "discord.com") && /^\/api\/v\d{1,2}\/(?:science|track)\/?$/.test(address.pathname)
    },
    {
        id: "metrics", host: "discord.com", switch: "disableAnalytics", evidence: "partly",
        reason: "Discord's metrics. `/metrics` was seen in a real census; `/metrics/v2` was not.",
        matches: address => hostIs(address.hostname, "discord.com") && /^\/api\/v\d{1,2}\/metrics(?:\/v2)?\/?$/.test(address.pathname)
    },
    {
        id: "crash-reports", host: "sentry.io", switch: "disableCrashReports", evidence: "not-seen",
        reason: "Crash reports to Sentry. Not seen in a census (no crash happened); the address comes from other projects' notes.",
        matches: address => hostIs(address.hostname, "sentry.io")
    },
    {
        id: "telemetry-host", host: "dc-telemetry.net", switch: "disableAnalytics", evidence: "seen",
        reason: "Discord's telemetry ping: a request to a name under dc-telemetry.net that carries the language, the check and its result in the host name itself.",
        matches: address => hostIs(address.hostname, "dc-telemetry.net")
    }
];

export interface LogEntry {
    at: number;
    shield: NetworkKind;
    method: string;
    host: string;
    path: string;
}

export interface FirewallStatus {
    cancelled: NetworkCounts;
    total: number;
}

export interface FirewallDeps {
    now(): number;
    /** Whether a switch is on. Called on every request that matches a rule; any failure counts as "do not cancel". */
    enabled(name: ShieldSwitch): boolean;
    maxLog?: number;
    rules?: readonly Rule[];
    /** The owner's host rules: the rule that covers a host name, or null. Always on; any failure lets the request through. */
    blockedBy?(hostname: string): { host: string; } | null;
}

const WEB = new Set(["http:", "https:"]);
const word = (value: unknown) => (typeof value === "string" && /^[A-Za-z]{1,12}$/.test(value) ? value.toUpperCase() : "?");

export interface Firewall {
    handler: RequestHandler;
    status(): FirewallStatus;
    /** The most recent cancelled requests, newest last. Copies. */
    log(): LogEntry[];
    /** A request that did not pass the hub (the main-process code of a plugin) was stopped by the owner's rule `ruleHost`: count it and list it like any other. */
    noteOwnBlock(ruleHost: string, method: unknown, pathname: string): void;
}

export function makeFirewall(deps: FirewallDeps): Firewall {
    const rules = deps.rules ?? RULES;
    const maxLog = Math.max(1, deps.maxLog ?? LOG_DEFAULT_ENTRIES);
    const cancelled = emptyNetworkCounts();
    const log: LogEntry[] = [];
    const record = (shield: NetworkKind, method: unknown, host: string, pathname: string) => {
        log.push({ at: deps.now(), shield, method: word(method), host, path: pathShape(pathname) });
        if (log.length > maxLog) log.splice(0, log.length - maxLog);
    };

    return {
        handler: {
            name: FIREWALL_NAME,
            beforeRequest(details) {
                let address: URL;
                try {
                    address = new URL(details.url);
                } catch {
                    return;
                }
                if (!WEB.has(address.protocol)) return;
                // The owner's own rules come first: they are on whatever NoTrack's switches say.
                let owned: { host: string; } | null = null;
                try {
                    owned = deps.blockedBy?.(address.hostname) ?? null;
                } catch {
                    owned = null;
                }
                if (owned) {
                    cancelled["host-rules"]++;
                    record("host-rules", details.method, owned.host, address.pathname);
                    return { cancel: true };
                }
                for (const rule of rules) {
                    let hit = false;
                    try {
                        hit = rule.matches(address);
                    } catch {
                        hit = false;
                    }
                    if (!hit) continue;
                    let on = false;
                    try {
                        on = deps.enabled(rule.switch) === true;
                    } catch {
                        on = false;
                    }
                    if (!on) return;
                    cancelled[rule.id]++;
                    record(rule.id, details.method, rule.host, address.pathname);
                    return { cancel: true };
                }
            }
        },
        status: () => ({ cancelled: { ...cancelled }, total: Object.values(cancelled).reduce((sum, count) => sum + count, 0) }),
        log: () => log.map(entry => ({ ...entry })),
        noteOwnBlock(ruleHost, method, pathname) {
            cancelled["host-rules"]++;
            record("host-rules", method, ruleHost, pathname);
        }
    };
}
