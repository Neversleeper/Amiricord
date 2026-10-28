/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Usage: pnpm check:plugins [path-to-src-folder]
// Validates every plugin.json in src/plugins, src/vencordplugins, src/equicordplugins, src/testcordplugins and src/betterdiscordplugins.
// Exit code 1 when anything is wrong.

import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENGINE_APIS } from "../../src/shared/manifest";
import { checkPlugins, formatReport } from "./manifest/checkPlugins";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = resolve(process.argv[2] ?? resolve(projectRoot, "src"));

const result = checkPlugins(root, { engineApis: ENGINE_APIS });
console.log(formatReport(result, relative(process.cwd(), root) || "."));
process.exitCode = result.ok ? 0 : 1;
