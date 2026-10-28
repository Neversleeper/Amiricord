/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main process keeps the settings in memory and writes `settings.json` a moment after the last change, with a
// temporary file and a rename, so a crash never leaves half a file. The page sends small checked changes; it never
// writes the file and never sends the whole object back.

import { join } from "node:path";

import { applyChange, defaultSettings, parseSettings, parseSettingsChange, serializeSettings, SettingsData } from "../shared/settings";
import { readTextFile, writeTextAtomic } from "./atomicFile";
import type { Scheduler } from "./healthStore";

export const SETTINGS_FILE_NAME = "settings.json";

export const settingsPath = (dataDir: string) => join(dataDir, SETTINGS_FILE_NAME);

export interface SettingsStoreOptions {
    scheduler?: Scheduler;
    /** How long after the last change the file is written. Default 1000. */
    flushDelayMs?: number;
}

const defaultScheduler: Scheduler = {
    set: (work, ms) => setTimeout(work, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export class SettingsStore {
    private current: SettingsData = defaultSettings();
    private timer: unknown = null;
    private dirty = false;
    private readonly scheduler: Scheduler;
    private readonly flushDelayMs: number;

    /** The last problem reading or writing the file, for the report. */
    lastProblem: string | null = null;

    constructor(private readonly path: string, options: SettingsStoreOptions = {}) {
        this.scheduler = options.scheduler ?? defaultScheduler;
        this.flushDelayMs = options.flushDelayMs ?? 1000;
    }

    get settings(): SettingsData {
        return this.current;
    }

    /** Read the file. A missing file is the first start; a damaged one gives defaults. Returns the problems found. Never throws. */
    load(): string[] {
        const read = readTextFile(this.path);
        const problems: string[] = [];
        if (read.kind === "error") {
            problems.push(`the settings could not be read (${read.message}), using defaults`);
            this.current = defaultSettings();
        } else if (read.kind === "text") {
            const parsed = parseSettings(read.text);
            this.current = parsed.settings;
            problems.push(...parsed.problems);
        }
        this.lastProblem = problems[0] ?? null;
        return problems;
    }

    /** Check a change that came from the page and apply it. Returns why it was refused, or null when it was applied. */
    change(payload: unknown): string | null {
        const change = parseSettingsChange(payload);
        if (!change) return "the change was refused (not a valid settings change)";
        const result = applyChange(this.current, change);
        if (result.error !== null) return result.error;
        this.current = result.settings;
        this.dirty = true;
        this.scheduleFlush();
        return null;
    }

    private scheduleFlush() {
        if (this.timer !== null) this.scheduler.clear(this.timer);
        this.timer = this.scheduler.set(() => {
            this.timer = null;
            this.flushNow();
        }, this.flushDelayMs);
    }

    /** Write now if something changed. Returns the error text, or null when it worked or there was nothing to write. */
    flushNow(): string | null {
        if (this.timer !== null) {
            this.scheduler.clear(this.timer);
            this.timer = null;
        }
        if (!this.dirty) return null;
        const error = writeTextAtomic(this.path, serializeSettings(this.current));
        if (error === null) this.dirty = false;
        this.lastProblem = error === null ? null : `the settings could not be written (${error})`;
        return this.lastProblem;
    }

    /** Write once more, for when the app quits. */
    dispose(): void {
        this.flushNow();
    }
}
