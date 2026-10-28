/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Opens Discord's own dialogs for a plugin and closes whatever the plugin left open when it stops. If Discord's opener is not found the plugin
// gets `undefined` back and a recorded miss, never an error. Design: docs/analysis-27-modals.md.

import type { Finder } from "../webpack/finders";

export interface ModalOptions {
    modalKey?: string;
    onCloseRequest?(): void;
    onCloseCallback?(): void;
}

/** What Discord passes to the function that draws a modal. */
export interface ModalRenderProps {
    transitionState: number;
    onClose(): void;
}

export type ModalRender = (props: ModalRenderProps) => unknown;

export interface ModalsFinders {
    byCode<T = unknown>(...snippets: string[]): Finder<T>;
}

type OpenModalFunction = (render: ModalRender, options?: ModalOptions) => unknown;
type CloseModalFunction = (key: string) => void;

export interface PluginModals {
    /** Open a modal. Returns its key, or undefined when Discord's opener was not found. */
    open(render: ModalRender, options?: ModalOptions): string | undefined;
    /** Close one modal this plugin opened. */
    close(key: string): void;
    /** Close every modal this plugin opened and has not closed. */
    closeAll(): void;
}

export function buildModals(finders: ModalsFinders, onDispose: (undo: () => void) => void, reportError: (source: string, error: unknown) => void): PluginModals {
    // Read from the code of Discord build 649389 (docs/analysis-35): the opener is the one function that takes these three option names. "modalKey:" alone also
    // matches the lazy opener and many callers, and the first of those crashed Discord.
    const opener = finders.byCode<OpenModalFunction>("stackNextByDefault:", "dismissable:", "onCloseCallback:");
    const closer = finders.byCode<CloseModalFunction>(".onCloseCallback()");
    const open = new Set<string>();
    let registered = false;

    const closeOne = (key: string) => {
        open.delete(key);
        try {
            closer.get()?.(key);
        } catch (error) {
            reportError("modals close", error);
        }
    };
    const closeAll = () => {
        for (const key of [...open]) closeOne(key);
    };

    return {
        open(render, options) {
            const openModal = opener.get();
            if (!openModal) return undefined;
            let key: unknown;
            try {
                key = openModal(render, options);
            } catch (error) {
                reportError("modals open", error);
                return undefined;
            }
            if (typeof key !== "string") return undefined;
            open.add(key);
            if (!registered) {
                registered = true;
                onDispose(closeAll);
            }
            return key;
        },
        close: closeOne,
        closeAll
    };
}
