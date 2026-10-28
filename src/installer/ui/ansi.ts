/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Terminal colors with plain ANSI codes, no library. Colors are off when the output is not a terminal or `NO_COLOR` is set.

export interface Style {
    bold(text: string): string;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    cyan(text: string): string;
    blue(text: string): string;
    /** Black on yellow and white on red: the WARN and ERROR labels, like the ones of TestCord's installer. */
    warnTag(text: string): string;
    errorTag(text: string): string;
}

const wrap = (open: number, close: number) => (text: string) => `\u001b[${open}m${text}\u001b[${close}m`;

export function makeStyle(enabled: boolean): Style {
    if (!enabled) {
        const plain = (text: string) => text;
        return { bold: plain, dim: plain, red: plain, green: plain, yellow: plain, cyan: plain, blue: plain, warnTag: plain, errorTag: plain };
    }
    return {
        bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), green: wrap(32, 39), yellow: wrap(33, 39), cyan: wrap(36, 39), blue: wrap(34, 39),
        warnTag: text => `\u001b[30;43m ${text} \u001b[0m`, errorTag: text => `\u001b[97;41m ${text} \u001b[0m`
    };
}

export type Level = "INFO" | "OK" | "WARN" | "ERROR";

/** The coloured label in front of a progress line: `INFO` blue, `OK` green, `WARN` black on yellow, `ERROR` white on red. Padded to the same width. */
export function levelLabel(style: Style, level: Level): string {
    switch (level) {
        case "INFO": return style.blue("INFO") + "  ";
        case "OK": return style.green("OK") + "    ";
        case "WARN": return style.warnTag("WARN") + " ";
        case "ERROR": return style.errorTag("ERROR");
    }
}

/** `NO_COLOR` (set to anything but empty), a dumb terminal or a pipe all turn colors off. */
export function colorsEnabled(env: Record<string, string | undefined>, isTTY: boolean): boolean {
    if (!isTTY) return false;
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
    return env.TERM !== "dumb";
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
    return text.replace(ANSI, "");
}
