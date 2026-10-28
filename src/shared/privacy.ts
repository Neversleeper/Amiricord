/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Privacy & Security tab may learn from the main process (design 05 piece P7a, docs/analysis-22-privacy-security-tab-build.md): the network counters, the
// encrypted DNS state, the owner's host rules and the provider list, and the answer to "Test now". The page only reads. Each answer is rebuilt field by field, so
// whatever else was in it is dropped; an answer that is not the right shape gives null and the tab shows "not known yet". No address of a provider is ever sent.

import { NetworkCounts, parseDnsText, parseNetworkCounts } from "./shields";

export const PRIVACY_DNS_MODES = ["off", "automatic", "strict"] as const;
export type PrivacyDnsMode = typeof PRIVACY_DNS_MODES[number];

/** The most rules one answer carries; the real number is in `ruleCount`. */
export const PRIVACY_MAX_RULES = 200;

/** The longest pause that can be told (ten minutes, the length the main process uses). */
export const PRIVACY_MAX_PAUSE_MS = 600_000;
export const PRIVACY_MAX_PROVIDERS = 30;
const TEXT_MAX = 200;

export interface PrivacyRule {
    id: string;
    host: string;
    subdomains: boolean;
    reason: string;
}

/** The provider the tab picks when the person turns encrypted DNS on and has not chosen one. Must be an id of the main process's table. */
export const DEFAULT_PROVIDER = "mullvad-base";

export interface PrivacyProvider {
    id: string;
    name: string;
    /** The host name of the provider's address, for the status table. Never the full address. */
    host: string;
    filters: "none" | "malware";
    note: string;
}

export interface PrivacyAnswer {
    counts: NetworkCounts;
    dns: {
        /** The one plain line about encrypted DNS. */
        line: string;
        mode: PrivacyDnsMode;
        /** A provider id, `custom`, or empty. */
        provider: string;
        /** What is saved in dns.json now. It takes effect at the next start. */
        saved: { mode: PrivacyDnsMode; provider: string; };
        /** True when what is saved is not what this start put in force, so a restart is pending. */
        pending: boolean;
    };
    /** NoTrack's two switches as the main process holds them (the shields follow them at once; the part inside Discord at the next start). */
    telemetry: { usage: boolean; crash: boolean; };
    /** Grows with every block counted; the page asks for the list of blocks again when it changes. */
    logVersion: number;
    /** Protection is paused when this is not null; the time left in milliseconds (a time left, not a clock time, so the clocks of the page and the main process never matter). */
    pause: { remainingMs: number; } | null;
    /** The first rules (at most `PRIVACY_MAX_RULES`). */
    rules: PrivacyRule[];
    /** How many rules there are in all. */
    ruleCount: number;
    providers: PrivacyProvider[];
}

export interface ProviderTestAnswer {
    ok: boolean;
    /** Why it failed (empty when it passed). */
    reason: string;
    /** How long the provider took, when it answered. */
    ms: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Plain text of at most `max` characters, without control characters. Anything that is not text gives null. */
function text(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

const isId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value);

function parseRule(value: unknown): PrivacyRule | null {
    if (!isRecord(value) || typeof value.subdomains !== "boolean") return null;
    const id = text(value.id, 40);
    const host = typeof value.host === "string" && /^[a-z0-9.-]{1,253}$/.test(value.host) ? value.host : null;
    const reason = text(value.reason, TEXT_MAX);
    if (id === null || host === null || reason === null) return null;
    return { id, host, subdomains: value.subdomains, reason };
}

function parseProvider(value: unknown): PrivacyProvider | null {
    if (!isRecord(value) || !isId(value.id) || (value.filters !== "none" && value.filters !== "malware")) return null;
    const name = text(value.name, 60);
    const note = text(value.note, TEXT_MAX);
    const host = typeof value.host === "string" && /^[a-z0-9.-]{1,253}$/.test(value.host) ? value.host : null;
    if (name === null || note === null || host === null) return null;
    return { id: value.id, name, host, filters: value.filters, note };
}

/** Rebuild the answer of the main process. Null when the counters, the DNS state, the rules or the providers are not in the expected form. */
export function parsePrivacyAnswer(value: unknown): PrivacyAnswer | null {
    if (!isRecord(value)) return null;
    const counts = parseNetworkCounts(value);
    if (counts === null || !isRecord(value.dns)) return null;
    const mode = (PRIVACY_DNS_MODES as readonly unknown[]).includes(value.dns.mode) ? value.dns.mode as PrivacyDnsMode : null;
    const provider = value.dns.provider === "" || isId(value.dns.provider) ? value.dns.provider as string : null;
    if (mode === null || provider === null) return null;
    const saved = value.dns.saved;
    if (!isRecord(saved) || !(PRIVACY_DNS_MODES as readonly unknown[]).includes(saved.mode) || !(saved.provider === "" || isId(saved.provider)) || typeof value.dns.pending !== "boolean") return null;
    if (typeof value.logVersion !== "number" || !Number.isSafeInteger(value.logVersion) || value.logVersion < 0) return null;
    const pauseValue = value.pause;
    const pause = pauseValue === null ? null : isRecord(pauseValue) && typeof pauseValue.remainingMs === "number" && Number.isSafeInteger(pauseValue.remainingMs) && pauseValue.remainingMs >= 0 && pauseValue.remainingMs <= PRIVACY_MAX_PAUSE_MS ? { remainingMs: pauseValue.remainingMs } : undefined;
    if (pause === undefined) return null;
    const telemetry = value.telemetry;
    if (!isRecord(telemetry) || typeof telemetry.usage !== "boolean" || typeof telemetry.crash !== "boolean") return null;
    const { rules, providers, ruleCount } = value;
    if (!Array.isArray(rules) || rules.length > PRIVACY_MAX_RULES || !Array.isArray(providers) || providers.length > PRIVACY_MAX_PROVIDERS) return null;
    if (typeof ruleCount !== "number" || !Number.isSafeInteger(ruleCount) || ruleCount < rules.length) return null;
    const parsedRules = rules.map(parseRule);
    const parsedProviders = providers.map(parseProvider);
    if (parsedRules.includes(null) || parsedProviders.includes(null)) return null;
    return {
        counts,
        dns: { line: parseDnsText(value.dns.line), mode, provider, saved: { mode: saved.mode as PrivacyDnsMode, provider: saved.provider as string }, pending: value.dns.pending },
        telemetry: { usage: telemetry.usage, crash: telemetry.crash },
        logVersion: value.logVersion,
        pause,
        rules: parsedRules as PrivacyRule[],
        ruleCount,
        providers: parsedProviders as PrivacyProvider[]
    };
}

/** Rebuild the answer to "Test now". Null when it is not in the expected form. */
export function parseProviderTest(value: unknown): ProviderTestAnswer | null {
    if (!isRecord(value) || typeof value.ok !== "boolean") return null;
    const reason = text(value.reason, TEXT_MAX);
    if (reason === null) return null;
    const ms = value.ms === null ? null : typeof value.ms === "number" && Number.isFinite(value.ms) && value.ms >= 0 ? Math.round(value.ms) : undefined;
    if (ms === undefined) return null;
    return { ok: value.ok, reason, ms };
}
