/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Plugin health: what went wrong with which plugin, per session, and how stable each plugin has been.
// Pure functions on plain data; the main process keeps the file (src/main/healthStore.ts).
// Design: docs/design-02-core.md section 8 and docs/design-01-manifest-permissions.md section 10.

export const HISTORY_WINDOW = 10;
/** Sessions a plugin must have been seen in before its stability can be called "stable". */
export const MIN_SESSIONS_FOR_BADGE = 3;
/** Share of broken sessions from which a plugin is "unstable". Below it (but above zero) it is "flaky". */
export const UNSTABLE_RATIO = 0.4;
export const MAX_ISSUES_PER_PLUGIN = 50;
export const MAX_NOTICES_PER_PLUGIN = 20;
export const MAX_TEXT_LENGTH = 2000;

export type IssueKind =
    | "patch-no-module"
    | "patch-no-effect"
    | "patch-errored"
    | "patch-undone"
    | "patch-syntax"
    | "start-failed"
    | "runtime-error"
    | "finder-miss";

export interface Issue {
    kind: IssueKind;
    /** `error` breaks the session for the plugin; `warning` (an optional patch or finder) does not. */
    severity: "error" | "warning";
    detail: string;
    /** Same kind, find and match give the same key; repeats only raise `count`. */
    key: string;
    count: number;
    firstAt: number;
    lastAt: number;
    moduleId?: string;
}

/** Something worth knowing that is not the plugin's fault, such as Discord changing a module. It never breaks a session. */
export interface Notice {
    kind: "discord-changed";
    detail: string;
    at: number;
}

export interface PluginHealth {
    issues: Issue[];
    notices: Notice[];
    /** How long the plugin took to start this session, in milliseconds. */
    startMs?: number;
}

export interface SessionCounts {
    patchFailures: number;
    runtimeErrors: number;
    startFailures: number;
    finderMisses: number;
    notices: number;
}

/** `fail` is the bad answer; `not-seen` means the check could not observe what it looks at, which is never a pass. */
export type SelfTestVerdict = "pass" | "fail" | "not-seen";

export interface SelfTestRecord {
    name: string;
    status: SelfTestVerdict;
    detail: string;
    /** Milliseconds after the page script started. */
    ms: number;
}

export const MAX_SELF_TESTS = 8;
export const SELF_TEST_VERDICTS: readonly string[] = ["pass", "fail", "not-seen"];
const VERDICT_RANK: Record<SelfTestVerdict, number> = { "not-seen": 0, pass: 1, fail: 2 };

export interface SessionRecord {
    id: string;
    startedAt: number;
    endedAt: number;
    discordBuild: number | null;
    /** Plugins that were enabled (ran) during the session. */
    enabled: string[];
    plugins: Record<string, SessionCounts>;
    /** The privacy self-test results of the session (design 05, piece P1). */
    selfTests?: SelfTestRecord[];
}

export interface HealthState {
    schema: 1;
    current: SessionRecord;
    /** Details of the current session. */
    plugins: Record<string, PluginHealth>;
    /** Past sessions, oldest first, at most HISTORY_WINDOW. */
    history: SessionRecord[];
    /** Details of the session before this one, kept to investigate what happened last time. */
    previous: { sessionId: string; plugins: Record<string, PluginHealth>; } | null;
}

/** Patch outcome as the patch compiler reports it (only the fields health needs). */
export interface PatchEventReplacement {
    match: string;
    status: "applied" | "no-effect" | "errored" | "undone" | "not-run" | "syntax-error" | "not-applicable";
    error?: string;
}

export type HealthEvent =
    | { type: "patch"; plugin: string; find: string; moduleId: string; required: boolean; status: "applied" | "partial" | "failed" | "undone" | "skipped"; replacements: PatchEventReplacement[]; }
    | { type: "patch-no-module"; plugin: string; find: string; required: boolean; }
    | { type: "start-failed"; plugin: string; error: string; }
    | { type: "started"; plugin: string; ms: number; }
    | { type: "runtime-error"; plugin: string; source: string; error: string; }
    | { type: "finder-miss"; plugin: string; finder: string; required: boolean; }
    | { type: "discord-changed"; plugin: string; find: string; detail: string; }
    | { type: "enabled"; plugins: string[]; }
    | { type: "discord-build"; build: number | null; }
    | { type: "self-test"; name: string; status: SelfTestVerdict; detail: string; ms: number; };

// ---------------------------------------------------------------------------------------------------------------------
// Redaction: nothing that identifies the user is stored or shown

/** Removes things that identify the user from text: Discord ids, token-shaped strings, e-mail addresses, Windows user names. */
export function redact(text: string): string {
    return text
        .replace(/[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g, "<token>")
        .replace(/\b\d{17,20}\b/g, "<id>")
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
        .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, "$1<user>");
}

function clean(text: string): string {
    const redacted = redact(text);
    return redacted.length <= MAX_TEXT_LENGTH ? redacted : redacted.slice(0, MAX_TEXT_LENGTH) + "\n… (truncated)";
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export const emptyCounts = (): SessionCounts => ({ patchFailures: 0, runtimeErrors: 0, startFailures: 0, finderMisses: 0, notices: 0 });

export function newSession(id: string, now: number, build: number | null = null): SessionRecord {
    return { id, startedAt: now, endedAt: now, discordBuild: build, enabled: [], plugins: {} };
}

export function defaultHealthState(sessionId: string, now: number, build: number | null = null): HealthState {
    return { schema: 1, current: newSession(sessionId, now, build), plugins: {}, history: [], previous: null };
}

/** Begin a new session: the current one goes to the history (oldest dropped past the window) and its details are kept once. */
export function startSession(state: HealthState, sessionId: string, now: number, build: number | null = null): HealthState {
    const touched = state.current.enabled.length > 0 || Object.keys(state.current.plugins).length > 0 || (state.current.selfTests?.length ?? 0) > 0;
    return {
        schema: 1,
        current: newSession(sessionId, now, build),
        plugins: {},
        history: touched ? [...state.history, state.current].slice(-HISTORY_WINDOW) : state.history,
        previous: touched ? { sessionId: state.current.id, plugins: state.plugins } : state.previous
    };
}

const BAD_COUNTS: Array<keyof SessionCounts> = ["patchFailures", "runtimeErrors", "startFailures", "finderMisses"];

export const isBroken = (counts: SessionCounts | undefined) => !!counts && BAD_COUNTS.some(k => counts[k] > 0);

type IssueInput = Omit<Issue, "count" | "firstAt" | "lastAt">;

function withIssue(plugin: PluginHealth | undefined, input: IssueInput, now: number): PluginHealth {
    const base: PluginHealth = plugin ?? { issues: [], notices: [] };
    const existing = base.issues.findIndex(i => i.key === input.key);
    if (existing >= 0) {
        const issues = base.issues.slice();
        issues[existing] = { ...issues[existing], count: issues[existing].count + 1, lastAt: now, moduleId: input.moduleId ?? issues[existing].moduleId };
        return { ...base, issues };
    }
    const issues = [...base.issues, { ...input, count: 1, firstAt: now, lastAt: now }].slice(-MAX_ISSUES_PER_PLUGIN);
    return { ...base, issues };
}

function bump(state: HealthState, plugin: string, field: keyof SessionCounts, now: number): HealthState["current"] {
    const counts = { ...(state.current.plugins[plugin] ?? emptyCounts()) };
    counts[field]++;
    return { ...state.current, endedAt: now, plugins: { ...state.current.plugins, [plugin]: counts } };
}

function issuesOfPatch(event: Extract<HealthEvent, { type: "patch"; }>): IssueInput[] {
    if (event.status === "applied" || event.status === "skipped") return [];
    const severity = event.required ? "error" : "warning";
    const base = (kind: IssueKind, match: string, detail: string): IssueInput => ({
        kind, severity, detail: clean(detail), key: `${kind}|${event.find}|${match}`, moduleId: event.moduleId
    });

    if (event.status === "undone") {
        const cause = event.replacements.find(r => r.status === "no-effect" || r.status === "errored");
        return [base("patch-undone", cause?.match ?? "", `group of ${event.find} undone${cause ? `: ${cause.match} ${cause.status}${cause.error ? ` (${cause.error})` : ""}` : ""}`)];
    }
    const out: IssueInput[] = [];
    for (const r of event.replacements) {
        if (r.status === "no-effect") out.push(base("patch-no-effect", r.match, `${r.match} found nothing in the module matched by ${event.find}`));
        else if (r.status === "errored") out.push(base("patch-errored", r.match, `${r.match} threw: ${r.error ?? "unknown error"}`));
        else if (r.status === "syntax-error") out.push(base("patch-syntax", r.match, `${r.match} made the module invalid and was dropped`));
    }
    return out;
}

/**
 * Take away the "no module matched" issue of a patch that has now found its module, and the failures that issue added to this session.
 * The boot judges a patch "no module" a few seconds after the page is ready; Discord loads some modules only when a screen opens, later than that.
 */
function settleNoModule(state: HealthState, plugin: string, find: string, now: number): HealthState {
    const key = `patch-no-module|${find}|`;
    const health = state.plugins[plugin];
    const issue = health?.issues.find(i => i.key === key);
    if (!health || !issue) return state;
    const plugins = { ...state.plugins, [plugin]: { ...health, issues: health.issues.filter(i => i.key !== key) } };
    const counts = state.current.plugins[plugin];
    if (issue.severity !== "error" || !counts) return { ...state, plugins };
    const settled = { ...counts, patchFailures: Math.max(0, counts.patchFailures - issue.count) };
    return { ...state, current: { ...state.current, endedAt: now, plugins: { ...state.current.plugins, [plugin]: settled } }, plugins };
}

/** Record one event. Returns a new state; the one given is not changed. */
export function recordEvent(state: HealthState, event: HealthEvent, now: number): HealthState {
    switch (event.type) {
        case "enabled":
            return { ...state, current: { ...state.current, endedAt: now, enabled: [...new Set(event.plugins)] } };

        case "discord-build":
            return { ...state, current: { ...state.current, endedAt: now, discordBuild: event.build } };

        case "self-test": {
            // Within a session the worst answer for a check stays: a fail is never replaced by a pass, a pass never by "not seen".
            const record: SelfTestRecord = { name: event.name.slice(0, 40), status: event.status, detail: clean(event.detail).slice(0, 300), ms: Math.max(0, Math.round(event.ms)) };
            const list = (state.current.selfTests ?? []).slice();
            const at = list.findIndex(t => t.name === record.name);
            if (at < 0) list.push(record);
            else if (VERDICT_RANK[record.status] > VERDICT_RANK[list[at].status]) list[at] = record;
            return { ...state, current: { ...state.current, endedAt: now, selfTests: list.slice(0, MAX_SELF_TESTS) } };
        }

        case "started": {
            const health = state.plugins[event.plugin] ?? { issues: [], notices: [] };
            return { ...state, current: { ...state.current, endedAt: now }, plugins: { ...state.plugins, [event.plugin]: { ...health, startMs: event.ms } } };
        }

        case "discord-changed": {
            const health = state.plugins[event.plugin] ?? { issues: [], notices: [] };
            const notices = [...health.notices, { kind: "discord-changed" as const, detail: clean(`${event.find}: ${event.detail}`), at: now }].slice(-MAX_NOTICES_PER_PLUGIN);
            return { ...state, current: bump(state, event.plugin, "notices", now), plugins: { ...state.plugins, [event.plugin]: { ...health, notices } } };
        }

        case "patch": {
            // A module that loads late (a screen opened after the boot judged the patch "no module") settles that notice: the patch did find its module.
            const settled = event.status !== "skipped" ? settleNoModule(state, event.plugin, event.find, now) : state;
            const inputs = issuesOfPatch(event);
            if (inputs.length === 0) return settled;
            let health = settled.plugins[event.plugin];
            for (const input of inputs) health = withIssue(health, input, now);
            const current = inputs.some(i => i.severity === "error") ? bump(settled, event.plugin, "patchFailures", now) : settled.current;
            return { ...settled, current, plugins: { ...settled.plugins, [event.plugin]: health } };
        }

        case "patch-no-module": {
            const input: IssueInput = { kind: "patch-no-module", severity: event.required ? "error" : "warning", detail: clean(`no module matched ${event.find}`), key: `patch-no-module|${event.find}|` };
            const current = event.required ? bump(state, event.plugin, "patchFailures", now) : state.current;
            return { ...state, current, plugins: { ...state.plugins, [event.plugin]: withIssue(state.plugins[event.plugin], input, now) } };
        }

        case "finder-miss": {
            const input: IssueInput = { kind: "finder-miss", severity: event.required ? "error" : "warning", detail: clean(`finder found no module: ${event.finder}`), key: `finder-miss|${event.finder}|` };
            const current = event.required ? bump(state, event.plugin, "finderMisses", now) : state.current;
            return { ...state, current, plugins: { ...state.plugins, [event.plugin]: withIssue(state.plugins[event.plugin], input, now) } };
        }

        case "start-failed": {
            const input: IssueInput = { kind: "start-failed", severity: "error", detail: clean(event.error), key: `start-failed|${redact(event.error).slice(0, 200)}|` };
            return { ...state, current: bump(state, event.plugin, "startFailures", now), plugins: { ...state.plugins, [event.plugin]: withIssue(state.plugins[event.plugin], input, now) } };
        }

        case "runtime-error": {
            const input: IssueInput = { kind: "runtime-error", severity: "error", detail: clean(`${event.source}: ${event.error}`), key: `runtime-error|${event.source}|${redact(event.error).slice(0, 200)}` };
            return { ...state, current: bump(state, event.plugin, "runtimeErrors", now), plugins: { ...state.plugins, [event.plugin]: withIssue(state.plugins[event.plugin], input, now) } };
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stability

export type StabilityBadge = "unknown" | "stable" | "flaky" | "unstable";

export interface Stability {
    badge: StabilityBadge;
    sessionsSeen: number;
    sessionsBroken: number;
}

/**
 * Over the last sessions (the current one included): a plugin was "seen" in a session if it was enabled or recorded anything,
 * and "broken" if it had a failed required patch, a start failure, a runtime error or a missing required finder.
 * A change of Discord's code (a notice) never counts.
 */
export function stabilityOf(state: HealthState, plugin: string): Stability {
    const sessions = [...state.history, state.current].slice(-HISTORY_WINDOW);
    let sessionsSeen = 0;
    let sessionsBroken = 0;
    for (const session of sessions) {
        const counts = session.plugins[plugin];
        if (!session.enabled.includes(plugin) && !counts) continue;
        sessionsSeen++;
        if (isBroken(counts)) sessionsBroken++;
    }

    let badge: StabilityBadge;
    if (sessionsBroken === 0) badge = sessionsSeen < MIN_SESSIONS_FOR_BADGE ? "unknown" : "stable";
    else badge = sessionsBroken / sessionsSeen >= UNSTABLE_RATIO ? "unstable" : "flaky";
    return { badge, sessionsSeen, sessionsBroken };
}

// ---------------------------------------------------------------------------------------------------------------------
// Report

export interface PluginReportEntry extends Stability {
    plugin: string;
    errors: number;
    warnings: number;
    notices: number;
    startMs?: number;
    issues: Issue[];
}

export interface HealthReport {
    discordBuild: number | null;
    sessionStartedAt: number;
    pluginsEnabled: number;
    /** The privacy self-test results of this session. */
    selfTests: SelfTestRecord[];
    /** Plugins with something to show: an issue, a notice, or a stability other than stable and unknown. */
    plugins: PluginReportEntry[];
    text: string;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** A summary that can be pasted in a private chat. Everything in it has been redacted already. */
export function buildReport(state: HealthState): HealthReport {
    const names = new Set<string>([...Object.keys(state.plugins), ...state.current.enabled]);
    const entries: PluginReportEntry[] = [];

    for (const plugin of [...names].sort()) {
        const health = state.plugins[plugin];
        const stability = stabilityOf(state, plugin);
        const issues = health?.issues ?? [];
        const errors = issues.filter(i => i.severity === "error").length;
        const warnings = issues.length - errors;
        const notices = health?.notices.length ?? 0;
        const interesting = errors > 0 || warnings > 0 || notices > 0 || stability.badge === "flaky" || stability.badge === "unstable";
        if (interesting) entries.push({ plugin, ...stability, errors, warnings, notices, startMs: health?.startMs, issues });
    }

    const lines = [
        "Amiricord health report",
        `Discord build: ${state.current.discordBuild ?? "unknown"} · session started ${iso(state.current.startedAt)} · plugins enabled: ${state.current.enabled.length}`
    ];
    const selfTests = state.current.selfTests ?? [];
    if (selfTests.some(t => t.status === "fail")) lines.push("PRIVACY SELF-TEST FAILED: Discord was told this client has mods.");
    for (const t of selfTests) lines.push(`Privacy self-test ${t.name}: ${t.status} after ${t.ms} ms. ${t.detail}`);
    if (entries.length === 0) lines.push("No problems recorded this session.");
    for (const e of entries) {
        const seen = e.sessionsSeen > 0 ? ` (${e.sessionsBroken} of ${e.sessionsSeen} sessions broken)` : "";
        lines.push(`${e.plugin}: ${e.badge}${seen} · ${e.errors} error(s), ${e.warnings} warning(s), ${e.notices} Discord change notice(s)`);
        for (const i of e.issues.slice(-5)) lines.push(`  - [${i.severity}] ${i.kind}${i.count > 1 ? ` x${i.count}` : ""}: ${i.detail.split("\n")[0]}`);
    }

    return { discordBuild: state.current.discordBuild, sessionStartedAt: state.current.startedAt, pluginsEnabled: state.current.enabled.length, selfTests: selfTests.map(t => ({ ...t })), plugins: entries, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading and writing

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string";

function asCounts(raw: unknown): SessionCounts {
    const counts = emptyCounts();
    if (isRecord(raw)) for (const k of Object.keys(counts) as Array<keyof SessionCounts>) if (isNumber(raw[k]) && raw[k] >= 0) counts[k] = Math.floor(raw[k]);
    return counts;
}

function asSession(raw: unknown): SessionRecord | null {
    if (!isRecord(raw) || !isText(raw.id) || !isNumber(raw.startedAt)) return null;
    const plugins: Record<string, SessionCounts> = {};
    if (isRecord(raw.plugins)) for (const [id, c] of Object.entries(raw.plugins)) plugins[id] = asCounts(c);
    const selfTests: SelfTestRecord[] = [];
    if (Array.isArray(raw.selfTests)) {
        for (const t of raw.selfTests) {
            if (isRecord(t) && isText(t.name) && isText(t.status) && SELF_TEST_VERDICTS.includes(t.status) && isText(t.detail) && isNumber(t.ms)) {
                selfTests.push({ name: t.name.slice(0, 40), status: t.status as SelfTestVerdict, detail: clean(t.detail).slice(0, 300), ms: Math.max(0, Math.round(t.ms)) });
            }
        }
    }
    return {
        id: raw.id,
        startedAt: raw.startedAt,
        endedAt: isNumber(raw.endedAt) ? raw.endedAt : raw.startedAt,
        discordBuild: isNumber(raw.discordBuild) ? raw.discordBuild : null,
        enabled: Array.isArray(raw.enabled) ? raw.enabled.filter(isText) : [],
        plugins,
        ...(selfTests.length ? { selfTests: selfTests.slice(0, MAX_SELF_TESTS) } : {})
    };
}

const ISSUE_KINDS: readonly string[] = ["patch-no-module", "patch-no-effect", "patch-errored", "patch-undone", "patch-syntax", "start-failed", "runtime-error", "finder-miss"];

function asPluginHealth(raw: unknown): PluginHealth {
    const out: PluginHealth = { issues: [], notices: [] };
    if (!isRecord(raw)) return out;
    if (isNumber(raw.startMs)) out.startMs = raw.startMs;
    if (Array.isArray(raw.issues)) {
        for (const i of raw.issues) {
            if (!isRecord(i) || !isText(i.kind) || !ISSUE_KINDS.includes(i.kind) || !isText(i.key) || !isText(i.detail)) continue;
            out.issues.push({
                kind: i.kind as IssueKind,
                severity: i.severity === "warning" ? "warning" : "error",
                detail: clean(i.detail),
                key: i.key,
                count: isNumber(i.count) && i.count > 0 ? Math.floor(i.count) : 1,
                firstAt: isNumber(i.firstAt) ? i.firstAt : 0,
                lastAt: isNumber(i.lastAt) ? i.lastAt : 0,
                ...(isText(i.moduleId) ? { moduleId: i.moduleId } : {})
            });
        }
        out.issues = out.issues.slice(-MAX_ISSUES_PER_PLUGIN);
    }
    if (Array.isArray(raw.notices)) {
        for (const n of raw.notices) {
            if (isRecord(n) && n.kind === "discord-changed" && isText(n.detail)) out.notices.push({ kind: "discord-changed", detail: clean(n.detail), at: isNumber(n.at) ? n.at : 0 });
        }
        out.notices = out.notices.slice(-MAX_NOTICES_PER_PLUGIN);
    }
    return out;
}

const asPluginMap = (raw: unknown): Record<string, PluginHealth> => {
    const out: Record<string, PluginHealth> = {};
    if (isRecord(raw)) for (const [id, h] of Object.entries(raw)) out[id] = asPluginHealth(h);
    return out;
};

export interface ParseHealthResult {
    state: HealthState;
    problems: string[];
}

/** Read stored text. Never throws; damaged parts are dropped and listed. The new session is started by the caller. */
export function parseHealthState(text: string, fallbackSessionId: string, now: number): ParseHealthResult {
    const fresh = () => defaultHealthState(fallbackSessionId, now);
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { state: fresh(), problems: ["health data is not valid JSON, starting empty"] };
    }
    if (!isRecord(raw) || raw.schema !== 1) return { state: fresh(), problems: ["health data has an unknown format, starting empty"] };

    const problems: string[] = [];
    const current = asSession(raw.current);
    if (!current) problems.push("the current session record is damaged, replaced");

    const history: SessionRecord[] = [];
    if (Array.isArray(raw.history)) {
        raw.history.forEach((s, i) => {
            const session = asSession(s);
            if (session) history.push(session);
            else problems.push(`history[${i}] is damaged, ignored`);
        });
    }

    let previous: HealthState["previous"] = null;
    if (isRecord(raw.previous) && isText(raw.previous.sessionId)) previous = { sessionId: raw.previous.sessionId, plugins: asPluginMap(raw.previous.plugins) };

    return {
        state: { schema: 1, current: current ?? newSession(fallbackSessionId, now), plugins: asPluginMap(raw.plugins), history: history.slice(-HISTORY_WINDOW), previous },
        problems
    };
}

export const serializeHealthState = (state: HealthState) => JSON.stringify(state) + "\n";
