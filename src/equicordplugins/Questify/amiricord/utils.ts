/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class Logger {
    constructor(private readonly name: string, private readonly color = "white") { }

    private emit(method: "debug" | "error" | "info" | "log" | "warn", args: unknown[]): void {
        console[method](`%c ${this.name} `, `background: ${this.color}; color: black; font-weight: bold; border-radius: 5px;`, ...args);
    }

    log(...args: unknown[]): void { this.emit("log", args); }
    info(...args: unknown[]): void { this.emit("info", args); }
    warn(...args: unknown[]): void { this.emit("warn", args); }
    error(...args: unknown[]): void { this.emit("error", args); }
    debug(...args: unknown[]): void { this.emit("debug", args); }
}

export async function copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

type ClassNameArg = string | false | null | undefined | readonly string[] | Record<string, unknown>;

export function classNameFactory(prefix = "") {
    return (...args: ClassNameArg[]): string => {
        const names = new Set<string>();
        for (const arg of args) {
            if (!arg) continue;
            if (typeof arg === "string") names.add(prefix + arg);
            else if (Array.isArray(arg)) (arg as readonly string[]).forEach(name => names.add(prefix + name));
            else if (typeof arg === "object") Object.entries(arg).forEach(([name, on]) => { if (on) names.add(prefix + name); });
        }
        return Array.from(names).join(" ");
    };
}
