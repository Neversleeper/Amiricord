/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How JSX in plugins is compiled. The same settings are in tsconfig.json (`jsx` and `jsxImportSource`) so the type
// checker and the bundler agree; the build and the tests take them from here. The import source resolves, through
// the `paths` of tsconfig.json, to src/api/jsxRuntime.ts. Design: docs/design-03-settings.md piece D.

import type { BuildOptions } from "esbuild";

export const JSX_IMPORT_SOURCE = "@amiricord/jsx";

export const JSX_BUILD_OPTIONS: Pick<BuildOptions, "jsx" | "jsxImportSource"> = {
    jsx: "automatic",
    jsxImportSource: JSX_IMPORT_SOURCE
};
