/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text of the two modules the build generates for the page script: the plugin code index and the registry data.
// Pure, so the output can be tested without running esbuild.

import { join } from "node:path";

import type { RegistryView } from "../../src/renderer/engine";
import type { Registry } from "./manifest/registry";

export interface PluginEntryFile {
    id: string;
    /** Absolute path of the plugin's renderer entry file. */
    file: string;
}

/**
 * The `pluginModules` table. Each plugin is a `require` inside its own function, not an `import` at the top: the bundler then runs the
 * plugin file (and everything only it uses) the first time the function is called, so a plugin that is switched off never runs any of its
 * code. The path is JSON-encoded, so odd characters cannot break out of the string. Design: docs/analysis-36-off-plugins-cost.md.
 */
export function pluginModulesSource(entries: readonly PluginEntryFile[]): string {
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rows = sorted.map(entry => `    ${JSON.stringify(entry.id)}: () => (require(${JSON.stringify(entry.file.replaceAll("\\", "/"))}) as { default: PluginCode; }).default`);
    return [
        "import type { PluginCode } from \"./engine\";",
        "declare const require: (path: string) => unknown;",
        "",
        `export const pluginModules: Readonly<Record<string, () => PluginCode>> = {${rows.length ? "\n" + rows.join(",\n") + "\n" : ""}};`,
        ""
    ].join("\n");
}

/**
 * The `nativeModules` table of the main process: the native file of each plugin that has one, as a `require` inside its own function, for the
 * same reason as above (a plugin that is off never runs its native code). Which functions and hosts a plugin may use is NOT written here: the main
 * process reads that from the registry. Design: docs/analysis-29-plugin-native-bridge.md.
 */
export function nativeModulesSource(entries: readonly PluginEntryFile[]): string {
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rows = sorted.map(entry => `    ${JSON.stringify(entry.id)}: () => require(${JSON.stringify(entry.file.replaceAll("\\", "/"))}) as Record<string, unknown>`);
    return [
        "declare const require: (path: string) => unknown;",
        "",
        `export const nativeModules: Readonly<Record<string, () => Record<string, unknown>>> = {${rows.length ? "\n" + rows.join(",\n") + "\n" : ""}};`,
        ""
    ].join("\n");
}

/**
 * What the page gets about each plugin: what it needs to decide which plugins run, and what the Plugins page shows (the cards:
 * description, authors, credits, declared permissions, whether it has patches). Never the secret setting names, the path on this
 * machine, the permissions hash or the entry files.
 */
export function registryView(registry: Registry): RegistryView {
    return {
        plugins: registry.plugins.map(p => ({
            id: p.id,
            core: p.core,
            enabledByDefault: p.enabledByDefault,
            dependencies: p.dependencies,
            startAt: p.startAt,
            deferrable: p.deferrable,
            name: p.name,
            version: p.version,
            description: p.description,
            origin: p.origin,
            license: p.license,
            authors: p.authors,
            credits: p.credits,
            tags: p.tags,
            experimental: p.experimental,
            legacy: p.legacy,
            replacedBy: p.replacedBy,
            requiresRestart: p.requiresRestart,
            hasPatches: p.hasPatches,
            hasSettings: p.hasSettings,
            hasNative: p.hasNative,
            discord: p.discord,
            permissions: p.permissions,
            riskySettings: p.riskySettings
        })),
        startOrder: registry.startOrder
    };
}

export function registryModuleSource(registry: Registry): string {
    return [
        "import type { RegistryView } from \"./engine\";",
        "",
        `export const registryData: RegistryView = ${JSON.stringify(registryView(registry), null, 4)};`,
        ""
    ].join("\n");
}

/** Everything the page script build needs from the registry. */
export function generatedModules(registry: Registry, srcRoot: string) {
    const entries = registry.plugins.map(p => ({ id: p.id, file: join(srcRoot, p.path, p.entry.renderer) }));
    const natives = registry.plugins.filter(p => p.entry.main).map(p => ({ id: p.id, file: join(srcRoot, p.path, p.entry.main as string) }));
    return {
        sources: { pluginModules: pluginModulesSource(entries), registryData: registryModuleSource(registry), nativeModules: nativeModulesSource(natives) },
        /** The plugins whose main-process code is bundled into `main.js`. */
        mainEntriesBundled: natives.map(n => n.id)
    };
}
