/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The GIF writer (`gifenc`), loaded the same way in the built page and in the tests. The package ships a module build (named exports, which the bundler uses) and
// a CommonJS build (what Node loads for the tests, where the names are on `default`); this takes the names from whichever shape it got.

import * as loaded from "gifenc";

type Codec = typeof loaded;

const codec: Codec = "GIFEncoder" in loaded ? loaded : (loaded as unknown as { default: Codec; }).default;

export const { GIFEncoder, nearestColorIndex, quantize } = codec;
export type { GifEncoderInstance } from "gifenc";
