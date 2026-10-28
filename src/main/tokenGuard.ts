/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The token guard (design 05, piece P5b): a handler for the request hub that looks at the headers about to be sent and removes `Authorization` from any request
// whose host is not Discord's and not a host that an enabled plugin with `permissions.token` declared. The request itself goes on without the header.
// A request that is not judged (an error) loses the header when the host is not Discord's and keeps it when it is, so a failure can only make a stranger's request fail.
// Counters and the log are in memory and bounded; they never hold a header value, a query or an id. Limits (said in the tab too): only the header is guarded, and
// main cannot tell which plugin made a request. Design: docs/analysis-19-token-guard.md.

import { isProtectedHost } from "../shared/hostRules";
import { pathShape } from "./census";
import type { RequestDetails, RequestHandler } from "./requestHub";
import { hostAllowed } from "./tokenHosts";

export const TOKEN_GUARD_NAME = "token-guard";
export const TOKEN_LOG_ENTRIES = 500;

export interface TokenGuardDeps {
    now(): number;
    /** The host patterns that may get the token besides Discord's own. Asked on each request that carries the header. */
    tokenHosts(): readonly string[];
    maxLog?: number;
}

export interface TokenGuardStatus {
    /** Requests that carried an `Authorization` header (web addresses only). */
    inspected: number;
    /** Of those, the ones that kept it (Discord's hosts and declared hosts). */
    kept: number;
    /** Of those, the ones that had it removed. */
    stripped: number;
}

export interface TokenLogEntry {
    at: number;
    method: string;
    host: string;
    path: string;
}

export interface TokenGuard {
    handler: RequestHandler;
    status(): TokenGuardStatus;
    /** The most recent requests that had the token removed, newest last. Copies. */
    log(): TokenLogEntry[];
    /** What the guard would answer for these details, without counting anything (for a start-up check). */
    judge(details: RequestDetails): { requestHeaders: Record<string, string>; } | undefined;
}

const WEB = new Set(["http:", "https:"]);
const word = (value: unknown) => (typeof value === "string" && /^[A-Za-z]{1,12}$/.test(value) ? value.toUpperCase() : "?");
const isAuthorization = (name: string) => name.toLowerCase() === "authorization";

export function makeTokenGuard(deps: TokenGuardDeps): TokenGuard {
    const maxLog = Math.max(1, deps.maxLog ?? TOKEN_LOG_ENTRIES);
    const counts: TokenGuardStatus = { inspected: 0, kept: 0, stripped: 0 };
    const log: TokenLogEntry[] = [];

    /** `null`: nothing to judge. `keep`: the header stays. `strip`: the header goes. */
    const decide = (details: RequestDetails): { verdict: "none" | "keep" | "strip"; address?: URL; } => {
        let address: URL;
        try {
            address = new URL(details.url);
        } catch {
            return { verdict: "none" };
        }
        if (!WEB.has(address.protocol) || !details.requestHeaders) return { verdict: "none" };
        if (!Object.keys(details.requestHeaders).some(isAuthorization)) return { verdict: "none" };
        const host = address.hostname;
        let keep: boolean;
        try {
            keep = isProtectedHost(host) || hostAllowed(host, deps.tokenHosts());
        } catch {
            // Not judged: a stranger does not get the token. (A Discord host never gets here: it was kept before the declared hosts were asked for.)
            keep = false;
        }
        return { verdict: keep ? "keep" : "strip", address };
    };

    const without = (headers: Record<string, string>): Record<string, string> => {
        const copy: Record<string, string> = {};
        for (const [name, value] of Object.entries(headers)) if (!isAuthorization(name)) copy[name] = value;
        return copy;
    };

    return {
        handler: {
            name: TOKEN_GUARD_NAME,
            beforeSendHeaders(details) {
                const { verdict, address } = decide(details);
                if (verdict === "none") return;
                counts.inspected++;
                if (verdict === "keep") {
                    counts.kept++;
                    return;
                }
                counts.stripped++;
                log.push({ at: deps.now(), method: word(details.method), host: address!.hostname.slice(0, 100), path: pathShape(address!.pathname) });
                if (log.length > maxLog) log.splice(0, log.length - maxLog);
                return { requestHeaders: without(details.requestHeaders!) };
            }
        },
        status: () => ({ ...counts }),
        log: () => log.map(entry => ({ ...entry })),
        judge(details) {
            const { verdict } = decide(details);
            return verdict === "strip" ? { requestHeaders: without(details.requestHeaders!) } : undefined;
        }
    };
}
