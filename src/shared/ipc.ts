/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the page and the main process say to each other. Kept small on purpose: the page runs Discord's code and
// every plugin, so the main process only offers what the engine itself needs, checks what it receives, and answers
// only to pages that really are Discord's.

import { HealthEvent, SELF_TEST_VERDICTS } from "./health";
import { PROJECT_NAME } from "./project";
import type { SettingsData } from "./settings";

const prefix = PROJECT_NAME.toLowerCase();

export const IPC = {
    /** Synchronous: the boot decision must exist before the first patch is compiled. */
    bootInfo: `${prefix}:boot-info`,
    health: `${prefix}:health`,
    cleanBoot: `${prefix}:clean-boot`,
    report: `${prefix}:report`,
    /** Synchronous: the page script, read by the main process because a sandboxed preload cannot read files. */
    rendererCode: `${prefix}:renderer-code`,
    /** Development only: the page hands a text to write into the probe folder. Ignored unless dev mode is on. */
    devDump: `${prefix}:dev-dump`,
    /** The page asks to change one setting. The main process checks it, keeps it and writes the file. */
    settingsChange: `${prefix}:settings-change`,
    /** The page asks to restart Discord (the Settings page, after the user clicked). Only the page script's bridge can send it. */
    restart: `${prefix}:restart`,
    /** The page asks to open the data folder in the file explorer. The folder is the main process's own; the page cannot name another. */
    openDataFolder: `${prefix}:open-data-folder`,
    /** The page asks how many requests the network firewall cancelled. Read only; the answer is counts and nothing else. */
    firewall: `${prefix}:firewall`,
    /** A plugin's page code asks for one of its own main-process functions. The main process checks the sender, the plugin, the function and the arguments (`src/main/nativeHost.ts`). */
    native: `${prefix}:native`,
    /** A plugin's page code writes, clears or asks about one of its own secrets. A secret is never sent back to the page (`src/main/secretStore.ts`). */
    secret: `${prefix}:secret`,
    /** The Privacy & Security tab asks for one read-only snapshot (counters, encrypted DNS state, host rules, provider list). */
    privacy: `${prefix}:privacy`,
    /** The tab asks to test one provider of our table by its id. Only asks the provider a question; applies nothing. */
    privacyTest: `${prefix}:privacy-test`,
    /** The tab asks for one change (a telemetry switch or the encrypted DNS choice). The main process checks it, asks the person when it weakens protection, and answers with a sentence. */
    privacyChange: `${prefix}:privacy-change`,
    /** The tab asks for the list of recent blocks (read only; grouped, no query values). */
    privacyLog: `${prefix}:privacy-log`,
    /** The Updates tab asks to check for a newer version or to install it. The page names no address and no file; the main process works them out (`src/main/updater.ts`). */
    updates: `${prefix}:updates`
} as const;

/** The file whose presence in the data folder turns dev mode on. The owner creates and deletes it. */
export const DEV_FLAG_FILE = "dev.flag";

/** Folder (inside the data folder) where dev dumps are written. */
export const DEV_DUMP_FOLDER = "probe";

export const DEV_DUMP_MAX_BYTES = 1024 * 1024;

/** What the page learns about this boot. Contains no paths and no user data. */
export interface BootInfo {
    safeMode: boolean;
    safeModeReason: string | null;
    /** Plugin ids that must not start and whose patches must not be registered. */
    quarantine: string[];
    /** This boot turned safe mode on by itself because of repeated failed boots. */
    enteredSafeMode: boolean;
    /** Things found wrong while reading the saved files. */
    problems: string[];
    /** Development tools are on: the dev flag file exists. Never true for anyone who did not create the file. */
    devMode: boolean;
    /** What the owner saved: plugin choices and plugin settings. A copy; changes go back through `settingsChange`. */
    settings: SettingsData;
}

/** Only Discord's own pages may talk to the main process. A look-alike host such as `evildiscord.com` is not accepted. */
export function isTrustedSender(url: unknown): boolean {
    if (typeof url !== "string") return false;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return parsed.protocol === "https:" && (parsed.hostname === "discord.com" || parsed.hostname.endsWith(".discord.com"));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

export interface DevDump {
    name: string;
    text: string;
}

/** A dump is a plain name (letters, digits and dashes, so it can never be a path) and a text of at most 1 MB. Anything else gives null. */
export function parseDevDump(value: unknown): DevDump | null {
    if (!isRecord(value) || !isString(value.name) || !isString(value.text)) return null;
    if (!/^[a-z0-9-]{1,40}$/.test(value.name)) return null;
    if (new TextEncoder().encode(value.text).length > DEV_DUMP_MAX_BYTES) return null;
    return { name: value.name, text: value.text };
}

const PATCH_STATUSES = ["applied", "partial", "failed", "undone", "skipped"];
const REPLACEMENT_STATUSES = ["applied", "no-effect", "errored", "undone", "not-run", "syntax-error", "not-applicable"];

function isReplacement(value: unknown): boolean {
    return isRecord(value) && isString(value.match) && REPLACEMENT_STATUSES.includes(value.status as string)
        && (value.error === undefined || isString(value.error));
}

/** Check an event that came from the page and rebuild it with only the known fields. Anything else gives null. */
export function parseHealthEvent(value: unknown): HealthEvent | null {
    if (!isRecord(value) || !isString(value.type)) return null;
    const v = value;

    switch (v.type) {
        case "patch":
            if (isString(v.plugin) && isString(v.find) && isString(v.moduleId) && typeof v.required === "boolean"
                && PATCH_STATUSES.includes(v.status as string) && Array.isArray(v.replacements) && v.replacements.every(isReplacement)) {
                return {
                    type: "patch", plugin: v.plugin, find: v.find, moduleId: v.moduleId, required: v.required,
                    status: v.status as "applied",
                    replacements: (v.replacements as Array<Record<string, unknown>>).map(r => ({
                        match: r.match as string,
                        status: r.status as "applied",
                        ...(isString(r.error) ? { error: r.error } : {})
                    }))
                };
            }
            return null;
        case "patch-no-module":
            return isString(v.plugin) && isString(v.find) && typeof v.required === "boolean"
                ? { type: v.type, plugin: v.plugin, find: v.find, required: v.required }
                : null;
        case "start-failed":
            return isString(v.plugin) && isString(v.error) ? { type: v.type, plugin: v.plugin, error: v.error } : null;
        case "started":
            return isString(v.plugin) && typeof v.ms === "number" && Number.isFinite(v.ms) ? { type: v.type, plugin: v.plugin, ms: v.ms } : null;
        case "runtime-error":
            return isString(v.plugin) && isString(v.source) && isString(v.error)
                ? { type: v.type, plugin: v.plugin, source: v.source, error: v.error }
                : null;
        case "finder-miss":
            return isString(v.plugin) && isString(v.finder) && typeof v.required === "boolean"
                ? { type: v.type, plugin: v.plugin, finder: v.finder, required: v.required }
                : null;
        case "discord-changed":
            return isString(v.plugin) && isString(v.find) && isString(v.detail)
                ? { type: v.type, plugin: v.plugin, find: v.find, detail: v.detail }
                : null;
        case "enabled":
            return isStringArray(v.plugins) ? { type: v.type, plugins: v.plugins } : null;
        case "discord-build":
            return v.build === null || (typeof v.build === "number" && Number.isFinite(v.build)) ? { type: v.type, build: v.build } : null;
        case "self-test":
            return isString(v.name) && /^[a-z][a-z-]{0,39}$/.test(v.name) && SELF_TEST_VERDICTS.includes(v.status as string)
                && isString(v.detail) && v.detail.length <= 500 && typeof v.ms === "number" && Number.isFinite(v.ms)
                ? { type: v.type, name: v.name, status: v.status as "pass", detail: v.detail, ms: v.ms }
                : null;
        default:
            return null;
    }
}
