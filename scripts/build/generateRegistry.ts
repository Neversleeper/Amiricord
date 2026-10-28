/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Usage: pnpm build:registry [path-to-src-folder] [output-file]
// Validates every plugin, then writes dist/registry.json. Writes nothing and exits with 1 if any plugin has errors.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENGINE_APIS } from "../../src/shared/manifest";
import { checkPlugins, formatReport } from "./manifest/checkPlugins";
import { buildRegistry, serializeRegistry } from "./manifest/registry";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const srcRoot = resolve(process.argv[2] ?? resolve(projectRoot, "src"));
const outFile = resolve(process.argv[3] ?? resolve(projectRoot, "dist", "registry.json"));

const result = checkPlugins(srcRoot, { engineApis: ENGINE_APIS });
console.log(formatReport(result, relative(process.cwd(), srcRoot) || "."));

if (!result.ok) {
    console.error("\nThe registry was not written because of the problems above.");
    process.exitCode = 1;
} else {
    const registry = buildRegistry(result);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, serializeRegistry(registry));
    console.log(`\nWrote ${relative(process.cwd(), outFile)} (${registry.plugins.length} plugin(s)).`);
}
