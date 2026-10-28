/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main process keeps the health data in memory and writes it to health.json shortly after the last change.
// The page sends events over the bridge; this store records them. Nothing is sent anywhere.

import { join } from "node:path";

import { buildReport, defaultHealthState, HealthEvent, HealthReport, HealthState, parseHealthState, recordEvent, serializeHealthState, startSession } from "../shared/health";
import { readTextFile, writeTextAtomic } from "./atomicFile";

export const HEALTH_FILE_NAME = "health.json";

export const healthPath = (dataDir: string) => join(dataDir, HEALTH_FILE_NAME);

export interface Scheduler {
    set(work: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

export interface HealthStoreOptions {
    now?: () => number;
    newSessionId?: () => string;
    scheduler?: Scheduler;
    /** How long after the last change the file is written. Default 5000. */
    flushDelayMs?: number;
}

const defaultScheduler: Scheduler = {
    set: (work, ms) => setTimeout(work, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export class HealthStore {
    private current: HealthState;
    private timer: unknown = null;
    private readonly now: () => number;
    private readonly newSessionId: () => string;
    private readonly scheduler: Scheduler;
    private readonly flushDelayMs: number;

    /** The last problem reading or writing the file, for the report. */
    lastProblem: string | null = null;

    constructor(private readonly path: string, options: HealthStoreOptions = {}) {
        this.now = options.now ?? Date.now;
        this.newSessionId = options.newSessionId ?? (() => `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        this.scheduler = options.scheduler ?? defaultScheduler;
        this.flushDelayMs = options.flushDelayMs ?? 5000;
        this.current = defaultHealthState(this.newSessionId(), this.now());
    }

    get state(): HealthState {
        return this.current;
    }

    /** Read the file and begin a new session. Returns the problems found, which also go to `lastProblem`. Never throws. */
    load(build: number | null = null): string[] {
        const problems: string[] = [];
        const read = readTextFile(this.path);
        // The id of a session that could not be read is never stored: an empty session is not kept in the history.
        const unreadable = "unreadable";
        let base = defaultHealthState(unreadable, this.now());

        if (read.kind === "error") {
            problems.push(`health data could not be read (${read.message}), starting empty`);
        } else if (read.kind === "text") {
            const parsed = parseHealthState(read.text, unreadable, this.now());
            base = parsed.state;
            problems.push(...parsed.problems);
        }

        this.current = startSession(base, this.newSessionId(), this.now(), build);
        this.lastProblem = problems[0] ?? null;
        this.scheduleFlush();
        return problems;
    }

    record(event: HealthEvent): void {
        this.current = recordEvent(this.current, event, this.now());
        this.scheduleFlush();
    }

    report(): HealthReport {
        return buildReport(this.current);
    }

    private scheduleFlush() {
        if (this.timer !== null) this.scheduler.clear(this.timer);
        this.timer = this.scheduler.set(() => {
            this.timer = null;
            this.flushNow();
        }, this.flushDelayMs);
    }

    /** Write now. Returns the error text, or null when it worked. */
    flushNow(): string | null {
        if (this.timer !== null) {
            this.scheduler.clear(this.timer);
            this.timer = null;
        }
        const error = writeTextAtomic(this.path, serializeHealthState(this.current));
        this.lastProblem = error === null ? null : `health data could not be written (${error})`;
        return this.lastProblem;
    }

    /** Write once more and stop the timer, for when the app quits. */
    dispose(): void {
        this.flushNow();
    }
}
