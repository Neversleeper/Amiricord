/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Decides which plugins run. Pure: it reads its input and returns a result, it never writes settings.
// Design: docs/design-02-core.md section 4.

import type { BootState } from "./bootState";

/** The part of a plugin's registry entry that this decision needs. */
export interface PluginInfo {
    id: string;
    core: boolean;
    enabledByDefault: boolean;
    dependencies: string[];
}

export interface EnabledSetInput {
    plugins: readonly PluginInfo[];
    /** Plugin ids with dependencies first (`startOrder` of the registry). */
    startOrder: readonly string[];
    /** The user's saved choices: `true` on, `false` off, missing means "follow the default". */
    choices: Readonly<Record<string, boolean | undefined>>;
    bootState: Pick<BootState, "safeMode" | "quarantine">;
    /** Names a plugin may list in `dependencies` that the engine provides itself. */
    engineApis?: readonly string[];
}

export type EnableReason = "core" | "chosen" | "default" | "dependency";

export interface WhyEnabled {
    reason: EnableReason;
    /** Enabled plugins that list this one as a dependency. */
    neededBy: string[];
    /** True when the user turned it off but another enabled plugin needs it. */
    overridesChoice: boolean;
}

export type SkipKind = "safe-mode" | "quarantined" | "missing-dependency" | "dependency-unavailable";

/** A plugin that should have run but cannot. */
export interface SkippedPlugin {
    kind: SkipKind;
    /** The plugin or name that caused it, for the two dependency kinds. */
    dependency?: string;
    /** Plain text for the plugin card and the health report. */
    message: string;
}

export interface EnabledSet {
    /** Plugins that run, in start order. */
    enabled: string[];
    why: Record<string, WhyEnabled>;
    /** Plugins that were wanted (chosen, default, or core) but cannot run, with the reason. */
    skipped: Record<string, SkippedPlugin>;
    /** Things wrong in the input, for the health report. */
    problems: string[];
}

export function computeEnabledSet(input: EnabledSetInput): EnabledSet {
    const byId = new Map(input.plugins.map(p => [p.id, p]));
    const quarantined = new Set(input.bootState.quarantine.map(q => q.id));
    const engineApis = new Set(input.engineApis ?? []);
    const problems: string[] = [];
    const skipped: Record<string, SkippedPlugin> = {};

    for (const id of Object.keys(input.choices)) {
        if (!byId.has(id)) problems.push(`a saved choice names the unknown plugin "${id}", ignored`);
    }
    for (const id of quarantined) {
        if (!byId.has(id)) problems.push(`the quarantine list names the unknown plugin "${id}"`);
    }

    // 1. Which plugins are wanted: core ones always, then the user's choice, then the default.
    const roots = new Map<string, EnableReason>();
    for (const p of input.plugins) {
        const choice = input.choices[p.id];
        let reason: EnableReason | null = null;
        if (p.core) reason = "core";
        else if (choice === true) reason = "chosen";
        else if (choice === undefined && p.enabledByDefault) reason = "default";
        if (!reason) continue;

        if (input.bootState.safeMode && !p.core) {
            skipped[p.id] = { kind: "safe-mode", message: "Safe mode is on, so only core plugins run" };
            continue;
        }
        roots.set(p.id, reason);
    }

    // 2. Whether a plugin can run: not in quarantine, and every plugin it needs can run too.
    const memo = new Map<string, SkippedPlugin | null>();
    const visiting = new Set<string>();
    const blockedBy = (id: string): SkippedPlugin | null => {
        if (memo.has(id)) return memo.get(id) ?? null;
        let result: SkippedPlugin | null = null;

        if (quarantined.has(id)) {
            result = { kind: "quarantined", message: `${id} is in quarantine` };
        } else {
            visiting.add(id);
            for (const dep of byId.get(id)?.dependencies ?? []) {
                if (engineApis.has(dep)) continue;
                if (!byId.has(dep)) {
                    result = { kind: "missing-dependency", dependency: dep, message: `needs ${dep}, which does not exist` };
                    break;
                }
                if (visiting.has(dep)) {
                    problems.push(`dependency cycle between "${id}" and "${dep}"`);
                    result = { kind: "dependency-unavailable", dependency: dep, message: `needs ${dep}, which needs it back (cycle)` };
                    break;
                }
                const reason = blockedBy(dep);
                if (reason) {
                    result = { kind: "dependency-unavailable", dependency: dep, message: `needs ${dep}, which cannot run (${reason.message})` };
                    break;
                }
            }
            visiting.delete(id);
        }

        memo.set(id, result);
        return result;
    };

    // 3. The wanted plugins that can run, plus everything they need.
    const enabledIds = new Set<string>();
    const addWithDependencies = (id: string) => {
        if (enabledIds.has(id)) return;
        enabledIds.add(id);
        for (const dep of byId.get(id)?.dependencies ?? []) {
            if (!engineApis.has(dep)) addWithDependencies(dep);
        }
    };
    for (const [id] of roots) {
        const reason = blockedBy(id);
        if (reason) {
            skipped[id] = reason;
            if (byId.get(id)?.core) problems.push(`the core plugin "${id}" cannot run: ${reason.message}`);
        } else {
            addWithDependencies(id);
        }
    }

    // 4. Why each one runs. "Needed by" counts only plugins that run.
    const why: Record<string, WhyEnabled> = {};
    for (const id of enabledIds) {
        const reason = roots.get(id) ?? "dependency";
        why[id] = {
            reason,
            neededBy: [...enabledIds].filter(other => other !== id && byId.get(other)?.dependencies.includes(id)).sort(),
            overridesChoice: reason === "dependency" && input.choices[id] === false
        };
    }

    const enabled = input.startOrder.filter(id => enabledIds.has(id));
    for (const id of [...enabledIds].sort()) {
        if (!enabled.includes(id)) {
            problems.push(`"${id}" is missing from the start order`);
            enabled.push(id);
        }
    }

    return { enabled, why, skipped, problems };
}
