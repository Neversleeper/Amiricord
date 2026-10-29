/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ChannelTabs of Equicord. A shortcut is written as text, like `CTRL+SHIFT+TAB`: the modifiers first, the key last.

export interface KeyEventLike {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
}

/** Whether a key press is the shortcut written in `keybind`. Control and the Windows/Command key count the same. A shortcut with no key (empty text) never matches. */
export function matchesKeybind(event: KeyEventLike, keybind: string): boolean {
    const parts = keybind.toUpperCase().split("+").map(part => part.trim());
    const main = parts[parts.length - 1];
    if (!main) return false;
    const wantCtrl = parts.includes("CTRL");
    const wantShift = parts.includes("SHIFT");
    const wantAlt = parts.includes("ALT");
    if (main === "CTRL" || main === "SHIFT" || main === "ALT") return false;
    const key = event.key === " " ? "SPACE" : event.key.toUpperCase();
    return wantCtrl === (event.ctrlKey || event.metaKey) && wantShift === event.shiftKey && wantAlt === event.altKey && key === main;
}

/** The number key (1 to 9) pressed with no modifier, or 0 when it is something else. */
export function numberKey(event: KeyEventLike): number {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return 0;
    return /^[1-9]$/.test(event.key) ? Number(event.key) : 0;
}
