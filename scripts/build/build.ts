/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Usage: pnpm build
// Checks every plugin, writes dist/registry.json, then bundles the three parts of the engine into dist:
//   main.js      main process (Node, CommonJS, Electron stays external)
//   preload.js   preload (CommonJS, only Electron is required at run time)
//   renderer.js  page script (IIFE; the preload wraps it so it can learn the bridge name)
// Nothing is installed anywhere: the installer (stage 4) is what puts dist into Discord.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, BuildOptions, Plugin } from "esbuild";

import { ENGINE_APIS } from "../../src/shared/manifest";
import { PROJECT_NAME } from "../../src/shared/project";
import { generatedModules } from "./generate";
import { JSX_BUILD_OPTIONS, JSX_IMPORT_SOURCE } from "./jsxOptions";
import { checkPlugins, formatReport } from "./manifest/checkPlugins";
import { buildRegistry, serializeRegistry } from "./manifest/registry";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export interface BuildSettings {
    srcRoot: string;
    outDir: string;
    /** Print the plugin check report. */
    verbose?: boolean;
}

export interface BuildSummary {
    ok: boolean;
    plugins: number;
    files: Array<{ file: string; bytes: number; }>;
    /** Plugins whose main-process entry is bundled into main.js (it runs only when the plugin is switched on). */
    mainEntriesBundled: string[];
}

const banner = `/* ${PROJECT_NAME}, a Discord client mod. Copyright (c) 2026 szlcx404 and Neversleeper. SPDX-License-Identifier: GPL-3.0-or-later */`;

/** Replaces the two placeholder modules of the page script with the ones generated from the registry. */
function generatedPlugin(sources: { pluginModules: string; registryData: string; }, srcRoot: string): Plugin {
    return {
        name: "generated-modules",
        setup(b) {
            b.onResolve({ filter: /^\.\/(pluginModules|registryData)$/ }, args => {
                if (!args.importer.replaceAll("\\", "/").endsWith("/src/renderer/index.ts")) return undefined;
                return { path: args.path.slice(2), namespace: "generated" };
            });
            b.onLoad({ filter: /.*/, namespace: "generated" }, args => ({
                contents: args.path === "pluginModules" ? sources.pluginModules : sources.registryData,
                loader: "ts",
                // Generated code imports `./engine` and the plugins' own files.
                resolveDir: join(srcRoot, "renderer")
            }));
        }
    };
}

/** Replaces the placeholder `nativeModules` module of the main process with the one generated from the registry. */
function generatedNativePlugin(source: string, srcRoot: string): Plugin {
    return {
        name: "generated-native-modules",
        setup(b) {
            b.onResolve({ filter: /^\.\/nativeModules$/ }, args => {
                if (!args.importer.replaceAll("\\", "/").endsWith("/src/main/electronGlue.ts")) return undefined;
                return { path: "nativeModules", namespace: "generated-native" };
            });
            b.onLoad({ filter: /.*/, namespace: "generated-native" }, () => ({ contents: source, loader: "ts", resolveDir: join(srcRoot, "main") }));
        }
    };
}

/**
 * What the page script build needs besides the usual: JSX through our runtime, and images as data URLs. The tests that bundle a plugin
 * use the same options, so a plugin is tested the way it is built.
 */
export function pageOptions(srcRoot: string): Pick<BuildOptions, "jsx" | "jsxImportSource" | "alias" | "loader"> {
    return {
        ...JSX_BUILD_OPTIONS,
        // The JSX runtime is looked up by this name; it must be the runtime of the SAME source tree as the engine (one copy, one React source).
        alias: { [`${JSX_IMPORT_SOURCE}/jsx-runtime`]: join(srcRoot, "api/jsxRuntime.ts") },
        // Images imported by plugins become data URLs inside the page script: the page loads nothing from the network for them.
        loader: { ".webp": "dataurl" }
    };
}

export async function buildAll(settings: BuildSettings): Promise<BuildSummary> {
    const { srcRoot, outDir } = settings;
    const check = checkPlugins(srcRoot, { engineApis: ENGINE_APIS });
    if (settings.verbose) console.log(formatReport(check, relative(process.cwd(), srcRoot) || "."));
    if (!check.ok) return { ok: false, plugins: 0, files: [], mainEntriesBundled: [] };

    const registry = buildRegistry(check);
    const generated = generatedModules(registry, srcRoot);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "registry.json"), serializeRegistry(registry));

    const common: BuildOptions = {
        bundle: true,
        sourcemap: false,
        legalComments: "none",
        banner: { js: banner },
        logLevel: "silent",
        absWorkingDir: projectRoot,
        // Packages a plugin imports (the GIF writer and reader of GifCaptioner) are found in the project's own folder even when the source being built is somewhere else (tests build a copy).
        nodePaths: [join(projectRoot, "node_modules")]
    };

    await Promise.all([
        build({ ...common, entryPoints: [join(srcRoot, "main/index.ts")], outfile: join(outDir, "main.js"), platform: "node", format: "cjs", target: "node20", external: ["electron"], plugins: [generatedNativePlugin(generated.sources.nativeModules, srcRoot)] }),
        build({ ...common, entryPoints: [join(srcRoot, "preload/index.ts")], outfile: join(outDir, "preload.js"), platform: "node", format: "cjs", target: "node20", external: ["electron"] }),
        build({
            ...common,
            entryPoints: [join(srcRoot, "renderer/index.ts")],
            outfile: join(outDir, "renderer.js"),
            platform: "browser",
            format: "iife",
            target: "chrome120",
            ...pageOptions(srcRoot),
            plugins: [generatedPlugin(generated.sources, srcRoot)]
        })
    ]);

    const files = ["main.js", "preload.js", "renderer.js", "registry.json"].map(file => ({ file, bytes: statSync(join(outDir, file)).size }));
    return { ok: true, plugins: registry.plugins.length, files, mainEntriesBundled: generated.mainEntriesBundled };
}

// Run as a command (not when a test imports it).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const summary = await buildAll({ srcRoot: resolve(projectRoot, "src"), outDir: resolve(projectRoot, "dist"), verbose: true });
    if (!summary.ok) {
        console.error("\nNothing was built because of the problems above.");
        process.exitCode = 1;
    } else {
        console.log(`\nBuilt ${summary.plugins} plugin(s) into dist:`);
        for (const f of summary.files) console.log(`  ${f.file.padEnd(14)} ${(f.bytes / 1024).toFixed(1)} KB`);
        if (summary.mainEntriesBundled.length) console.log(`\nMain-process entries bundled into main.js: ${summary.mainEntriesBundled.join(", ")}`);
    }
}
