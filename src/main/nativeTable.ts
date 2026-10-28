/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which plugins have main-process code that may run in this boot: the ENABLED plugins that declare native functions. Worked out here, in the main process,
// from the registry the build wrote and the owner's saved choices, never from anything the page says. A plugin with native code needs a restart to be switched
// on or off, so the table is made once at start. Pure code. Design: docs/analysis-29-plugin-native-bridge.md.

import { computeEnabledSet, PluginInfo } from "../shared/enabledSet";
import { ENGINE_APIS } from "../shared/manifest";
import type { NativePlugin } from "./nativeHost";
import { normalizePattern } from "./tokenHosts";

export interface NativeTableInput {
    /** The text of `dist/registry.json`. */
    registryText: string;
    safeMode: boolean;
    quarantine: readonly string[];
    /** The saved choices: plugin id to on or off. */
    choices: Readonly<Record<string, boolean | undefined>>;
    /** The native code the build put into the bundle, by plugin id. */
    modules: Readonly<Record<string, (() => Record<string, unknown>) | undefined>>;
}

export interface NativeTable {
    plugins: Record<string, NativePlugin>;
    /** Plain sentences for the engine's list of problems. */
    problems: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** The native table. A registry that cannot be read means NO plugin has native code. Never throws. */
export function nativeTableFromRegistry(input: NativeTableInput): NativeTable {
    const none = (problem: string): NativeTable => ({ plugins: {}, problems: [problem] });
    let data: unknown;
    try {
        data = JSON.parse(input.registryText);
    } catch {
        return none("the plugin registry could not be read, so no plugin has native code");
    }
    if (!isRecord(data) || !Array.isArray(data.plugins) || !isStringArray(data.startOrder)) return none("the plugin registry has an unexpected shape, so no plugin has native code");

    const infos: PluginInfo[] = [];
    const raws = new Map<string, Record<string, unknown>>();
    for (const raw of data.plugins) {
        if (!isRecord(raw) || typeof raw.id !== "string") continue;
        infos.push({ id: raw.id, core: raw.core === true, enabledByDefault: raw.enabledByDefault !== false, dependencies: isStringArray(raw.dependencies) ? raw.dependencies : [] });
        raws.set(raw.id, raw);
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
        return none("the plugins that run could not be worked out, so no plugin has native code");
    }

    const plugins: Record<string, NativePlugin> = {};
    const problems: string[] = [];
    for (const [id, raw] of raws) {
        if (!enabled.has(id)) continue;
        const permissions = isRecord(raw.permissions) ? raw.permissions : {};
        const native = isRecord(permissions.native) ? permissions.native : {};
        const system = isRecord(permissions.system) ? permissions.system : {};
        const functions = isStringArray(native.functions) ? native.functions : [];
        if (functions.length === 0) continue;
        const load = Object.prototype.hasOwnProperty.call(input.modules, id) ? input.modules[id] : undefined;
        if (!load) {
            problems.push(`the plugin ${id.slice(0, 64)} declares native functions but this build has no native code for it`);
            continue;
        }
        const hosts: string[] = [];
        for (const entry of Array.isArray(permissions.network) ? permissions.network : []) {
            if (!isRecord(entry) || entry.from !== "main") continue;
            const pattern = normalizePattern(entry.host);
            if (pattern === null) problems.push(`the plugin ${id.slice(0, 64)} declares a host that is not a plain host name and gets no network there`);
            else if (!hosts.includes(pattern)) hosts.push(pattern);
        }
        plugins[id] = { functions, hosts, secrets: isStringArray(raw.secrets) ? raw.secrets : [], load, ...(system.devtools === true ? { devtools: true } : {}) };
    }
    return { plugins, problems };
}
