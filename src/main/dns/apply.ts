/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Putting the owner's encrypted DNS choice into force (design 05, piece P6b): verify the provider with a real question, and only if it answers, tell Electron's resolver to use it.
// Electron and the network come in from outside (`verify`, `configure`), so this is tested without either. A provider that does not answer is NOT applied, in either mode:
// in Automatic the system's DNS stays in use, in Strict encrypted DNS stays off for this session (it never locks Discord out at the start). What it reports is only what is true:
// "configured" means the provider answered a real question and the resolver was told to use it; nobody can see from here that Chromium then uses it.
// Design: docs/analysis-21-encrypted-dns.md sections 6 and 7.

import type { DnsChoice, DnsMode } from "./config";
import type { VerifyResult } from "./verify";

/** What Electron's `app.configureHostResolver` is given. `secure` is the mode that never falls back to plain DNS. */
export interface ResolverOptions {
    enableBuiltInResolver: boolean;
    secureDnsMode: "off" | "automatic" | "secure";
    secureDnsServers: string[];
}

/** How long to wait before asking the provider a second time when the first check fails (a cold start can be slow: seen on 2026-10-26). */
export const RETRY_DELAY_MS = 10_000;

export interface ApplyDeps {
    verify(address: string): Promise<VerifyResult>;
    /** Resolves after `ms` milliseconds. Without it the provider is asked only once. */
    wait?(ms: number): Promise<void>;
    /** Electron's `app.configureHostResolver`. May throw. */
    configure(options: ResolverOptions): void;
}

export type DnsState = "off" | "configured" | "not-applied";

export interface DnsStatus {
    state: DnsState;
    /** What the owner asked for. */
    asked: DnsMode;
    /** What is in force now: `off` unless `configured`. */
    inForce: DnsMode;
    provider: string;
    /** How long the check took, in milliseconds, when it ran. */
    ms: number | null;
    /** Why a wanted mode is not in force; empty otherwise. */
    reason: string;
}

export const dnsOff = (reason = ""): DnsStatus => ({ state: "off", asked: "off", inForce: "off", provider: "", ms: null, reason });

/** Verify and apply `choice`. Never throws; the answer says what happened. */
export async function applyDns(choice: DnsChoice, deps: ApplyDeps): Promise<DnsStatus> {
    if (choice.mode === "off" || choice.address === null) return dnsOff();
    const base = { asked: choice.mode, provider: choice.name };
    const ask = async (): Promise<VerifyResult> => {
        try {
            return await deps.verify(choice.address!);
        } catch {
            return { ok: false, reason: "the check of the provider failed", ms: 0 };
        }
    };
    let checked = await ask();
    // One more try after a pause: the first lookup after a start is sometimes slow, and a good provider should not be left out for that.
    if (!checked.ok && deps.wait) {
        try {
            await deps.wait(RETRY_DELAY_MS);
        } catch {
            // Not being able to wait only means no second try.
        }
        checked = await ask();
    }
    if (!checked.ok) {
        return { state: "not-applied", ...base, inForce: "off", ms: null, reason: `${checked.reason}${choice.mode === "automatic" ? "; the system's DNS stays in use" : "; encrypted DNS stays off so that Discord can still connect"}` };
    }
    try {
        deps.configure({ enableBuiltInResolver: true, secureDnsMode: choice.mode === "strict" ? "secure" : "automatic", secureDnsServers: [choice.address] });
    } catch {
        return { state: "not-applied", ...base, inForce: "off", ms: checked.ms, reason: "the provider answered, but the resolver would not take the setting" };
    }
    return { state: "configured", ...base, inForce: choice.mode, ms: checked.ms, reason: "" };
}

const MODE_WORDS: Record<DnsMode, string> = { off: "off", automatic: "automatic", strict: "strict" };

/** The one line the main tab shows. Plain words, no markup. */
export function dnsText(status: DnsStatus, problems: readonly string[] = []): string {
    if (status.state === "configured") return `Configured: ${status.provider}, ${MODE_WORDS[status.inForce]}, answered in ${status.ms ?? 0} ms`;
    if (status.state === "not-applied") return `Not applied (${status.provider}, ${MODE_WORDS[status.asked]}): ${status.reason}`;
    return problems.length > 0 ? `Off: ${problems[0]}` : "Off";
}
