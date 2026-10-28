/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Builds the text the preload hands to the page. Separate from the preload so it can be tested without Electron.

import { PROJECT_NAME } from "../shared/project";

/**
 * Wrap the bundled page script so it learns the name under which the bridge was exposed.
 * The bundle reads `__bridgeKey`. The key is JSON-encoded, so no value can break out of the string.
 */
export function buildRendererScript(bundle: string, bridgeKey: string): string {
    return `(function (__bridgeKey) {\n${bundle}\n})(${JSON.stringify(bridgeKey)});\n//# sourceURL=${PROJECT_NAME}Renderer`;
}

/** A name nobody else guesses, so the bridge does not sit under a name that Discord's own code or other pages could look for. */
export function makeBridgeKey(random: () => number = Math.random): string {
    let key = "";
    for (let i = 0; i < 4; i++) key += Math.floor(random() * 0xffffffff).toString(36);
    return `b${key}`;
}
