/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Pinterest Tool (author szcx404) as found in TestCord (commit af92dba of its public repository), and its later "Pinterart"
// interface by the same author. The search side (`native.ts`), the settings, the secret cookie and the person's collection (`library.ts`) are written for Amiricord.
// The interface (`pinterart/`) is his, ported on a small host layer (`pinterart/host.ts`): the Pinterest button in Discord's "Select an Image" dialog, the results,
// the favourites and the editor. Ctrl+Shift+P opens the same window without the dialog. Design: docs/analysis-30, 31, 39.

import { nativeOf, type PluginNativeCaller } from "../../api/native";
import type { PluginCode } from "../../renderer/engine";
import type * as NativeModule from "./native";
import { bindHost, HOST_CSS, unbindHost } from "./pinterart/host";
import { openStandalone, startPicker, stopPicker } from "./pinterart/picker";
import { PINTEREST_CSS, PINTEREST_CSS_NAME } from "./pinterart/styles";
import { settings } from "./settings";
import { isOpenShortcut } from "./window";

export { Library } from "./library";
export { settings } from "./settings";
export type { MediaResult, PinterestImageResult, PinterestSearchPayload, SearchOptions } from "./types";

/** Typed calls to the plugin's main-process functions, without the `host` parameter. */
export const pinterestNative = (caller: PluginNativeCaller) => nativeOf<typeof NativeModule>(caller);

let removeShortcut: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const portal = ctx.finders.byProps<{ createPortal(children: unknown, container: unknown): unknown; }>("createPortal");
        bindHost({
            storage: ctx.storage,
            native: pinterestNative(ctx.native),
            dispatch: action => { ctx.common.FluxDispatcher.get()?.dispatch(action); },
            // Without react-dom's portal the menu is drawn where it is, inside the window.
            createPortal: (children, container) => portal.get()?.createPortal(children, container) ?? children,
            // Read when the window is drawn, not now: React may not have been found yet at start, and then these would be undefined.
            modal: {
                get Root() { return ctx.components.ModalRoot.get(); },
                get Header() { return ctx.components.ModalHeader.get(); },
                get Content() { return ctx.components.ModalContent.get(); },
                get CloseButton() { return ctx.components.ModalCloseButton.get(); }
            },
            report: (source, error) => { ctx.reportError(source, error); }
        });
        ctx.addStyle(HOST_CSS, "pinterart-host");
        ctx.addStyle(PINTEREST_CSS, PINTEREST_CSS_NAME);
        // Nothing is contacted until the person opens the window and searches.
        startPicker(ctx);

        const onKey = (event: KeyboardEvent) => {
            if (!isOpenShortcut(event)) return;
            event.preventDefault();
            openStandalone();
        };
        document.addEventListener("keydown", onKey);

        // Discord's own windows keep the focus inside themselves and take it back from anything outside, which is why nothing could be typed in the search box when the window
        // opened over Discord's settings. Focus events that start inside our window are not passed on to them (a capture listener on the page's window runs before theirs).
        const keepFocus = (event: Event) => {
            if (event.target instanceof Element && event.target.closest(".amiricord-modal-backdrop")) event.stopPropagation();
        };
        const focusRoot = document.defaultView ?? document;
        focusRoot.addEventListener("focusin", keepFocus, true);
        focusRoot.addEventListener("focusout", keepFocus, true);
        removeShortcut = () => {
            document.removeEventListener("keydown", onKey);
            focusRoot.removeEventListener("focusin", keepFocus, true);
            focusRoot.removeEventListener("focusout", keepFocus, true);
        };
    },
    stop() {
        removeShortcut?.();
        removeShortcut = undefined;
        stopPicker();
        unbindHost();
    }
};

export default plugin;
