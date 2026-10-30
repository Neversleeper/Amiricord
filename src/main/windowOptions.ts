/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Three choices of the main tab that change Discord's windows from the main process: no minimum size, Ctrl+Q to close, and the Windows background effect (Mica, Tabbed,
// Acrylic). They are read once when Discord starts (the main tab says "Restart" next to each) and applied to every window as it is created. Everything here is written over a
// small description of Electron's `BrowserWindow`, so it is tested without Electron; every step is wrapped so that a window that does not answer, or an Electron that lacks
// a function, is written in the boot trace and never stops Discord from starting or from opening a window. Nothing is applied in safe mode (the caller decides).
// Not verified in a real Discord: what each one does to Discord's own window.

import { type BackgroundMaterial, MATERIALS, OPTION_KEYS, SMALL_MINIMUM } from "../shared/windowChoices";

export { type BackgroundMaterial, MATERIALS, OPTION_KEYS };

export interface WindowOptions {
    /** Let the window shrink below the size Discord normally allows. */
    removeMinimumSize: boolean;
    /** Ctrl+Q closes the window, as Alt+F4 does. */
    ctrlQ: boolean;
    /** The Windows background effect, or "none". */
    material: BackgroundMaterial;
}

/** What is saved, checked: a switch is on only when it is exactly `true`, and a material that is not one of the four is "none". */
export function windowOptionsOf(read: (key: string) => unknown): WindowOptions {
    const material = read(OPTION_KEYS.material);
    return {
        removeMinimumSize: read(OPTION_KEYS.removeMinimumSize) === true,
        ctrlQ: read(OPTION_KEYS.ctrlQ) === true,
        material: (MATERIALS as readonly unknown[]).includes(material) ? material as BackgroundMaterial : "none"
    };
}

/** Whether any of the three is on, so the caller can leave Discord's windows entirely alone when none is. */
export function anyWindowOption(options: WindowOptions): boolean {
    return options.removeMinimumSize || options.ctrlQ || options.material !== "none";
}

/** The part of Electron's input event the shortcut reads. */
export interface InputLike {
    type?: string;
    key?: string;
    control?: boolean;
    alt?: boolean;
    shift?: boolean;
    meta?: boolean;
}

/** Ctrl+Q, pressed (not released), with no other modifier. */
export function isCtrlQ(input: InputLike): boolean {
    return input.type === "keyDown" && typeof input.key === "string" && input.key.toLowerCase() === "q"
        && input.control === true && input.alt !== true && input.shift !== true && input.meta !== true;
}

/** The part of Electron's `BrowserWindow` used here. Every function but `webContents.on` may be missing. */
export interface WindowLike {
    setMinimumSize?(width: number, height: number): void;
    getMinimumSize?(): number[];
    setBackgroundMaterial?(material: BackgroundMaterial): void;
    close?(): void;
    isDestroyed?(): boolean;
    webContents?: { on(event: "before-input-event", listener: (event: { preventDefault(): void; }, input: InputLike) => void): void; };
}

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Apply the chosen options to one window. Never throws; each step that fails is written through `trace`. */
export function applyWindowOptions(win: WindowLike, options: WindowOptions, trace: (text: string) => void): void {
    if (options.removeMinimumSize) {
        try {
            if (typeof win.setMinimumSize === "function") {
                const original = win.setMinimumSize.bind(win);
                original(SMALL_MINIMUM.width, SMALL_MINIMUM.height);
                // Discord sets its own minimum size (940 by 500) after the window is created, which would undo this, so later asks for a minimum size are turned into the small one.
                // Each ask is written in the trace (the first five), and a few seconds later the minimum size the window really has, because it is not known why it can still be stuck.
                let asks = 0;
                win.setMinimumSize = (width, height) => {
                    original(SMALL_MINIMUM.width, SMALL_MINIMUM.height);
                    if (asks++ < 5) trace(`window options: Discord asked for a minimum size of ${String(width)} by ${String(height)}; it was kept at ${String(SMALL_MINIMUM.width)} by ${String(SMALL_MINIMUM.height)}`);
                };
                const check = setTimeout(() => {
                    try {
                        if (win.isDestroyed?.() === true) return;
                        const size = win.getMinimumSize?.();
                        trace(`window options: the minimum size of a window is now ${size ? `${String(size[0])} by ${String(size[1])}` : "unknown"}`);
                    } catch (error) {
                        trace(`window options: reading the minimum size FAILED: ${failure(error)}`);
                    }
                }, 6000);
                check.unref?.();
                trace("window options: the minimum size was removed from a window");
            } else trace("window options: this window cannot have its minimum size removed");
        } catch (error) {
            trace(`window options: removing the minimum size FAILED: ${failure(error)}`);
        }
    }
    if (options.material !== "none") {
        try {
            if (typeof win.setBackgroundMaterial === "function") {
                win.setBackgroundMaterial(options.material);
                trace(`window options: the background effect "${options.material}" was asked of a window`);
            } else trace("window options: this window cannot have a background effect (Windows 11 is needed)");
        } catch (error) {
            trace(`window options: the background effect FAILED: ${failure(error)}`);
        }
    }
    if (options.ctrlQ) {
        try {
            win.webContents?.on("before-input-event", (event, input) => {
                try {
                    if (!isCtrlQ(input)) return;
                    if (win.isDestroyed?.() === true) return;
                    event.preventDefault();
                    win.close?.();
                } catch (error) {
                    trace(`window options: Ctrl+Q FAILED: ${failure(error)}`);
                }
            });
            trace("window options: Ctrl+Q was added to a window");
        } catch (error) {
            trace(`window options: adding Ctrl+Q FAILED: ${failure(error)}`);
        }
    }
}
