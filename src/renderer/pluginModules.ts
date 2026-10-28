/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Where the code of every plugin is reached by id. Empty until the build step that generates it from the registry
// (step 7c) fills it in, so there is a single place that knows which plugin code is inside the bundle.

import type { PluginCode } from "./engine";

export const pluginModules: Readonly<Record<string, () => PluginCode>> = {};
