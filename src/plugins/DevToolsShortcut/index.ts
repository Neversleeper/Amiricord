/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A second way to open the developer tools: F12 or Ctrl+Shift+I. Discord's own shortcut only exists while the flag in its settings file is on (the installer and the
// engine switch it on, see src/main/discordDevTools.ts); this one asks the main process to open the tools, so it works without the flag.
// The key is taken (preventDefault) so Discord's own shortcut does not also fire: it toggles, and the two together would close the tools again. Opening is idempotent.
// Not tried in a real Discord at the time of writing: unit tests only.

import { nativeOf } from "../../api/native";
import type { PluginCode } from "../../renderer/engine";
import { asksForDevTools, type KeyLike } from "./keys";
import type * as NativeModule from "./native";

let handler: ((event: KeyboardEvent) => void) | undefined;

const plugin: PluginCode = {
    start(ctx) {
        // A page without events (the build test's fake page) has nothing to listen to; that is not a failure.
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
        const native = nativeOf<typeof NativeModule>(ctx.native);
        handler = event => {
            if (!asksForDevTools(event as KeyLike)) return;
            event.preventDefault();
            native.open().then(
                opened => { if (!opened) ctx.reportError("Developer tools", new Error("the window could not open its developer tools")); },
                error => { ctx.reportError("Developer tools", error); }
            );
        };
        window.addEventListener("keydown", handler, true);
    },

    stop() {
        if (handler) window.removeEventListener("keydown", handler, true);
        handler = undefined;
    }
};

export default plugin;
