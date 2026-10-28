/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// The short messages of the steps (creating, uploading, sent, failed) and the timer that says "timed out" when a step never ends. The messages and the timer are
// handed in, so it is tested without a page.

export const FAILURE_TIMEOUT_MS = 60_000;

export interface StatusDeps {
    toast(message: string, kind?: "info" | "success" | "failure"): void;
    setTimer(run: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}

export function createStatus(deps: StatusDeps) {
    let timer: unknown;
    const clear = () => {
        if (timer === undefined) return;
        deps.clearTimer(timer);
        timer = undefined;
    };
    const schedule = () => {
        clear();
        timer = deps.setTimer(() => {
            timer = undefined;
            deps.toast("GIF processing timed out.", "failure");
        }, FAILURE_TIMEOUT_MS);
    };
    return {
        creating() { deps.toast("Creating GIF..."); schedule(); },
        uploading() { deps.toast("Uploading GIF..."); schedule(); },
        sent() { clear(); deps.toast("GIF sent.", "success"); },
        error(message?: string) { clear(); deps.toast(message || "Failed to create GIF.", "failure"); },
        clear
    };
}

export type Status = ReturnType<typeof createStatus>;
