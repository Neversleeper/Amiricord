/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A diagnostic for the window options that change how a window is created (`windowHook.ts`): while one of them is on, the red errors of Discord's page are copied to the boot trace,
// because Discord's own crash screen ("Well, this is awkward") keeps the error to itself. Only error-level console lines are taken, each cut to 300 characters, at most 25 per start,
// and only the first line of each message (stack lines are left out). Nothing is sent anywhere. Electron's `console-message` event has had two shapes (separate arguments, and one
// event object), so both are read. Never throws.

const MAX_LINES = 25;
const MAX_CHARS = 300;

interface ConsoleEventLike {
    level?: unknown;
    message?: unknown;
    lineNumber?: unknown;
    sourceId?: unknown;
}

/** What to write for one console message, or null when it is not an error. `args` are the arguments the listener got. */
export function consoleErrorLine(args: readonly unknown[]): string | null {
    try {
        let level: unknown;
        let message: unknown;
        let line: unknown;
        let source: unknown;
        const first = args[1];
        if (typeof first === "object" && first !== null && "message" in first) {
            const event = first as ConsoleEventLike;
            ({ level, message, lineNumber: line, sourceId: source } = event);
        } else {
            [, level, message, line, source] = args;
        }
        if (level !== "error" && level !== 3) return null;
        if (typeof message !== "string") return null;
        const text = message.split("\n")[0].slice(0, MAX_CHARS);
        const where = typeof source === "string" && source !== "" ? ` (${source.slice(-80)}${typeof line === "number" ? `:${line}` : ""})` : "";
        return `${text}${where}`;
    } catch {
        return null;
    }
}

/** Make the listener for one window: it writes at most `MAX_LINES` error lines through `trace`. */
export function makeConsoleErrorListener(trace: (text: string) => void): (...args: unknown[]) => void {
    let written = 0;
    return (...args) => {
        try {
            if (written >= MAX_LINES) return;
            const line = consoleErrorLine(args);
            if (line === null) return;
            written++;
            trace(`page error: ${line}`);
            if (written === MAX_LINES) trace("page error: no more page errors are copied for this window");
        } catch {
            // A diagnostic must never disturb a window.
        }
    };
}
