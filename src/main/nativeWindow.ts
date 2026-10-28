/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What a native function of a plugin may do with the Discord window that made the call. Today only one thing: open that window's developer tools, and only
// for a plugin whose manifest declares `permissions.system.devtools` (the native host checks that; see `nativeHost.ts`). Written over a small description of
// Electron's `webContents` so this file is tested without Electron. Every call answers false instead of throwing.
// Honest limit: Discord keeps its own developer tools switched off unless a flag in its settings file is on (Amiricord does not touch that file), and it may
// close them again right after they open; `openDevTools` says whether they were open at that moment.

/** The part of Electron's `webContents` used here. */
export interface WebContentsLike {
    isDestroyed(): boolean;
    openDevTools(): void;
    isDevToolsOpened(): boolean;
}

export interface NativeWindow {
    /** The window is there and can be asked to open its developer tools. */
    canOpenDevTools(): boolean;
    /** Ask the window to open its developer tools. True when they were open right after. */
    openDevTools(): boolean;
}

export function nativeWindowOf(contents: WebContentsLike): NativeWindow {
    return {
        canOpenDevTools() {
            try {
                return !contents.isDestroyed();
            } catch {
                return false;
            }
        },
        openDevTools() {
            try {
                if (contents.isDestroyed()) return false;
                contents.openDevTools();
                return contents.isDevToolsOpened();
            } catch {
                return false;
            }
        }
    };
}
