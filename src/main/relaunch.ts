/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Restarting Discord on request of the Settings page. The decisions are here, without Electron, so they are tested:
// how to start Discord again, and doing it once. On Windows Discord is started through Squirrel's `Update.exe`
// (`Update.exe --processStart DiscordCanary.exe`), the same way its own shortcut and our installer do, so the newest app
// folder is used and not the one running now. Anywhere else, or without that file, Electron's own relaunch is used.

import { win32 } from "node:path";

export interface RelaunchPlan {
    execPath: string;
    args: string[];
}

export interface PlanInput {
    /** Path of the running Discord executable (`process.execPath`). */
    execPath: string;
    platform: string;
    exists(path: string): boolean;
}

/** How to start Discord again through Squirrel, or null when it is not a Squirrel install (use Electron's relaunch). */
export function planRelaunch(input: PlanInput): RelaunchPlan | null {
    if (input.platform !== "win32") return null;
    // Squirrel layout: <branch>\app-X.Y.Z\<Name>.exe next to <branch>\Update.exe.
    const update = win32.join(win32.dirname(input.execPath), "..", "Update.exe");
    if (!input.exists(update)) return null;
    return { execPath: update, args: ["--processStart", win32.basename(input.execPath)] };
}

export interface RestartDeps {
    /** Write what is still waiting (settings, health) before the process goes. */
    dispose(): void;
    /** Plan from `planRelaunch`. */
    plan: RelaunchPlan | null;
    relaunch(options?: RelaunchPlan): void;
    exit(code: number): void;
}

/** Restart once: later requests are ignored, so a second click cannot start two copies. */
export function makeRestart(deps: RestartDeps): () => boolean {
    let started = false;
    return () => {
        if (started) return false;
        started = true;
        try {
            deps.dispose();
        } catch {
            // Restarting matters more than a last write.
        }
        if (deps.plan) deps.relaunch(deps.plan);
        else deps.relaunch();
        deps.exit(0);
        return true;
    };
}
