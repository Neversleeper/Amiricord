/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Where the main-process code of every plugin is reached by id. Empty here: the build replaces this module with one generated from the registry
// (`scripts/build/generate.ts`), where each plugin's native file is a `require` inside its own function, so a plugin that is switched off never
// runs any of its native code. Design: docs/analysis-29-plugin-native-bridge.md.

export const nativeModules: Readonly<Record<string, () => Record<string, unknown>>> = {};
