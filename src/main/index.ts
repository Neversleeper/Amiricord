/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry of the main-process bundle. The stub the installer puts in Discord's folder loads this file before Discord's
// own main code. If anything here fails, Discord must still start. Each start leaves lines in `boot-trace.log` (src/main/trace.ts).

import { basename, dirname, join } from "node:path";

import { PROJECT_NAME } from "../shared/project";
import { enableDiscordDevTools } from "./discordDevTools";
import { startMain } from "./electronGlue";
import { trace } from "./trace";

// This file lives in <data folder>\dist (one data folder per Discord: %APPDATA%\Amiricord\<branch>), so the data folder is its parent. It does not depend on any environment variable.
const dataDir = dirname(__dirname);

trace(dataDir, `main part running (process type ${process.type ?? "unknown"}, electron ${process.versions.electron ?? "unknown"}, APPDATA ${process.env.APPDATA ? "set" : "MISSING"})`);
// Developer tools are on by default (docs/decisions.md). Done here, before Discord's own code reads its settings, so that people who only use the Updates tab get them too.
// Best effort: it can never stop Discord from starting.
const DISCORD_FOLDERS: Record<string, string> = { stable: "discord", canary: "discordcanary", ptb: "discordptb" };
try {
    // From APPDATA, not from the data folder's own path: that folder may be a link to another drive, and its real path is then somewhere else.
    const folder = DISCORD_FOLDERS[basename(dataDir)];
    if (folder && process.env.APPDATA) {
        const devtools = enableDiscordDevTools(join(process.env.APPDATA, folder));
        for (const line of [...devtools.changed, ...devtools.problems]) trace(dataDir, `developer tools: ${line}`);
    }
} catch (error) {
    trace(dataDir, `developer tools: FAILED ${error instanceof Error ? error.message : String(error)}`);
}

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
