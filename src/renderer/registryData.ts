/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The plugin registry as the page sees it. Empty until the build (step 7c) replaces it with `dist/registry.json`.

import type { RegistryView } from "./engine";

export const registryData: RegistryView = { plugins: [], startOrder: [] };
