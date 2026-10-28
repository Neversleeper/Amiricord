/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A selection menu: arrows move, Enter chooses, the digits 1 to 9 jump to an item, Esc or Ctrl+C cancel.

import type { Style } from "./ansi";
import type { Key, KeySource } from "./keys";

export type Tone = "normal" | "good" | "warn" | "dim";

export interface MenuItem<T> {
    label: string;
    /** Shown after the label in gray: a path, a note. */
    detail?: string;
    tone?: Tone;
    value: T;
}

/** Where the menu draws and reads. */
export interface MenuIo {
    out(text: string): void;
    style: Style;
    keys: KeySource;
}

function paint(style: Style, tone: Tone, text: string): string {
    switch (tone) {
        case "good": return style.green(text);
        case "warn": return style.yellow(text);
        case "dim": return style.dim(text);
        default: return text;
    }
}

/** The lines of the menu for one moment. The current item has a pointer and is bold cyan. */
export function renderMenu<T>(title: string, items: readonly MenuItem<T>[], selected: number, style: Style): string[] {
    const lines = [style.bold(title)];
    items.forEach((item, index) => {
        const number = index < 9 ? `${index + 1}. ` : "   ";
        const detail = item.detail ? `  ${style.dim(item.detail)}` : "";
        lines.push(index === selected
            ? `${style.cyan("›")} ${style.bold(style.cyan(`${number}${item.label}`))}${detail}`
            : `  ${paint(style, item.tone ?? "normal", `${number}${item.label}`)}${detail}`);
    });
    lines.push(style.dim("  ↑ ↓ to move, Enter to choose, 1-9 to jump, Esc to cancel"));
    return lines;
}

export type Move = { selected: number; } | { chosen: number; } | { cancelled: true; };

/** What a key does to the menu. Pure, so it is tested without a terminal. */
export function applyKey(selected: number, count: number, key: Key): Move {
    switch (key.name) {
        case "up": return { selected: (selected - 1 + count) % count };
        case "down": return { selected: (selected + 1) % count };
        case "enter": return { chosen: selected };
        case "escape":
        case "interrupt": return { cancelled: true };
        case "digit": return key.digit >= 1 && key.digit <= Math.min(count, 9) ? { chosen: key.digit - 1 } : { selected };
    }
}

const redraw = (lines: number) => `\u001b[${lines}A\u001b[0J`;

/** Show the menu and wait. Returns the chosen value, or null when the owner cancelled or the input ended. */
export async function selectMenu<T>(io: MenuIo, title: string, items: readonly MenuItem<T>[], initial = 0): Promise<T | null> {
    if (items.length === 0) return null;
    let selected = Math.min(Math.max(initial, 0), items.length - 1);
    let drawn = 0;

    const draw = () => {
        const lines = renderMenu(title, items, selected, io.style);
        io.out((drawn ? redraw(drawn) : "") + lines.join("\n") + "\n");
        drawn = lines.length;
    };

    draw();
    for (;;) {
        const key = await io.keys.next();
        if (key === null) return null;
        const move = applyKey(selected, items.length, key);
        if ("cancelled" in move) return null;
        if ("chosen" in move) {
            selected = move.chosen;
            draw();
            return items[selected].value;
        }
        if (move.selected !== selected) {
            selected = move.selected;
            draw();
        }
    }
}
