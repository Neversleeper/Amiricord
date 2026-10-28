/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The boot state: safe mode, quarantine and the failed-boot counter. Pure functions only, no file access.
// The main process reads it before any patch is registered. Design: docs/design-02-core.md section 3.

/** Failed boots in a row that turn safe mode on by itself. */
export const BOOT_FAILURE_LIMIT = 3;
/** Start failures of one plugin inside the window that put it in quarantine. */
export const START_FAILURE_LIMIT = 3;
export const START_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

const MAX_FAILURE_TIMES_PER_PLUGIN = 20;
const MAX_BOOT_ATTEMPTS = 1000;

export interface QuarantineEntry {
    id: string;
    reason: string;
    /** When it was quarantined, in milliseconds since the epoch. */
    at: number;
}

export interface BootState {
    schema: 1;
    safeMode: boolean;
    safeModeReason: string | null;
    quarantine: QuarantineEntry[];
    /** Recent start failures per plugin id (milliseconds since the epoch), used for the 24 hour rule. */
    startFailures: Record<string, number[]>;
    /** Boots that began and have not been reported clean. Zero after a clean boot. */
    bootAttempts: number;
    lastBootAt: number;
}

export function defaultBootState(): BootState {
    return {
        schema: 1,
        safeMode: false,
        safeModeReason: null,
        quarantine: [],
        startFailures: {},
        bootAttempts: 0,
        lastBootAt: 0
    };
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export interface ParseResult {
    state: BootState;
    /** Things that were wrong in the stored text. Empty when it was fine. Shown in the health report. */
    problems: string[];
}

/**
 * Read the stored text. Never throws: damaged or unknown data gives the defaults for that part,
 * and each problem is listed so the health report can say what happened.
 */
export function parseBootState(text: string): ParseResult {
    const problems: string[] = [];

    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { state: defaultBootState(), problems: ["boot state is not valid JSON, using defaults"] };
    }
    if (!isRecord(raw)) {
        return { state: defaultBootState(), problems: ["boot state is not an object, using defaults"] };
    }
    if (raw.schema !== 1) {
        return { state: defaultBootState(), problems: [`boot state has an unknown schema (${JSON.stringify(raw.schema)}), using defaults`] };
    }

    const state = defaultBootState();

    if (typeof raw.safeMode === "boolean") state.safeMode = raw.safeMode;
    else if (raw.safeMode !== undefined) problems.push("safeMode must be true or false, ignored");

    if (typeof raw.safeModeReason === "string") state.safeModeReason = raw.safeModeReason;
    else if (raw.safeModeReason !== undefined && raw.safeModeReason !== null) problems.push("safeModeReason must be text or null, ignored");
    if (!state.safeMode) state.safeModeReason = null;

    if (isCount(raw.bootAttempts)) state.bootAttempts = Math.min(Math.floor(raw.bootAttempts), MAX_BOOT_ATTEMPTS);
    else if (raw.bootAttempts !== undefined) problems.push("bootAttempts must be a number of zero or more, ignored");

    if (isCount(raw.lastBootAt)) state.lastBootAt = raw.lastBootAt;
    else if (raw.lastBootAt !== undefined) problems.push("lastBootAt must be a number of zero or more, ignored");

    if (Array.isArray(raw.quarantine)) {
        const seen = new Set<string>();
        raw.quarantine.forEach((item, i) => {
            if (!isRecord(item) || typeof item.id !== "string" || item.id === "") {
                problems.push(`quarantine[${i}] has no valid id, ignored`);
                return;
            }
            if (seen.has(item.id)) return;
            seen.add(item.id);
            state.quarantine.push({
                id: item.id,
                reason: typeof item.reason === "string" ? item.reason : "",
                at: isCount(item.at) ? item.at : 0
            });
        });
    } else if (raw.quarantine !== undefined) {
        problems.push("quarantine must be a list, ignored");
    }

    if (isRecord(raw.startFailures)) {
        for (const [id, times] of Object.entries(raw.startFailures)) {
            if (!Array.isArray(times)) {
                problems.push(`startFailures.${id} must be a list, ignored`);
                continue;
            }
            const valid = times.filter(isCount).slice(-MAX_FAILURE_TIMES_PER_PLUGIN);
            if (valid.length) state.startFailures[id] = valid;
        }
    } else if (raw.startFailures !== undefined) {
        problems.push("startFailures must be an object, ignored");
    }

    return { state, problems };
}

export function serializeBootState(state: BootState): string {
    return JSON.stringify(state, null, 2) + "\n";
}

export interface BeginBootResult {
    state: BootState;
    /** True when this boot turned safe mode on because of too many failed boots in a row. */
    enteredSafeMode: boolean;
}

/**
 * Call at every start, before anything else. If the previous boots that were never reported clean
 * reach the limit, safe mode turns on. This boot is then counted as one more attempt.
 */
export function beginBoot(state: BootState, now: number, limit = BOOT_FAILURE_LIMIT): BeginBootResult {
    const failedInARow = state.bootAttempts;
    let enteredSafeMode = false;
    let { safeMode, safeModeReason } = state;

    if (failedInARow >= limit && !safeMode) {
        safeMode = true;
        safeModeReason = `${failedInARow} boots in a row did not finish`;
        enteredSafeMode = true;
    }

    return {
        state: { ...state, safeMode, safeModeReason, bootAttempts: Math.min(failedInARow + 1, MAX_BOOT_ATTEMPTS), lastBootAt: now },
        enteredSafeMode
    };
}

/** Call when the renderer reports that all plugin stages finished. Safe mode stays on until the user turns it off. */
export function reportCleanBoot(state: BootState): BootState {
    return { ...state, bootAttempts: 0 };
}

/**
 * Call when Discord closes by itself before this boot was reported clean (an update restarting it, the person closing it, a restart asked from the
 * Settings page). Such a boot did not fail, so it stops counting. A crash never gets here: only the failed boots stay counted.
 */
export function forgetUnfinishedBoot(state: BootState): BootState {
    return state.bootAttempts > 0 ? { ...state, bootAttempts: state.bootAttempts - 1 } : state;
}

/** Turn safe mode off and forget the failed boots, so the next start is a normal one. */
export function leaveSafeMode(state: BootState): BootState {
    return { ...state, safeMode: false, safeModeReason: null, bootAttempts: 0 };
}

export function setSafeMode(state: BootState, on: boolean, reason: string | null = null): BootState {
    return { ...state, safeMode: on, safeModeReason: on ? reason : null };
}

export function isQuarantined(state: BootState, id: string): boolean {
    return state.quarantine.some(q => q.id === id);
}

export function quarantinedIds(state: BootState): string[] {
    return state.quarantine.map(q => q.id);
}

export function quarantinePlugin(state: BootState, id: string, reason: string, now: number): BootState {
    if (isQuarantined(state, id)) return state;
    return { ...state, quarantine: [...state.quarantine, { id, reason, at: now }] };
}

/** Take a plugin out of quarantine. Its failure history is cleared so it gets a fresh start. */
export function unquarantinePlugin(state: BootState, id: string): BootState {
    const { [id]: _removed, ...startFailures } = state.startFailures;
    return { ...state, quarantine: state.quarantine.filter(q => q.id !== id), startFailures };
}

export interface StartFailureResult {
    state: BootState;
    /** True when this failure put the plugin in quarantine. */
    quarantined: boolean;
}

/**
 * Record that a plugin failed to start. Failures older than the window are forgotten.
 * Reaching the limit inside the window puts the plugin in quarantine.
 */
export function recordStartFailure(
    state: BootState,
    id: string,
    now: number,
    limit = START_FAILURE_LIMIT,
    windowMs = START_FAILURE_WINDOW_MS
): StartFailureResult {
    const recent = [...(state.startFailures[id] ?? []).filter(t => now - t < windowMs), now].slice(-MAX_FAILURE_TIMES_PER_PLUGIN);
    let next: BootState = { ...state, startFailures: { ...state.startFailures, [id]: recent } };

    if (recent.length >= limit && !isQuarantined(next, id)) {
        next = quarantinePlugin(next, id, `failed to start ${recent.length} times in 24 hours`, now);
        return { state: next, quarantined: true };
    }
    return { state: next, quarantined: false };
}
