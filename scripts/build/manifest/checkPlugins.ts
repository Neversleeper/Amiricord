/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Manifest, ORIGIN_FOLDERS, ORIGINS, RiskResult } from "../../../src/shared/manifest";
import { pluginUsesPatches, pluginUsesSettings, scanPlugin } from "./scanPlugin";
import { validateManifest } from "./validate";

export interface PluginReport {
    /** Folder name of the plugin, which is also the expected id. */
    folder: string;
    /** `<origin>/<folder>`, for messages. */
    label: string;
    ok: boolean;
    manifest?: Manifest;
    risk?: RiskResult;
    /** Whether the plugin's page-side code has patches. Set once the plugin is valid. */
    hasPatches?: boolean;
    /** Whether the plugin's page-side code declares settings (`definePluginSettings`). Set once the plugin is valid. */
    hasSettings?: boolean;
    errors: string[];
    warnings: string[];
}

export interface CheckResult {
    plugins: PluginReport[];
    /** Problems that belong to the tree and not to one plugin (unknown folders, duplicates, cycles). */
    problems: string[];
    ok: boolean;
}

export interface CheckOptions {
    /** Names of engine APIs that a plugin may list in `dependencies` besides other plugins. */
    engineApis?: readonly string[];
    /** Compare each plugin's source code with its declared permissions. On by default. */
    scan?: boolean;
}

function isDirectory(path: string) {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

function subdirectories(path: string): string[] {
    return readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

function readManifestFile(file: string): { raw: unknown; } | { error: string; } {
    try {
        // A byte order mark would make JSON.parse fail with a confusing message.
        const text = readFileSync(file, "utf8").replace(/^﻿/, "");
        return { raw: JSON.parse(text) };
    } catch (err) {
        return { error: `plugin.json could not be read as JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/** Find one dependency cycle among the valid plugins, as a list of ids, or null. */
function findCycle(graph: Map<string, string[]>): string[] | null {
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];

    const visit = (id: string): string[] | null => {
        if (state.get(id) === "done") return null;
        if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
        state.set(id, "visiting");
        stack.push(id);
        for (const dep of graph.get(id) ?? []) {
            if (!graph.has(dep)) continue;
            const cycle = visit(dep);
            if (cycle) return cycle;
        }
        stack.pop();
        state.set(id, "done");
        return null;
    };

    for (const id of graph.keys()) {
        const cycle = visit(id);
        if (cycle) return cycle;
    }
    return null;
}

/**
 * Validate every `plugin.json` under `<src>/<origin folder>/<Plugin>/` (see ORIGIN_FOLDERS).
 * Reports problems per plugin and for the tree as a whole. Reads files only.
 */
export function checkPlugins(srcRoot: string, options: CheckOptions = {}): CheckResult {
    const plugins: PluginReport[] = [];
    const problems: string[] = [];

    if (!isDirectory(srcRoot)) {
        return { plugins, problems: [`source folder not found: ${srcRoot}`], ok: false };
    }

    // A folder that looks like a plugins folder but is not one of ours would be skipped silently, so say so.
    const knownFolders = new Set<string>(Object.values(ORIGIN_FOLDERS));
    for (const name of subdirectories(srcRoot)) {
        if (/plugins$/i.test(name) && !knownFolders.has(name)) {
            problems.push(`unknown plugins folder "${name}" (known: ${[...knownFolders].join(", ")})`);
        }
    }

    for (const origin of ORIGINS) {
        const originFolder = ORIGIN_FOLDERS[origin];
        const originDir = join(srcRoot, originFolder);
        if (!isDirectory(originDir)) continue;

        for (const folder of subdirectories(originDir)) {
            const dir = join(originDir, folder);
            const report: PluginReport = { folder, label: `${originFolder}/${folder}`, ok: false, errors: [], warnings: [] };
            plugins.push(report);

            const file = join(dir, "plugin.json");
            if (!existsSync(file)) {
                report.errors.push("plugin.json is missing");
                continue;
            }

            const read = readManifestFile(file);
            if ("error" in read) {
                report.errors.push(read.error);
                continue;
            }

            const result = validateManifest(read.raw, { folderName: folder, expectedOrigin: origin });
            if (!result.ok) {
                report.errors.push(...result.errors);
                continue;
            }

            report.manifest = result.manifest;
            report.risk = result.risk;
            const { entry } = result.manifest;
            for (const [kind, rel] of [["renderer", entry.renderer], ["main", entry.main]] as const) {
                if (rel && !existsSync(join(dir, rel))) report.errors.push(`entry.${kind}: file not found: ${rel}`);
            }

            if (report.errors.length === 0) {
                report.hasPatches = pluginUsesPatches(dir, result.manifest);
                report.hasSettings = pluginUsesSettings(dir, result.manifest);
                if (report.hasPatches && result.manifest.requiresRestart === false) {
                    report.errors.push("requiresRestart is false, but the code has patches, which are applied only when Discord loads its modules (use \"auto\" or true)");
                }
                if (entry.main !== undefined && result.manifest.requiresRestart === false) {
                    report.errors.push("requiresRestart is false, but the plugin has main-process code (entry.main), which the main process loads only when Discord starts (use \"auto\" or true)");
                }
            }

            if (options.scan !== false && report.errors.length === 0) {
                for (const f of scanPlugin(dir, result.manifest)) {
                    const text = `${f.file}:${f.line} ${f.rule}: ${f.message}`;
                    (f.severity === "error" ? report.errors : report.warnings).push(text);
                }
            }
        }
    }

    // Ids must be unique across origins. The folder name is the id, so compare folder names.
    const byFolder = new Map<string, string[]>();
    for (const p of plugins) byFolder.set(p.folder, [...(byFolder.get(p.folder) ?? []), p.label]);
    for (const [folder, labels] of byFolder) {
        if (labels.length > 1) problems.push(`plugin id "${folder}" is used more than once: ${labels.join(", ")}`);
    }

    // Dependencies must point at another plugin or at a known engine API.
    const known = new Set<string>([...plugins.map(p => p.folder), ...(options.engineApis ?? [])]);
    const graph = new Map<string, string[]>();
    for (const p of plugins) {
        if (!p.manifest) continue;
        graph.set(p.manifest.id, p.manifest.dependencies);
        for (const dep of p.manifest.dependencies) {
            if (!known.has(dep)) p.errors.push(`dependencies: "${dep}" is not a plugin in this tree or a known engine API`);
        }
        const replacement = p.manifest.replacedBy;
        if (replacement && !known.has(replacement)) {
            p.warnings.push(`replacedBy: "${replacement}" is not in this tree yet`);
        }
    }

    const cycle = findCycle(graph);
    if (cycle) problems.push(`dependency cycle: ${cycle.join(" -> ")}`);

    for (const p of plugins) p.ok = p.errors.length === 0;
    return { plugins, problems, ok: problems.length === 0 && plugins.every(p => p.ok) };
}

/** Plain text report for the terminal. */
export function formatReport(result: CheckResult, rootLabel: string): string {
    const lines: string[] = [`Checking plugins in ${rootLabel}`];
    const width = Math.max(0, ...result.plugins.map(p => p.label.length));

    for (const p of result.plugins) {
        const level = p.risk ? p.risk.level : "-";
        lines.push(`  ${p.label.padEnd(width)}  ${level.padEnd(6)}  ${p.ok ? "OK" : "FAILED"}`);
        for (const e of p.errors) lines.push(`      error: ${e}`);
        for (const w of p.warnings) lines.push(`      warning: ${w}`);
    }
    for (const problem of result.problems) lines.push(`  problem: ${problem}`);

    const failed = result.plugins.filter(p => !p.ok).length;
    const warnings = result.plugins.reduce((n, p) => n + p.warnings.length, 0);
    lines.push(
        `Summary: ${result.plugins.length} plugin(s), ${result.plugins.length - failed} ok, ${failed} failed, `
        + `${result.problems.length} tree problem(s), ${warnings} warning(s)`
    );
    return lines.join("\n");
}
