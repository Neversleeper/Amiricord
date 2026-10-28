/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Updates tab is doing, as plain data: which step it is in, what the check found, and the sentence to show. The screen only draws this and calls
// `check` and `install`. The network is the main process's (`src/main/updater.ts`); this side only asks and shows what came back.

import type { NewsEntry, UpdateAnswer } from "../../shared/updates";

export type UpdatesPhase = "idle" | "checking" | "up-to-date" | "available" | "installing" | "installed" | "error";

export interface UpdatesState {
    phase: UpdatesPhase;
    /** The version that is running. */
    current: string;
    /** The newest version found, once a check ended. */
    latest: string;
    /** What changed in the versions between this one and the newest. */
    news: NewsEntry[];
    message: string;
    canCheck: boolean;
    canInstall: boolean;
}

export interface UpdatesDeps {
    current: string;
    /** Null when the main process did not answer or the answer was not in the expected form. */
    check(): Promise<UpdateAnswer | null>;
    install(): Promise<UpdateAnswer | null>;
}

export const UPDATES_TEXT = {
    idle: "Press the button to see if there is a newer version. Nothing is downloaded until you choose to update.",
    checking: "Looking for a newer version...",
    installing: "Downloading and checking the new version... do not close Discord.",
    noAnswer: "The check did not answer. Try again in a moment.",
    installNoAnswer: "The update did not answer, so nothing was changed. Try again in a moment.",
    installed: (version: string) => `Version ${version} is installed. Restart Discord to start using it.`,
    upToDate: (version: string) => `You have the newest version (${version}).`,
    available: (latest: string, current: string) => `Version ${latest} is available (you have ${current}).`
} as const;

export function createUpdatesModel(deps: UpdatesDeps) {
    let state = build({ phase: "idle", current: deps.current, latest: "", news: [], message: UPDATES_TEXT.idle });
    const listeners = new Set<() => void>();

    function build(base: Omit<UpdatesState, "canCheck" | "canInstall">): UpdatesState {
        return {
            ...base,
            canCheck: base.phase !== "checking" && base.phase !== "installing",
            canInstall: base.phase === "available"
        };
    }

    function set(change: Partial<Omit<UpdatesState, "canCheck" | "canInstall">>) {
        const { canCheck: _a, canInstall: _b, ...current } = state;
        state = build({ ...current, ...change });
        for (const listener of [...listeners]) listener();
    }

    function show(answer: UpdateAnswer | null, whenSilent: string) {
        if (!answer) {
            set({ phase: "error", message: whenSilent });
            return;
        }
        switch (answer.status) {
            case "up-to-date":
                set({ phase: "up-to-date", latest: answer.latest, news: [], message: UPDATES_TEXT.upToDate(answer.current) });
                return;
            case "available":
                set({ phase: "available", latest: answer.latest, news: answer.news, message: UPDATES_TEXT.available(answer.latest, answer.current) });
                return;
            case "installed":
                set({ phase: "installed", latest: answer.installed, news: [], message: UPDATES_TEXT.installed(answer.installed) });
                return;
            case "error":
                set({ phase: "error", message: answer.message.endsWith(".") ? answer.message : `${answer.message}.` });
        }
    }

    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        /** Looks for a newer version. Changes nothing on disk. */
        async check() {
            if (!state.canCheck) return;
            set({ phase: "checking", message: UPDATES_TEXT.checking });
            try {
                show(await deps.check(), UPDATES_TEXT.noAnswer);
            } catch {
                set({ phase: "error", message: UPDATES_TEXT.noAnswer });
            }
        },

        /** Installs the version the last check found. Only while one is waiting. */
        async install() {
            if (!state.canInstall) return;
            set({ phase: "installing", message: UPDATES_TEXT.installing });
            try {
                show(await deps.install(), UPDATES_TEXT.installNoAnswer);
            } catch {
                set({ phase: "error", message: UPDATES_TEXT.installNoAnswer });
            }
        }
    };
}

export type UpdatesModel = ReturnType<typeof createUpdatesModel>;
