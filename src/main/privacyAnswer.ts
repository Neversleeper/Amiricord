/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the main process tells the Privacy & Security tab (design 05 piece P7a, docs/analysis-22-privacy-security-tab-build.md): one read-only snapshot, and the answer to
// "Test now" for one provider of our own table. Pure code; the Electron glue only connects it to the channels. The page names a provider by its id and never by an address,
// the test only asks and applies nothing, and it is limited to one at a time and one every few seconds so a page cannot use it to flood a provider.

import type { HostRule } from "../shared/hostRules";
import { PRIVACY_MAX_RULES, PrivacyDnsMode, ProviderTestAnswer } from "../shared/privacy";
import type { NetworkCounts } from "../shared/shields";
import { DNS_PROVIDERS, findProvider } from "./dns/providers";
import type { VerifyResult } from "./dns/verify";

export const TEST_GAP_MS = 3000;

export interface PrivacyInput {
    counts: NetworkCounts;
    dnsLine: string;
    dnsMode: PrivacyDnsMode;
    /** A provider id, `custom`, or empty. */
    dnsProvider: string;
    /** What dns.json holds now (it takes effect at the next start). */
    dnsSaved: { mode: PrivacyDnsMode; provider: string; };
    /** NoTrack's two switches as the main process holds them. */
    telemetry: { usage: boolean; crash: boolean; };
    /** How many blocks were counted so far (it only grows): the page asks for the list again when it changes. */
    logVersion: number;
    /** The time left of a pause in milliseconds, or null when protection is not paused. */
    pauseRemainingMs: number | null;
    rules: readonly HostRule[];
}

/** The snapshot the page may read. Plain data; no address of a provider, no file path, nothing the page could use to change a thing. */
export function buildPrivacyAnswer(input: PrivacyInput) {
    return {
        cancelled: { ...input.counts },
        dns: {
            line: input.dnsLine, mode: input.dnsMode, provider: input.dnsProvider,
            saved: { mode: input.dnsSaved.mode, provider: input.dnsSaved.provider },
            // A restart is pending when what is saved is not what this start put in force (the provider only counts while a mode is on).
            pending: input.dnsSaved.mode !== input.dnsMode || (input.dnsSaved.mode !== "off" && input.dnsSaved.provider !== input.dnsProvider)
        },
        telemetry: { usage: input.telemetry.usage, crash: input.telemetry.crash },
        logVersion: Math.max(0, Math.floor(input.logVersion)),
        pause: input.pauseRemainingMs === null ? null : { remainingMs: Math.max(0, Math.round(input.pauseRemainingMs)) },
        rules: input.rules.slice(0, PRIVACY_MAX_RULES).map(rule => ({ id: rule.id, host: rule.host, subdomains: rule.subdomains, reason: rule.reason })),
        ruleCount: input.rules.length,
        providers: DNS_PROVIDERS.map(provider => ({ id: provider.id, name: provider.name, host: new URL(provider.address).hostname, filters: provider.filters, note: provider.note }))
    };
}

export interface TesterDeps {
    verify(address: string): Promise<VerifyResult>;
    /** Milliseconds, any steady clock. */
    now(): number;
}

const refuse = (reason: string): ProviderTestAnswer => ({ ok: false, reason, ms: null });

/** "Test now": asks the provider the real question of the encrypted DNS check and applies nothing. */
export function makeProviderTester(deps: TesterDeps): (id: unknown) => Promise<ProviderTestAnswer> {
    let running = false;
    let lastStart = -Infinity;
    return async id => {
        const provider = findProvider(id);
        if (!provider) return refuse("that provider is not in the list");
        if (running) return refuse("a test is already running");
        const now = deps.now();
        if (now - lastStart < TEST_GAP_MS) return refuse("wait a few seconds before testing again");
        running = true;
        lastStart = now;
        try {
            const result = await deps.verify(provider.address);
            return result.ok ? { ok: true, reason: "", ms: Math.round(result.ms) } : { ok: false, reason: result.reason, ms: null };
        } catch {
            return refuse("the check could not run");
        } finally {
            running = false;
        }
    };
}
