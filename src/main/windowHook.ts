/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Windows title bar" and "Transparent window" of the main tab. Both are options Electron only reads when a window is CREATED, so they cannot be applied afterwards like the other
// window options (`windowOptions.ts`). Here the `BrowserWindow` that Discord asks Electron for is swapped, before Discord's own code runs, for a subclass that adjusts the options
// of Discord's own windows (the ones with a preload script and a title) and then builds the window as usual. Everything is written over small descriptions of Electron, so it is
// tested without Electron. The safe parts: only the two options change, nothing else is touched; if the swap cannot be done the window is simply Discord's; if adjusting throws,
// the window is built with the options Discord gave. Not applied in safe mode (the caller decides). Not verified in a real Discord: how each option looks on Discord's own window.

import { SMALL_MINIMUM } from "../shared/windowChoices";

export interface CreationChoices {
    /** Use the standard Windows title bar instead of Discord's own. */
    nativeTitleBar: boolean;
    /** Make the window see-through. */
    transparent: boolean;
    /** Build the window with no minimum size. Asking for it afterwards (`windowOptions.ts`) is not enough once the window is built by this hook: the minimum Discord gave at creation came back. */
    noMinimumSize: boolean;
}

export const CREATION_KEYS = { nativeTitleBar: "nativeTitleBar", transparent: "transparentWindow", noMinimumSize: "removeMinimumSize" } as const;

/** What is saved, checked: a switch is on only when it is exactly `true`. */
export function creationChoicesOf(read: (key: string) => unknown): CreationChoices {
    return {
        nativeTitleBar: read(CREATION_KEYS.nativeTitleBar) === true,
        transparent: read(CREATION_KEYS.transparent) === true,
        noMinimumSize: read(CREATION_KEYS.noMinimumSize) === true
    };
}

/**
 * Whether the window has to be swapped at all. Only the two options that Electron reads at creation count. "No minimum size" does NOT: with it as the only option, swapping the window
 * made Discord's own minimize, maximize and close buttons stop answering (seen on Stable, Discord build 655747, 2026-10-29; with the option off they worked), and that option is applied
 * to the window after it is built (`windowOptions.ts`) with the same result. When one of the two creation options is on, "no minimum size" is still put in the options.
 */
export function anyCreationChoice(choices: CreationChoices): boolean {
    return choices.nativeTitleBar || choices.transparent;
}

type Options = Record<string, unknown>;

const isRecord = (value: unknown): value is Options => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether these are the options of one of Discord's own windows: it has a preload script and a title. Other windows (the ones Electron makes for itself) are left alone. */
export function isDiscordWindow(options: unknown): boolean {
    if (!isRecord(options)) return false;
    const web = options.webPreferences;
    return isRecord(web) && typeof web.preload === "string" && web.preload !== "" && typeof options.title === "string";
}

/**
 * The options to build the window with. A new object: the given one is not changed. A window that is not Discord's own gets its options back unchanged.
 * A see-through window must have no frame (Electron cannot make a framed one transparent), so when both are on the transparent one wins and the title bar stays Discord's.
 */
export function adjustCreation(options: unknown, choices: CreationChoices, trace: (text: string) => void): unknown {
    if (!isDiscordWindow(options) || !anyCreationChoice(choices)) return options;
    const adjusted: Options = { ...(options as Options) };
    if (choices.transparent) {
        adjusted.transparent = true;
        adjusted.frame = false;
        adjusted.backgroundColor = "#00000000";
        adjusted.hasShadow = false;
        trace(`window options: a window is built transparent${choices.nativeTitleBar ? " (the Windows title bar is not used with it)" : ""}`);
    } else if (choices.nativeTitleBar) {
        delete adjusted.frame;
        delete adjusted.titleBarStyle;
        delete adjusted.titleBarOverlay;
        trace("window options: a window is built with the Windows title bar");
    }
    if (choices.noMinimumSize) {
        adjusted.minWidth = SMALL_MINIMUM.width;
        adjusted.minHeight = SMALL_MINIMUM.height;
        trace("window options: a window is built with no minimum size");
    }
    return adjusted;
}

/** The part of Node's module cache used to swap the constructor. */
export interface ModuleHost {
    resolve(id: string): string;
    cache: Record<string, { exports: unknown; } | undefined>;
}

type Constructor = new (options?: unknown) => object;

/**
 * Put a `BrowserWindow` that adjusts the options of Discord's windows in the place of Electron's, for every module that asks for `electron` from now on. Returns whether it was done.
 * Never throws: whatever goes wrong is written through `trace` and the windows stay Discord's.
 */
export function hookBrowserWindow(host: ModuleHost, choices: CreationChoices, trace: (text: string) => void): boolean {
    try {
        if (!anyCreationChoice(choices)) return false;
        const entry = host.cache[host.resolve("electron")];
        if (!entry || (!isRecord(entry.exports) && typeof entry.exports !== "function")) {
            trace("window options: Electron is not loaded yet, so the window options of the creation cannot be applied");
            return false;
        }
        const original = entry.exports as Options;
        const Base = original.BrowserWindow as Constructor | undefined;
        if (typeof Base !== "function") {
            trace("window options: Electron has no BrowserWindow, so the window options of the creation cannot be applied");
            return false;
        }
        class AdjustedWindow extends Base {
            constructor(options?: unknown) {
                let use = options;
                try {
                    use = adjustCreation(options, choices, trace);
                } catch (error) {
                    trace(`window options: adjusting a window FAILED, it is built as Discord asked: ${error instanceof Error ? error.message : String(error)}`);
                }
                super(use);
            }
        }
        const swapped = new Proxy(original, { get: (target, key) => (key === "BrowserWindow" ? AdjustedWindow : Reflect.get(target, key)) });
        Object.defineProperty(entry, "exports", { value: swapped, configurable: true, writable: true });
        trace("window options: the window constructor is in place");
        return true;
    } catch (error) {
        trace(`window options: the window constructor could not be put in place: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}
