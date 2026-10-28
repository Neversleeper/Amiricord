/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getContext } from "./context";
import type { PluginNative } from "./types";

type Native = PluginNative<typeof import("../native")>;

export const QuestifyNative: Native | undefined = {
    complete: (...args: unknown[]) => getContext().native.call("complete", ...args)
} as unknown as Native;
