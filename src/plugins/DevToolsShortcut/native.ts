/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The main-process side of DevToolsShortcut: opens the developer tools of the window that pressed the key. Only the exported functions can be called from the page.

import type { NativeDevToolsApi, NativeHostApi } from "../../main/nativeHost";

/** True when the tools were open right after the call. A window that cannot open them answers false instead of failing. */
export async function open(host: NativeHostApi & Partial<NativeDevToolsApi>): Promise<boolean> {
    if (!host.canOpenDevTools || !host.openDevTools) return false;
    if (!(await host.canOpenDevTools())) return false;
    return host.openDevTools();
}
