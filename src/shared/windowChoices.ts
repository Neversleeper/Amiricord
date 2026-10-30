/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the main tab's window options are called, shared by the page (the Settings plugin saves them) and the main process (it reads them when Discord starts and applies
// them to the windows, `src/main/windowOptions.ts`). The order of the materials is the order of the choices in the main tab's drop-down.

export const MATERIALS = ["none", "mica", "tabbed", "acrylic"] as const;
export type BackgroundMaterial = (typeof MATERIALS)[number];

/** The names of the settings of the Settings plugin, as they are saved. */
export const OPTION_KEYS = { removeMinimumSize: "removeMinimumSize", ctrlQ: "ctrlQToQuit", material: "backgroundMaterial" } as const;

/** The smallest the window may be made when the minimum size is removed. It is not zero: a minimum of 0 by 0 stopped the maximize button from working (seen on 2026-10-29), while a small one does not. */
export const SMALL_MINIMUM = { width: 320, height: 200 } as const;
