/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pausing protection for ten minutes (design 05, piece P7, docs/analysis-40-pause-and-reset.md): the state that says whether protection is paused, and for how long.
// It lives in the main process only, in memory: a restart of Discord ends any pause, and nothing is written to disk. The length is fixed here; nobody can ask for another.
// A pause ends by itself: by the timer, and also by the clock (`active()` looks at the time, so a timer that never fires cannot keep protection off). Pure code.

/** How long a pause lasts. */
export const PAUSE_MS = 10 * 60 * 1000;

export interface PauseDeps {
    /** Milliseconds, any steady clock. */
    now(): number;
    /** Runs `work` after `ms` and gives back a function that cancels it. */
    after(work: () => void, ms: number): () => void;
    /** Told when a pause starts (true) and when it ends (false), for the boot trace. Never allowed to disturb the state. */
    onChange?(active: boolean): void;
}

export interface Pause {
    /** Whether protection is paused right now. */
    active(): boolean;
    /** How long is left, in milliseconds, or null when not paused. */
    remainingMs(): number | null;
    /** Start a pause. False (and nothing changes) when one is already running. */
    start(): boolean;
    /** End the pause now. False when there was none. */
    stop(): boolean;
}

export function makePause(deps: PauseDeps): Pause {
    let until: number | null = null;
    let cancel: (() => void) | null = null;
    /** Changes with every pause, so the timer of an old pause can never end a newer one. */
    let generation = 0;

    const tell = (active: boolean) => {
        try {
            deps.onChange?.(active);
        } catch {
            // A broken listener must not change whether protection is on.
        }
    };

    const finish = (): boolean => {
        if (until === null) return false;
        until = null;
        const undo = cancel;
        cancel = null;
        try {
            undo?.();
        } catch {
            // Cancelling a timer that already ran is not a problem.
        }
        tell(false);
        return true;
    };

    const active = () => until !== null && deps.now() < until;

    return {
        active,
        remainingMs: () => (until === null || !active() ? null : Math.max(0, Math.round(until - deps.now()))),
        start() {
            if (active()) return false;
            // A pause whose time already passed but whose timer did not fire is ended first, so the new one starts clean.
            if (until !== null) finish();
            until = deps.now() + PAUSE_MS;
            const mine = ++generation;
            cancel = deps.after(() => { if (generation === mine) finish(); }, PAUSE_MS);
            tell(true);
            return true;
        },
        stop: finish
    };
}
