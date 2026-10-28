/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which hosts may receive the account's token besides Discord's own: the hosts that ENABLED plugins declared in their manifest, and only for plugins that declare
// `permissions.token: true`. Worked out here, in the main process, from the registry the build wrote and from the owner's saved choices, never from anything the
// page says (design 05, section 10). Pure code: the registry text and the boot decision come in, the list of host patterns goes out. Design: docs/analysis-19-token-guard.md.

import { computeEnabledSet, PluginInfo } from "../shared/enabledSet";
import { normalizeHost } from "../shared/hostRules";
import { ENGINE_APIS } from "../shared/manifest";

export interface TokenHostsInput {
    /** The text of `dist/registry.json`. */
    registryText: string;
    safeMode: boolean;
    quarantine: readonly string[];
    /** The saved choices: plugin id to on or off. */
    choices: Readonly<Record<string, boolean | undefined>>;
}

export interface TokenHosts {
    /** Lowercase host names, or `*.domain` (only the names under the domain, not the domain itself). */
    patterns: string[];
    /** Plain sentences for the engine's list of problems. */
    problems: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** A declared host in its plain form (`host` or `*.domain`), or null when it is neither. */
export function normalizePattern(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (text.startsWith("*.")) {
        const domain = normalizeHost(text.slice(2));
        return domain === null ? null : `*.${domain}`;
    }
    return normalizeHost(text);
}

/** Does this host name match one of the patterns? `*.domain` matches the names under the domain, never the domain itself. */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
    return patterns.some(pattern => (pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : host === pattern));
}

const NONE = (...problems: string[]): TokenHosts => ({ patterns: [], problems });

/** The hosts that may get the token. A registry that cannot be read means that NO plugin may get it. Never throws. */
export function tokenHostsFromRegistry(input: TokenHostsInput): TokenHosts {
    let data: unknown;
    try {
        data = JSON.parse(input.registryText);
    } catch {
        return NONE("the plugin registry could not be read, so no plugin may receive the token");
    }
    if (!isRecord(data) || !Array.isArray(data.plugins) || !isStringArray(data.startOrder)) {
        return NONE("the plugin registry has an unexpected shape, so no plugin may receive the token");
    }

    const infos: PluginInfo[] = [];
    const declared = new Map<string, { token: boolean; hosts: unknown[]; }>();
    for (const raw of data.plugins) {
        if (!isRecord(raw) || typeof raw.id !== "string") continue;
        const permissions = isRecord(raw.permissions) ? raw.permissions : {};
        infos.push({
            id: raw.id,
            core: raw.core === true,
            enabledByDefault: raw.enabledByDefault !== false,
            dependencies: isStringArray(raw.dependencies) ? raw.dependencies : []
        });
        declared.set(raw.id, {
            token: permissions.token === true,
            hosts: Array.isArray(permissions.network) ? permissions.network.map(entry => (isRecord(entry) ? entry.host : undefined)) : []
        });
    }

    let enabled: ReadonlySet<string>;
    try {
        const set = computeEnabledSet({
            plugins: infos,
            startOrder: data.startOrder,
            choices: input.choices,
            bootState: { safeMode: input.safeMode, quarantine: input.quarantine.map(id => ({ id, reason: "", at: 0 })) },
            engineApis: ENGINE_APIS
        });
        enabled = new Set(set.enabled);
    } catch {
        return NONE("the plugins that run could not be worked out, so no plugin may receive the token");
    }

    const patterns: string[] = [];
    const problems: string[] = [];
    for (const [id, entry] of declared) {
        if (!entry.token || !enabled.has(id)) continue;
        for (const host of entry.hosts) {
            const pattern = normalizePattern(host);
            if (pattern === null) problems.push(`the plugin ${id.slice(0, 64)} declares a host that is not a plain host name and gets no token there`);
            else if (!patterns.includes(pattern)) patterns.push(pattern);
        }
    }
    return { patterns, problems };
}
