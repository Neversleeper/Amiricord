/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry of the main-process bundle. The stub the installer puts in Discord's folder loads this file before Discord's
// own main code. If anything here fails, Discord must still start. Each start leaves lines in `boot-trace.log` (src/main/trace.ts).

import { dirname, join } from "node:path";

import { PROJECT_NAME } from "../shared/project";
import { startMain } from "./electronGlue";
import { trace } from "./trace";

// This file lives in <data folder>\dist (one data folder per Discord: %APPDATA%\Amiricord\<branch>), so the data folder is its parent. It does not depend on any environment variable.
const dataDir = dirname(__dirname);

trace(dataDir, `main part running (process type ${process.type ?? "unknown"}, electron ${process.versions.electron ?? "unknown"}, APPDATA ${process.env.APPDATA ? "set" : "MISSING"})`);
try {
    const controller = startMain({
        dataDir,
        preloadPath: join(__dirname, "preload.js"),
        rendererPath: join(__dirname, "renderer.js")
    });
    trace(dataDir, controller ? "main part started" : "main part did NOT start (there is no place for its data)");
} catch (error) {
    console.error(`[${PROJECT_NAME}] main process part could not start:`, error);
    trace(dataDir, `main part FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
}
