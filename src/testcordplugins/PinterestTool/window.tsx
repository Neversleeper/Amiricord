/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Opens the Pinterest Tool window and wires it to the plugin's storage, native functions, settings and theme. One window at a time. It also holds the keyboard
// shortcut that opens it (a stand-in until the engine has a chat button or header bar to hang a button on). Design: docs/analysis-33-pinterest-tool-window.md.

import { currentReact } from "../../api/jsxRuntime";
import { nativeOf } from "../../api/native";
import { makeErrorBoundary } from "../../plugins/Settings/ErrorBoundary";
import type { EnginePluginContext } from "../../renderer/engine";
import type { CanvasLike } from "./editorCanvas";
import { type Bitmap, createEditorFor, type PageTools } from "./editorGlue";
import { PresetStore } from "./editorModel";
import { Library } from "./library";
import type * as NativeModule from "./native";
import { PinterestWindow, type WindowParts } from "./PinterestWindow";
import { settings } from "./settings";
import { getPinterestFullStyle, resolveAppearance, resolvePinterestTheme } from "./theme";
import { ThumbLoader } from "./thumbs";
import type { MediaResult } from "./types";
import { WindowSession } from "./windowSession";
import { WINDOW_CSS } from "./windowStyles";

/** Ctrl+Shift+P. */
export function isOpenShortcut(event: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean; }): boolean {
    return event.key.toLowerCase() === "p" && event.ctrlKey === true && event.shiftKey === true && event.altKey !== true && event.metaKey !== true && event.repeat !== true;
}

interface PageLike {
    addEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
    removeEventListener(type: "keydown", listener: (event: KeyEvent) => void): void;
    documentElement?: { classList?: { contains(name: string): boolean; }; };
}

type KeyEvent = Parameters<typeof isOpenShortcut>[0] & { preventDefault?(): void; };

export interface WindowOpener {
    /** Open the window. Does nothing if it is already open or if Discord's opener was not found. */
    open(): void;
    /** Close the window if it is open and stop listening for the shortcut. */
    dispose(): void;
}

interface ToolsPage {
    createImageBitmap(blob: Blob): Promise<Bitmap>;
    document: { createElement(tag: string): unknown; };
    setTimeout(work: () => void, ms: number): unknown;
}

/** What the editor needs from the page. */
export function pageTools(native: { fetchMedia(url: string): Promise<MediaResult>; }, page: ToolsPage = globalThis as unknown as ToolsPage): PageTools {
    return {
        fetchMedia: url => native.fetchMedia(url),
        createBitmap: blob => page.createImageBitmap(blob),
        makeCanvas: () => page.document.createElement("canvas") as CanvasLike,
        download(blob, filename) {
            const address = URL.createObjectURL(blob);
            const link = page.document.createElement("a") as { href: string; download: string; click(): void; };
            link.href = address;
            link.download = filename;
            link.click();
            // The browser has taken what it needs by now; the address is not kept.
            page.setTimeout(() => { URL.revokeObjectURL(address); }, 10_000);
        }
    };
}

export function createWindowOpener(ctx: EnginePluginContext, page: PageLike | undefined = (globalThis as { document?: PageLike; }).document): WindowOpener {
    let key: string | undefined;
    let cleanup: (() => void) | undefined;

    const parts = (): WindowParts | undefined => {
        const found = {
            ModalRoot: ctx.components.ModalRoot.get(), ModalHeader: ctx.components.ModalHeader.get(), ModalContent: ctx.components.ModalContent.get(),
            ModalFooter: ctx.components.ModalFooter.get(), ModalCloseButton: ctx.components.ModalCloseButton.get()
        };
        return Object.values(found).every(Boolean) ? found as unknown as WindowParts : undefined;
    };

    const style = () => {
        const { colorTheme, customAccent, appearance } = settings.store;
        const discordIsDark = page?.documentElement?.classList?.contains("theme-light") !== true;
        return getPinterestFullStyle(resolvePinterestTheme(colorTheme), customAccent, resolveAppearance(appearance as "AUTO" | "DARK" | "LIGHT", discordIsDark), appearance === "AUTO");
    };

    const open = () => {
        if (key !== undefined) return;
        const frame = parts();
        if (!frame) return;
        ctx.addStyle(WINDOW_CSS, "window");
        const native = nativeOf<typeof NativeModule>(ctx.native);
        const session = new WindowSession({ search: options => native.search(options), library: new Library(ctx.storage), randomize: () => settings.store.randomizeSearch, createEditor: (result, kind) => createEditorFor(result, kind, pageTools(native), new PresetStore(ctx.storage)) });
        const thumbs = new ThumbLoader({
            fetchMedia: url => native.fetchMedia(url),
            createUrl: blob => URL.createObjectURL(blob),
            revokeUrl: url => { URL.revokeObjectURL(url); }
        });
        const done = () => {
            session.close();
            thumbs.dispose();
            key = undefined;
            cleanup = undefined;
        };
        // A window that fails to draw shows a message and goes to the health report; it must never take Discord's whole page down with it.
        let Boundary: ReturnType<typeof makeErrorBoundary> | undefined;
        const opened = ctx.modals.open(
            props => {
                Boundary ??= makeErrorBoundary(currentReact(), (label, error) => { ctx.reportError(label, error); });
                return (
                    <Boundary label="Pinterest Tool">
                        <PinterestWindow session={session} thumbs={thumbs} parts={frame} style={style} onClose={() => { props.onClose(); }} />
                    </Boundary>
                );
            },
            { onCloseCallback: done }
        );
        if (opened === undefined) {
            done();
            return;
        }
        key = opened;
        cleanup = done;
    };

    const onKey = (event: KeyEvent) => {
        if (!isOpenShortcut(event)) return;
        event.preventDefault?.();
        open();
    };
    page?.addEventListener("keydown", onKey);

    return {
        open,
        dispose() {
            page?.removeEventListener("keydown", onKey);
            if (key !== undefined) ctx.modals.close(key);
            cleanup?.();
        }
    };
}
