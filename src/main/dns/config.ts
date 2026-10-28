/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the owner chose about encrypted DNS (design 05, piece P6a): the text of `dns.json` (one per Discord, in its own folder), checked field by field, and the decision made
// from it. Pure code. A damaged or odd file means "off" and a sentence for the engine's list of problems; safe mode means "off". Nothing here throws.
// Design: docs/analysis-21-encrypted-dns.md sections 6 and 7.

import { checkAddress, CUSTOM_PROVIDER, findProvider } from "./providers";

export const DNS_MODES = ["off", "automatic", "strict"] as const;
export type DnsMode = typeof DNS_MODES[number];

export interface DnsConfig {
    mode: DnsMode;
    /** A provider id from the table, `custom`, or empty (none chosen). */
    provider: string;
    /** The address typed by hand; only read when `provider` is `custom`. */
    custom: string;
}

export const DNS_FILE_SCHEMA = 1;
export const MAX_DNS_FILE_CHARS = 16 * 1024;

export const defaultDnsConfig = (): DnsConfig => ({ mode: "off", provider: "", custom: "" });

export interface ParsedDnsConfig {
    config: DnsConfig;
    problems: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Read the text of `dns.json`. Anything wrong gives encrypted DNS "off" and says why. */
export function parseDnsConfig(text: string): ParsedDnsConfig {
    const off = (problem: string): ParsedDnsConfig => ({ config: defaultDnsConfig(), problems: [problem] });
    if (text.length > MAX_DNS_FILE_CHARS) return off("dns.json is too large to be read, so encrypted DNS stays off");
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return off("dns.json could not be read as JSON, so encrypted DNS stays off");
    }
    if (!isRecord(data) || data.schema !== DNS_FILE_SCHEMA) return off("dns.json has an unexpected shape, so encrypted DNS stays off");
    if (typeof data.mode !== "string" || !(DNS_MODES as readonly string[]).includes(data.mode)) return off("dns.json names a mode this version does not know, so encrypted DNS stays off");
    const provider = typeof data.provider === "string" && /^[a-z0-9-]{0,40}$/.test(data.provider) ? data.provider : null;
    if (provider === null) return off("dns.json names a provider in a form that is not allowed, so encrypted DNS stays off");
    const custom = typeof data.custom === "string" && data.custom.length <= 200 ? data.custom : "";
    return { config: { mode: data.mode as DnsMode, provider, custom }, problems: [] };
}

/** The text to write into `dns.json`. */
export function serializeDnsConfig(config: DnsConfig): string {
    return JSON.stringify({ schema: DNS_FILE_SCHEMA, mode: config.mode, provider: config.provider, custom: config.custom }, null, 2) + "\n";
}

export interface DnsChoice {
    /** What is to be applied: `off` means leave the system's way alone. */
    mode: DnsMode;
    /** The address to use, or null when `off`. */
    address: string | null;
    /** The provider's plain name, for the status. Empty when `off`. */
    name: string;
}

export interface ChosenDns {
    choice: DnsChoice;
    /** Why a wanted mode is not being used (empty when nothing was wanted or all is fine). */
    problems: string[];
}

const OFF: DnsChoice = { mode: "off", address: null, name: "" };

/** Turn the saved choice into what to apply. Safe mode and a choice that cannot be used both give "off", and say which. */
export function chooseDns(config: DnsConfig, safeMode: boolean): ChosenDns {
    if (config.mode === "off") return { choice: OFF, problems: [] };
    if (safeMode) return { choice: OFF, problems: ["safe mode keeps encrypted DNS off"] };
    if (config.provider === CUSTOM_PROVIDER) {
        const address = checkAddress(config.custom);
        if (address === null) return { choice: OFF, problems: ["the address typed for encrypted DNS is not acceptable (it must be https, a plain host name or number, and a short path), so it stays off"] };
        return { choice: { mode: config.mode, address, name: "your own address" }, problems: [] };
    }
    const provider = findProvider(config.provider);
    if (!provider) return { choice: OFF, problems: [config.provider === "" ? "encrypted DNS is on but no provider was chosen, so it stays off" : "encrypted DNS names a provider this version does not know, so it stays off"] };
    return { choice: { mode: config.mode, address: provider.address, name: provider.name }, problems: [] };
}
