/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns the validated plugin manifests into the registry file the engine reads at start.
// The engine uses it for the CSP, the firewall allow-list and the native channels without running any plugin.
// The output is deterministic (sorted, no dates, no machine paths) so the same sources give the same file.

import { createHash } from "node:crypto";

import { canonicalPermissions, Manifest, RiskResult } from "../../../src/shared/manifest";
import { CheckResult } from "./checkPlugins";

export interface RegistryEntry extends Omit<Manifest, "schema"> {
    /** Folder of the plugin relative to `src`, for example `plugins/PinterestTool`. */
    path: string;
    /** Whether the plugin has patches, which decides whether turning it on or off needs a restart (see `needsRestartToToggle`). */
    hasPatches: boolean;
    /** Whether the plugin declares settings, so its card can show a gear without loading its code. */
    hasSettings: boolean;
    /** Whether the plugin has main-process code, which the main process loads only at start, so switching it needs a restart. */
    hasNative: boolean;
    /** SHA-256 of the canonical permissions. A different value after an update means the permissions changed. */
    permissionsHash: string;
    risk: RiskResult;
}

export interface Registry {
    schema: 1;
    plugins: RegistryEntry[];
    /** Plugin ids ordered so that every plugin comes after the plugins it depends on. */
    startOrder: string[];
}

const byId = (a: { id: string; }, b: { id: string; }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Order plugins so dependencies start first. Ties are broken by id so the order is stable.
 * Dependencies that are not plugins (engine APIs) are ignored here. Cycles are rejected earlier by the checker.
 */
export function computeStartOrder(plugins: ReadonlyArray<{ id: string; dependencies: string[]; }>): string[] {
    const ids = new Set(plugins.map(p => p.id));
    const waiting = new Map(plugins.map(p => [p.id, new Set(p.dependencies.filter(d => ids.has(d)))]));
    const order: string[] = [];

    while (waiting.size) {
        const ready = [...waiting].filter(([, deps]) => deps.size === 0).map(([id]) => id).sort();
        if (ready.length === 0) throw new Error(`dependency cycle among: ${[...waiting.keys()].sort().join(", ")}`);
        const next = ready[0];
        order.push(next);
        waiting.delete(next);
        for (const deps of waiting.values()) deps.delete(next);
    }
    return order;
}

/** Build the registry from a successful check. Throws if the check found problems. */
export function buildRegistry(result: CheckResult): Registry {
    if (!result.ok) throw new Error("cannot build the registry while plugins have errors");

    const plugins: RegistryEntry[] = [];
    for (const report of result.plugins) {
        if (!report.manifest || !report.risk) throw new Error(`plugin ${report.label} has no validated manifest`);
        const { schema: _schema, ...manifest } = report.manifest;
        plugins.push({
            ...manifest,
            path: report.label,
            hasPatches: report.hasPatches ?? false,
            hasSettings: report.hasSettings ?? false,
            hasNative: manifest.entry.main !== undefined,
            permissionsHash: createHash("sha256").update(canonicalPermissions(manifest.permissions)).digest("hex"),
            risk: report.risk
        });
    }
    plugins.sort(byId);

    return { schema: 1, plugins, startOrder: computeStartOrder(plugins) };
}

export function serializeRegistry(registry: Registry): string {
    return JSON.stringify(registry, null, 2) + "\n";
}
