/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** The parts of a keydown event that decide whether it asks for the developer tools. */
export interface KeyLike {
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    repeat?: boolean;
    defaultPrevented?: boolean;
}

/** F12 alone, or Ctrl+Shift+I (Cmd+Shift+I too). Holding the key down, or a key some other code already handled, does not count; any extra modifier does not either. */
export function asksForDevTools(event: KeyLike): boolean {
    if (event.repeat || event.defaultPrevented) return false;
    const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
    const ctrl = event.ctrlKey === true || event.metaKey === true;
    if (key === "f12") return !ctrl && !event.shiftKey && !event.altKey;
    return key === "i" && ctrl && event.shiftKey === true && !event.altKey;
}
