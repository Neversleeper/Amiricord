/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Keys for the menus. `toKey` is pure; `createKeySource` connects it to a real terminal.

import { emitKeypressEvents } from "node:readline";

export type Key =
    | { name: "up" | "down" | "enter" | "escape" | "interrupt"; }
    | { name: "digit"; digit: number; };

/** Where the menus get their keys from. Tests give a scripted one. `null` means the input ended. */
export interface KeySource {
    next(): Promise<Key | null>;
}

/** Turn what Node's keypress event says into the few keys the menus use. Anything else gives null. */
export function toKey(text: string | undefined, key: { name?: string; ctrl?: boolean; } | undefined): Key | null {
    if (key?.ctrl && key.name === "c") return { name: "interrupt" };
    switch (key?.name) {
        case "up": return { name: "up" };
        case "down": return { name: "down" };
        case "return":
        case "enter": return { name: "enter" };
        case "escape": return { name: "escape" };
    }
    if (text && /^[0-9]$/.test(text)) return { name: "digit", digit: Number(text) };
    return null;
}

export interface TerminalKeys extends KeySource {
    close(): void;
}

/** Read keys from a terminal, one at a time, in raw mode. Call `close` to give the terminal back. */
export function createKeySource(input: NodeJS.ReadStream): TerminalKeys {
    emitKeypressEvents(input);
    const queue: Array<Key | null> = [];
    let waiting: ((key: Key | null) => void) | null = null;

    const push = (key: Key | null) => {
        if (waiting) {
            const resolve = waiting;
            waiting = null;
            resolve(key);
        } else {
            queue.push(key);
        }
    };

    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; } | undefined) => {
        const mapped = toKey(text, key);
        if (mapped) push(mapped);
    };
    const onEnd = () => push(null);

    input.setRawMode?.(true);
    input.resume();
    input.on("keypress", onKey);
    input.on("end", onEnd);

    return {
        next: () => (queue.length > 0 ? Promise.resolve(queue.shift() ?? null) : new Promise(resolve => { waiting = resolve; })),
        close() {
            input.off("keypress", onKey);
            input.off("end", onEnd);
            input.setRawMode?.(false);
            input.pause();
        }
    };
}
