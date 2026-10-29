/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The BetterDiscord plugin files that are inside this build. Empty here: the build replaces this module with one that holds the text of every `*.plugin.js` file of
// `src/betterdiscordplugins` (see `bundledBdPluginsSource` in scripts/build/generate.ts), so tests and the type checker see an empty list.

import type { BdSourceFile } from "./manager";

export const bundledPlugins: readonly BdSourceFile[] = [];
