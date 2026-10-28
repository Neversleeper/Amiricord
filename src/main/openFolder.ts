/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Opening the data folder for the person. On the owner's Windows, `shell.openPath` answered "ok" and no window ever appeared (Windows often
// keeps a window opened by a background process behind the others). Asking the explorer to show a file inside the folder (`showItemInFolder`)
// brings its window to the front, so that is the first way; `openPath` is the second, and every result is written to the boot trace because
// neither says anything when the window does not appear. The decisions are here, without Electron, so they are tested.

import { join } from "node:path";

export interface OpenFolderDeps {
    /** The folder to open. It is the main process's own; the page cannot name another. */
    folder: string;
    /** Electron's `shell.openPath`: resolves with an error text, or an empty text on success. */
    open(path: string): Promise<string>;
    /** Electron's `shell.showItemInFolder`: opens the explorer with the file selected. */
    reveal(path: string): void;
    trace(text: string): void;
}

/** The file shown by the second way. `state.json` is always there once the engine has started. */
export const REVEAL_FILE = "state.json";

/** Never throws. */
export async function openDataFolder(deps: OpenFolderDeps): Promise<void> {
    try {
        deps.reveal(join(deps.folder, REVEAL_FILE));
        deps.trace("open data folder: asked the explorer to show a file inside it");
        return;
    } catch (error) {
        deps.trace(`open data folder: showing a file FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
    let failure = "";
    try {
        failure = await deps.open(deps.folder);
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
    }
    deps.trace(failure ? `open data folder: opening the folder also FAILED: ${failure}` : "open data folder: asked the explorer to open the folder");
}
