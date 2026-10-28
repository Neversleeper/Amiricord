/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Usage: pnpm installer [command] [options]     (pnpm installer --help)
// Windows only for now. Reads LOCALAPPDATA and APPDATA, and the project's `dist` folder (run `pnpm build` first).

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Io, main } from "../src/installer/cli";
import { Context } from "../src/installer/commands";
import { windowsPlatform } from "../src/installer/platform";
import { colorsEnabled, makeStyle } from "../src/installer/ui/ansi";
import { createKeySource } from "../src/installer/ui/keys";
import { PROJECT_NAME } from "../src/shared/project";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const localAppData = process.env.LOCALAPPDATA;
const appData = process.env.APPDATA;

if (!localAppData || !appData) {
    console.error(`LOCALAPPDATA or APPDATA is not set, so ${PROJECT_NAME} cannot find Discord. This installer only supports Windows for now.`);
    process.exit(1);
}

const ctx: Context = {
    localAppData,
    dataDir: join(appData, PROJECT_NAME),
    distSource: resolve(projectRoot, "dist"),
    platform: windowsPlatform
};

const terminal = process.stdin.isTTY && process.stdout.isTTY;
const keys = terminal ? createKeySource(process.stdin) : null;
const io: Io = {
    out: text => { process.stdout.write(text); },
    err: text => { process.stderr.write(text); },
    style: makeStyle(colorsEnabled(process.env, !!process.stdout.isTTY)),
    keys
};

const code = await main(process.argv.slice(2), io, ctx);
keys?.close();
process.exitCode = code;
