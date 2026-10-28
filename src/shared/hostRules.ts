/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The owner's host rules (design 05, piece P4c): "do not talk to this host". Pure code with no files and no Electron: the checks of one rule, reading and writing the
// text of the rules file, adding and removing a rule, and the lookup used for every request. Everything read from a file is checked here before it is kept.
// For now there is only the action "block"; "allow" was left out on purpose (docs/analysis-17-host-rules.md). Names are matched on the parsed host,
// never on text found inside an address.

export interface HostRule {
    /** Made by the main process (`r1`, `r2`...). A hand-written file may leave it out. */
    id: string;
    /** A plain lowercase host name such as `m.stripe.com`. */
    host: string;
    /** True: the host and everything under it (`x.m.stripe.com`). False: only that exact name. */
    subdomains: boolean;
    action: "block";
    /** The owner's words, at most `REASON_MAX` characters. Never changes behaviour. */
    reason: string;
    /** Time the rule was made, in milliseconds (0 when the file did not say). */
    created: number;
}

export const HOST_RULE_LIMITS = {
    maxRules: 10_000,
    maxFileChars: 2 * 1024 * 1024,
    maxHostChars: 253,
    reasonMax: 200,
    maxProblems: 20
} as const;

/** Discord's own hosts. Our editor never adds a block for one: it would stop Discord from working. A hand-written rule is kept but warned about. */
export const PROTECTED_HOSTS: readonly string[] = ["discord.com", "discordapp.com", "discordapp.net", "discord.gg", "discord.media"];

/** `host` is `base` or a name under it. */
export const isUnder = (host: string, base: string): boolean => host === base || host.endsWith("." + base);

export const isProtectedHost = (host: string): boolean => PROTECTED_HOSTS.some(base => isUnder(host, base));

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The host name in its plain lowercase form, or null when it is not a plain host name (a scheme, a path, a port, a star, spaces, an IP number, non-ASCII letters...). */
export function normalizeHost(input: unknown): string | null {
    if (typeof input !== "string") return null;
    const host = input.trim().toLowerCase().replace(/\.$/, "");
    if (host.length > HOST_RULE_LIMITS.maxHostChars) return null;
    const labels = host.split(".");
    if (labels.length < 2 || !labels.every(label => LABEL.test(label))) return null;
    if (/^\d+$/.test(labels[labels.length - 1]!)) return null;
    return host;
}

export const FILE_SCHEMA = 1;

export interface ParsedRules {
    rules: HostRule[];
    /** Plain sentences for the engine's list of problems. They name a host (cleaned) but never repeat the owner's reason text. */
    problems: string[];
    /** True when the whole file could not be used (too large, not JSON, not the expected shape, not readable): everything in it is out of force, and saving would replace it. */
    broken?: true;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A name from a file, made safe to print: only host-name characters, shortened. */
const printable = (value: unknown): string => (typeof value === "string" && /^[A-Za-z0-9.*-]{1,60}$/.test(value) ? value : "(not a host name)");

const nextId = (rules: readonly HostRule[]): string => {
    let highest = 0;
    for (const rule of rules) {
        const match = /^r(\d{1,9})$/.exec(rule.id);
        if (match) highest = Math.max(highest, Number(match[1]));
    }
    return `r${highest + 1}`;
};

/** Read the text of `firewall.json`. A broken rule is dropped and reported; the others stay. A broken file gives no rules and one problem. Never throws. */
export function parseRuleFile(text: string): ParsedRules {
    const problems: string[] = [];
    const note = (sentence: string) => { if (problems.length < HOST_RULE_LIMITS.maxProblems) problems.push(sentence); };
    if (text.length > HOST_RULE_LIMITS.maxFileChars) return { rules: [], problems: ["firewall.json is too large to be read, so no host rule is in force"], broken: true };
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { rules: [], problems: ["firewall.json could not be read as JSON, so no host rule is in force"], broken: true };
    }
    if (!isRecord(data) || data.schema !== FILE_SCHEMA || !Array.isArray(data.rules)) {
        return { rules: [], problems: ["firewall.json has an unexpected shape, so no host rule is in force"], broken: true };
    }
    const rules: HostRule[] = [];
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const raw of data.rules) {
        if (!isRecord(raw)) { note("a host rule in firewall.json is not an object and was dropped"); continue; }
        const host = normalizeHost(raw.host);
        if (host === null) { note(`a host rule for ${printable(raw.host)} in firewall.json is not a plain host name and was dropped`); continue; }
        if (raw.action !== "block") { note(`the host rule for ${host} has an action this version does not know and was dropped`); continue; }
        if (seen.has(host)) { note(`the host rule for ${host} appears twice; the first one is used`); continue; }
        if (rules.length >= HOST_RULE_LIMITS.maxRules) { note(`firewall.json has more than ${HOST_RULE_LIMITS.maxRules} rules; the rest were dropped`); break; }
        seen.add(host);
        if (isProtectedHost(host)) note(`the host rule for ${host} blocks one of Discord's own hosts: Discord may stop working`);
        const reason = typeof raw.reason === "string" ? raw.reason.slice(0, HOST_RULE_LIMITS.reasonMax) : "";
        const created = typeof raw.created === "number" && Number.isFinite(raw.created) && raw.created >= 0 ? Math.floor(raw.created) : 0;
        let id = "";
        if (typeof raw.id === "string" && /^r\d{1,9}$/.test(raw.id) && !ids.has(raw.id)) {
            id = raw.id;
            ids.add(id);
        }
        rules.push({ id, host, subdomains: raw.subdomains !== false, action: "block", reason, created });
    }
    // A hand-written file may leave the ids out (or repeat one): every rule that has none gets the next free one.
    for (const rule of rules) if (rule.id === "") rule.id = nextId(rules);
    return { rules, problems };
}

/** The text to write into `firewall.json`. */
export function serializeRules(rules: readonly HostRule[]): string {
    return JSON.stringify({ schema: FILE_SCHEMA, rules }, null, 2) + "\n";
}

export type RuleChange =
    | { ok: true; rules: HostRule[]; rule: HostRule; }
    | { ok: false; reason: "invalid-host" | "protected-host" | "duplicate" | "too-many" | "reason-too-long"; };

/** Add a block rule from the owner's input, as the editor will. Our editor refuses Discord's own hosts. */
export function addRule(rules: readonly HostRule[], input: { host: unknown; subdomains?: unknown; reason?: unknown; }, now: number): RuleChange {
    const host = normalizeHost(input.host);
    if (host === null) return { ok: false, reason: "invalid-host" };
    if (isProtectedHost(host)) return { ok: false, reason: "protected-host" };
    if (rules.some(rule => rule.host === host)) return { ok: false, reason: "duplicate" };
    if (rules.length >= HOST_RULE_LIMITS.maxRules) return { ok: false, reason: "too-many" };
    const reason = input.reason === undefined ? "" : input.reason;
    if (typeof reason !== "string" || reason.length > HOST_RULE_LIMITS.reasonMax) return { ok: false, reason: "reason-too-long" };
    const rule: HostRule = { id: nextId(rules), host, subdomains: input.subdomains !== false, action: "block", reason, created: Math.max(0, Math.floor(now)) };
    return { ok: true, rules: [...rules, rule], rule };
}

/** Take a rule out by its id. Returns the same list when there is no such rule. */
export function removeRule(rules: readonly HostRule[], id: unknown): HostRule[] {
    return rules.filter(rule => rule.id !== id);
}

/** A fast lookup: the rule that covers a host name, or null. It walks up the labels of the name, so its cost does not grow with the number of rules. */
export function makeHostMatcher(rules: readonly HostRule[]): (hostname: string) => HostRule | null {
    const byHost = new Map<string, HostRule>();
    for (const rule of rules) if (!byHost.has(rule.host)) byHost.set(rule.host, rule);
    return hostname => {
        if (typeof hostname !== "string" || hostname === "") return null;
        const exact = byHost.get(hostname);
        if (exact) return exact;
        let rest = hostname;
        for (;;) {
            const dot = rest.indexOf(".");
            if (dot < 0) return null;
            rest = rest.slice(dot + 1);
            if (!rest.includes(".")) return null;
            const parent = byHost.get(rest);
            if (parent?.subdomains) return parent;
        }
    };
}
