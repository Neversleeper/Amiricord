/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Privacy & Security tab may ask the main process to change (design 05 piece P7b, docs/analysis-22-privacy-security-tab-build.md section 10): one of NoTrack's two
// switches, or the encrypted DNS choice. The page sends ids and booleans only; the main process checks them again, asks the person when the change weakens protection,
// and answers with a short sentence. Both directions are rebuilt field by field.

import { PRIVACY_DNS_MODES, PrivacyDnsMode } from "./privacy";

/** The two switches of NoTrack that the network shields also follow. */
export const TELEMETRY_KEYS = ["disableAnalytics", "disableCrashReports"] as const;
export type TelemetryKey = typeof TELEMETRY_KEYS[number];

export type PrivacyChange =
    | { type: "telemetry"; key: TelemetryKey; value: boolean; }
    | { type: "dns"; mode: PrivacyDnsMode; provider: string; }
    /** Write the list of recent blocks into the exports folder. The main process writes its own data; nothing from the page goes into the file. */
    | { type: "export-blocks"; format: "json" | "csv"; }
    /** Add a block rule for a site. The main process checks the name again (`addRule`) and makes the id. */
    | { type: "rule-add"; host: string; subdomains: boolean; reason: string; }
    /** Remove a rule by the id the main process gave it. */
    | { type: "rule-remove"; id: string; }
    /** Pause protection for ten minutes (the length is the main process's, never the page's). */
    | { type: "pause"; }
    /** End a pause now. */
    | { type: "resume"; }
    /** Go back to the defaults of this tab: telemetry blocking on, encrypted DNS off, any pause ended. The blocked sites are kept. */
    | { type: "reset-defaults"; };

/** The most characters of a typed site name or reason that the page may send; the main process applies the real limits. */
export const RULE_INPUT_MAX = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Rebuild a change that came from the page. Anything that is not exactly one of the two kinds gives null. */
export function parsePrivacyChange(value: unknown): PrivacyChange | null {
    if (!isRecord(value)) return null;
    if (value.type === "telemetry") {
        const key = (TELEMETRY_KEYS as readonly unknown[]).includes(value.key) ? value.key as TelemetryKey : null;
        return key !== null && typeof value.value === "boolean" ? { type: "telemetry", key, value: value.value } : null;
    }
    if (value.type === "dns") {
        const mode = (PRIVACY_DNS_MODES as readonly unknown[]).includes(value.mode) ? value.mode as PrivacyDnsMode : null;
        if (mode === null || typeof value.provider !== "string" || !/^[a-z0-9-]{0,40}$/.test(value.provider)) return null;
        return { type: "dns", mode, provider: value.provider };
    }
    if (value.type === "rule-add") {
        const ok = typeof value.host === "string" && value.host.length <= RULE_INPUT_MAX && typeof value.reason === "string" && value.reason.length <= RULE_INPUT_MAX && typeof value.subdomains === "boolean";
        return ok ? { type: "rule-add", host: value.host as string, subdomains: value.subdomains as boolean, reason: value.reason as string } : null;
    }
    if (value.type === "rule-remove") return typeof value.id === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(value.id) ? { type: "rule-remove", id: value.id } : null;
    if (value.type === "pause" || value.type === "resume" || value.type === "reset-defaults") return { type: value.type };
    if (value.type === "export-blocks") return value.format === "json" || value.format === "csv" ? { type: "export-blocks", format: value.format } : null;
    return null;
}

export const CHANGE_STATUSES = ["applied", "cancelled", "refused"] as const;
export type ChangeStatus = typeof CHANGE_STATUSES[number];

export interface PrivacyChangeResult {
    status: ChangeStatus;
    /** One plain sentence for the tab. */
    message: string;
}

/** Rebuild the answer to a change. Null when it is not in the expected form. */
export function parseChangeResult(value: unknown): PrivacyChangeResult | null {
    if (!isRecord(value) || !(CHANGE_STATUSES as readonly unknown[]).includes(value.status) || typeof value.message !== "string") return null;
    return { status: value.status as ChangeStatus, message: value.message.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 300) };
}
