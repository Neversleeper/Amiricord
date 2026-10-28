/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main process's part of the engine, with no Electron in it so it can be tested with temporary folders.
// It owns the files in the data folder: it decides safe mode and quarantine at startup (before the page registers
// any patch), keeps the health data, and counts plugin start failures.
// Design: docs/design-02-core.md sections 3 and 8.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { beginBoot, BootState, forgetUnfinishedBoot, leaveSafeMode, quarantinedIds, recordStartFailure, reportCleanBoot } from "../shared/bootState";
import { HealthEvent, HealthReport } from "../shared/health";
import { BootInfo, DEV_DUMP_FOLDER, DEV_FLAG_FILE, parseDevDump } from "../shared/ipc";
import { PROJECT_NAME } from "../shared/project";
import { writeTextAtomic } from "./atomicFile";
import { bootStatePath, readBootStateFile, writeBootStateFile } from "./bootStateFile";
import { healthPath, HealthStore, HealthStoreOptions } from "./healthStore";
import { settingsPath, SettingsStore, SettingsStoreOptions } from "./settingsStore";

/** `%APPDATA%\Amiricord` on Windows. Returns null when the platform gives no place for it. */
export function dataDirectory(env: Record<string, string | undefined>): string | null {
    const base = env.APPDATA;
    return base ? join(base, PROJECT_NAME) : null;
}

export interface ControllerOptions {
    dataDir: string;
    now?: () => number;
    health?: HealthStoreOptions;
    settings?: SettingsStoreOptions;
}

export class MainController {
    readonly health: HealthStore;
    readonly settings: SettingsStore;
    private boot: BootState | null = null;
    private enteredSafeMode = false;
    /** True once this boot was reported clean, or its count was settled some other way, so it is not settled twice. */
    private bootSettled = false;
    private devMode = false;
    private problems: string[] = [];
    private readonly now: () => number;

    constructor(private readonly options: ControllerOptions) {
        this.now = options.now ?? Date.now;
        this.health = new HealthStore(healthPath(options.dataDir), { now: this.now, ...options.health });
        this.settings = new SettingsStore(settingsPath(options.dataDir), options.settings);
    }

    private get bootFile() {
        return bootStatePath(this.options.dataDir);
    }

    private saveBoot(): void {
        if (!this.boot) return;
        const error = writeBootStateFile(this.bootFile, this.boot);
        if (error !== null && !this.problems.includes(error)) this.problems.push(error);
    }

    /** Read the saved files and count this boot. Call once, first thing. Never throws. */
    start(build: number | null = null): BootInfo {
        const read = readBootStateFile(this.bootFile);
        const begun = beginBoot(read.state, this.now());
        this.boot = begun.state;
        this.enteredSafeMode = begun.enteredSafeMode;
        this.problems = [...read.problems, ...this.health.load(build), ...this.settings.load()];
        // Dev mode is decided once, here: creating the flag file while Discord runs changes nothing until the next start.
        this.devMode = existsSync(join(this.options.dataDir, DEV_FLAG_FILE));
        // Written now, before anything can go wrong: this is what makes the crash-loop counter work.
        this.saveBoot();
        return this.bootInfo();
    }

    bootInfo(): BootInfo {
        const boot = this.boot;
        return {
            safeMode: boot?.safeMode ?? false,
            safeModeReason: boot?.safeModeReason ?? null,
            quarantine: boot ? quarantinedIds(boot) : [],
            enteredSafeMode: this.enteredSafeMode,
            problems: [...this.problems],
            devMode: this.devMode,
            settings: this.settings.settings
        };
    }

    /** The page finished all plugin stages without a fatal error. */
    cleanBoot(): void {
        if (!this.boot) return;
        this.boot = reportCleanBoot(this.boot);
        this.bootSettled = true;
        this.saveBoot();
    }

    /** The person asked to leave safe mode. It takes effect at the next start (patches are chosen at start), so the page restarts Discord right after. */
    leaveSafeMode(): void {
        if (!this.boot) return;
        this.boot = leaveSafeMode(this.boot);
        this.bootSettled = true;
        this.saveBoot();
    }

    /** Record an event from the page. A plugin that fails to start often enough goes into quarantine. */
    recordHealth(event: HealthEvent): { quarantined: boolean; } {
        try {
            this.health.record(event);
        } catch (error) {
            // A bad event must not stop the main process.
            this.problems.push(`a health event could not be recorded (${(error as Error).message})`);
        }

        if (event.type !== "start-failed" || !this.boot) return { quarantined: false };
        const result = recordStartFailure(this.boot, event.plugin, this.now());
        this.boot = result.state;
        this.saveBoot();
        return { quarantined: result.quarantined };
    }

    /** A change of a setting from the page. Returns why it was refused, or null when it was kept. */
    changeSetting(payload: unknown): string | null {
        return this.settings.change(payload);
    }

    /** Something wrong with the setup that the owner should read in the engine status (a damaged rules file, for example). */
    addProblem(text: string): void {
        if (!this.problems.includes(text)) this.problems.push(text);
    }

    /** One saved value of a plugin's setting, or undefined when nothing was saved (the plugin's default then applies). */
    pluginValue(plugin: string, key: string): unknown {
        return this.settings.settings.plugins[plugin]?.values?.[key];
    }

    /** Whether the development flag file was there at the start. */
    isDevMode(): boolean {
        return this.devMode;
    }

    /** Development only: write a text the page sent into `probe/<name>.json`. Returns an error text, or null when it was written. */
    devDump(payload: unknown): string | null {
        if (!this.devMode) return "dev mode is off";
        const dump = parseDevDump(payload);
        if (!dump) return "the dump was refused (bad name or too large)";
        const error = writeTextAtomic(join(this.options.dataDir, DEV_DUMP_FOLDER, `${dump.name}.json`), dump.text);
        if (error !== null) this.noteDumpError(dump.name, error);
        return error;
    }

    /** A dump that could not be written leaves a line in `probe/errors.log`, so a silent dump can be understood. Best effort. */
    private noteDumpError(name: string, error: string): void {
        try {
            const folder = join(this.options.dataDir, DEV_DUMP_FOLDER);
            mkdirSync(folder, { recursive: true });
            appendFileSync(join(folder, "errors.log"), `${new Date(this.now()).toISOString()} ${name}: ${error}
`);
        } catch {
            // Nothing more can be done.
        }
    }

    report(): HealthReport {
        return this.health.report();
    }

    dispose(): void {
        // Discord is closing by itself (not a crash): a boot that was cut short this way did not fail, so it is not counted towards safe mode.
        if (this.boot && !this.bootSettled) {
            this.bootSettled = true;
            this.boot = forgetUnfinishedBoot(this.boot);
            this.saveBoot();
        }
        this.settings.dispose();
        this.health.dispose();
    }
}
