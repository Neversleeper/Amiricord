/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The two places the Amiricord tab can open for the person, after a click: the health report (the file `health.json` of the data folder, shown in the
// explorer) and the project's page on GitHub (in the browser). The page only sends a word; the folder, the file and the address are ours, so the page
// cannot make the explorer or the browser open anything else. Opening the address is done by the person's browser: the engine sends nothing itself.
// The decisions are here, without Electron, so they are tested.

import { UPDATE_REPO } from "../shared/project";
import { openDataFolder, type OpenFolderDeps } from "./openFolder";

export const OWN_PLACES = ["health", "source"] as const;
export type OwnPlace = typeof OWN_PLACES[number];

/** The health report file the engine writes in the data folder. */
export const HEALTH_FILE = "health.json";

/** The page of the project (the repository the updater reads). */
export const SOURCE_URL = `https://github.com/${UPDATE_REPO}`;

export interface OpenOwnDeps extends OpenFolderDeps {
    /** Electron's `shell.openExternal`: opens the address in the person's browser. */
    openExternal(url: string): Promise<void>;
}

/** Never throws. Anything that is not one of the two words is ignored. */
export async function openOwn(place: unknown, deps: OpenOwnDeps): Promise<void> {
    if (place === "health") {
        await openDataFolder(deps, HEALTH_FILE);
        return;
    }
    if (place === "source") {
        try {
            await deps.openExternal(SOURCE_URL);
            deps.trace("open source code: asked the browser to open the project's page");
        } catch (error) {
            deps.trace(`open source code FAILED: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
