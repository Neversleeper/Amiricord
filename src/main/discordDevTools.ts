/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Developer tools on by default (decided by both owners, docs/decisions.md). Two small things in Discord's own data folder (`%APPDATA%\discord`, `discordcanary` or
// `discordptb`):
//  1. `settings.json`: Discord keeps its developer tools shut unless this flag is true.
//  2. `Preferences`: the developer tools remember in `electron.devtools.preferences` that the console's paste warning ("allow pasting") was accepted.
// Discord and Chromium write these files again when they exit, so the change is made while Discord is closed or has not read them yet: by the installer (`pnpm inject`,
// `repair`) and by the engine at every start of Discord (`src/main/index.ts`, before Discord's own code runs), which is what gives it to people who only use the
// Updates tab. It writes nothing when both are already as wanted. Synchronous, because at the start Discord must not read the file before it is written.
// Best effort: a folder or a file that is not there, or a file that cannot be read as JSON, is left alone and said in `problems`. Nothing is created.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEVTOOLS_FLAG = "DANGEROUS_ENABLE_DEVTOOLS_ONLY_ENABLE_IF_YOU_KNOW_WHAT_YOURE_DOING";
export const PASTE_WARNING_KEY = "disable-self-xss-warning";

export interface DevToolsResult {
    /** What was changed, in a few words each. */
    changed: string[];
    /** What could not be done and why (never an error for the caller). */
    problems: string[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Write next to the file and rename over it, so a cut-short write never leaves half a file. */
function writeJson(path: string, value: Json): void {
    const temporary = `${path}.amiricord-new`;
    writeFileSync(temporary, JSON.stringify(value), "utf8");
    renameSync(temporary, path);
}

function readJson(path: string): Json {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(parsed)) throw new Error("it is not a JSON object");
    return parsed;
}

/** `discordFolder` is Discord's own data folder for one branch. */
export function enableDiscordDevTools(discordFolder: string): DevToolsResult {
    const result: DevToolsResult = { changed: [], problems: [] };
    if (!existsSync(discordFolder)) {
        result.problems.push(`Discord's data folder ${discordFolder} was not found, so its developer tools were not switched on`);
        return result;
    }

    const settingsPath = join(discordFolder, "settings.json");
    if (existsSync(settingsPath)) {
        try {
            const settings = readJson(settingsPath);
            if (settings[DEVTOOLS_FLAG] !== true) {
                writeJson(settingsPath, { ...settings, [DEVTOOLS_FLAG]: true });
                result.changed.push("Discord's developer tools were switched on (settings.json)");
            }
        } catch (error) {
            result.problems.push(`settings.json could not be changed (${error instanceof Error ? error.message : String(error)})`);
        }
    } else {
        result.problems.push("settings.json was not found, so Discord's developer tools were not switched on");
    }

    const preferencesPath = join(discordFolder, "Preferences");
    if (existsSync(preferencesPath)) {
        try {
            const preferences = readJson(preferencesPath);
            const electron: Json = isObject(preferences.electron) ? preferences.electron : {};
            const devtools: Json = isObject(electron.devtools) ? electron.devtools : {};
            const saved: Json = isObject(devtools.preferences) ? devtools.preferences : {};
            if (saved[PASTE_WARNING_KEY] !== "true") {
                writeJson(preferencesPath, {
                    ...preferences,
                    electron: { ...electron, devtools: { ...devtools, preferences: { ...saved, [PASTE_WARNING_KEY]: "true" } } }
                });
                result.changed.push("the console's paste warning was switched off (Preferences)");
            }
        } catch (error) {
            result.problems.push(`Preferences could not be changed (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    return result;
}
