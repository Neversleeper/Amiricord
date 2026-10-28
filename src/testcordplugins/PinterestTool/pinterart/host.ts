/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The small layer between the interface of the other TestCord author ("Pinterart", credits in ../plugin.json) and Amiricord. His screens were written against
// Vencord's helpers (`@api/DataStore`, `@utils/modal`, `@webpack/common`, toasts, clipboard ...). Here each of those names exists with the same shape, built
// on what Amiricord gives a plugin: `ctx.storage`, `ctx.components`, `ctx.common`, `ctx.native`, React as Discord runs it. The interface code itself stays as he wrote
// it. Nothing here is a Vencord file. Design: docs/analysis-39-pinterart-comparison.md.

import { currentReact } from "../../../api/jsxRuntime";
import type { PluginStorage } from "../../../api/storage";
import type { JsonValue } from "../../../shared/settings";
import type * as NativeModule from "../native";
import { ThumbLoader } from "../thumbs";
import type { MediaFilter, MediaResult, SearchKind } from "../types";

type NativeCalls = { [K in keyof typeof NativeModule]: (typeof NativeModule)[K] extends (host: never, ...rest: infer A) => infer R ? (...rest: A) => R : never };

/** What the plugin hands over when it starts. Everything the interface needs from Amiricord. */
export interface HostBindings {
    storage: PluginStorage;
    native: NativeCalls;
    /** Discord's Flux dispatcher, found by name. May be missing. */
    dispatch(action: { type: string; [key: string]: unknown; }): void;
    /** `createPortal` of Discord's react-dom, or undefined when it was not found. */
    createPortal(children: unknown, container: unknown): unknown;
    /** The window pieces: Discord's or ours. */
    modal: { Root: unknown; Header: unknown; Content: unknown; CloseButton: unknown; };
    report(source: string, error: unknown): void;
}

let bound: HostBindings | undefined;
let thumbs: ThumbLoader | undefined;

export function bindHost(bindings: HostBindings): void {
    bound = bindings;
    // The page cannot load Pinterest's pictures itself (Discord's content policy), so the main process fetches them and they are shown from `blob:` addresses.
    thumbs = new ThumbLoader({
        fetchMedia: url => bindings.native.fetchMedia(url),
        createUrl: blob => URL.createObjectURL(blob),
        revokeUrl: url => { URL.revokeObjectURL(url); }
    });
}

export function unbindHost(): void {
    thumbs?.dispose();
    thumbs = undefined;
    bound = undefined;
}

/** Pause (true) or resume (false) the grid's pictures, so a download the person asked for does not wait behind them. */
export function holdPictures(on: boolean): void {
    thumbs?.hold(on);
}

/**
 * Ask for a picture of Pinterest to show in an `<img>`: `done` gets a `blob:` address, or null when it could not be had. Returns a function that says the picture is
 * no longer needed. Without a started plugin the answer is null.
 */
export function loadPicture(url: string, done: (blobUrl: string | null) => void): () => void {
    if (!thumbs) {
        queueMicrotask(() => { done(null); });
        return () => undefined;
    }
    return thumbs.request(url, done);
}

function host(): HostBindings {
    if (!bound) throw new Error("Pinterest Tool is not started");
    return bound;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// React hooks: the same names, delegating at call time to the React Discord runs.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

type Setter<T> = (value: T | ((previous: T) => T)) => void;

export function useState<T>(initial: T | (() => T)): [T, Setter<T>] {
    return currentReact().useState(initial);
}

export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    currentReact().useEffect(effect, deps);
}

export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
    const react = currentReact();
    // A test double without it falls back to the plain effect: same order of work, only the timing differs.
    (react.useLayoutEffect ?? react.useEffect)(effect, deps);
}

export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
    const { useMemo: memo } = currentReact();
    if (!memo) throw new Error("this React has no useMemo");
    return memo(factory, deps);
}

export function useRef<T>(initial: T): { current: T; };
export function useRef<T>(initial: T | null): { current: T | null; };
export function useRef<T>(initial: T | null): { current: T | null; } {
    const { useRef: ref } = currentReact();
    if (!ref) throw new Error("this React has no useRef");
    return ref(initial);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Joins class names, skipping everything that is not a non-empty string. */
export function classes(...names: Array<string | false | null | undefined>): string {
    return names.filter((name): name is string => typeof name === "string" && name.length > 0).join(" ");
}

export class Logger {
    constructor(private readonly name: string) { }

    error(...args: unknown[]): void { console.error(`[${this.name}]`, ...args); }
    warn(...args: unknown[]): void { console.warn(`[${this.name}]`, ...args); }
    info(...args: unknown[]): void { console.info(`[${this.name}]`, ...args); }
}

export const DataStore = {
    async get(key: string): Promise<unknown> {
        return host().storage.get(key);
    },
    async set(key: string, value: unknown): Promise<void> {
        await host().storage.set(key, value as JsonValue);
    }
};

export const FluxDispatcher = {
    dispatch(action: { type: string; [key: string]: unknown; }): void {
        host().dispatch(action);
    }
};

export const ReactDOMPortal = {
    createPortal(children: unknown, container: unknown): unknown {
        return host().createPortal(children, container);
    }
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// The window pieces
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface ModalProps {
    transitionState: number;
    onClose(): void;
}

export const ModalSize = { SMALL: "small", MEDIUM: "medium", LARGE: "large", DYNAMIC: "dynamic" } as const;

function piece(pick: (bindings: HostBindings) => unknown) {
    return function Piece(props: Record<string, unknown>) {
        return currentReact().createElement(pick(host()), props);
    };
}

export const ModalRoot = piece(h => h.modal.Root);
export const ModalHeader = piece(h => h.modal.Header);
export const ModalContent = piece(h => h.modal.Content);
export const ModalCloseButton = piece(h => h.modal.CloseButton);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Toasts, clipboard, download, image preview, links: plain DOM, no Discord internals
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export const Toasts = { Type: { MESSAGE: "message", SUCCESS: "success", FAILURE: "failure" } } as const;
export type ToastType = (typeof Toasts.Type)[keyof typeof Toasts.Type];

export const TOAST_LIFETIME_MS = 3500;

/** The look of the toasts and of the image preview. */
export const HOST_CSS = `
.vc-pinterest-tool-toasts { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 100000; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.vc-pinterest-tool-toast { max-width: 420px; padding: 10px 16px; border-radius: 8px; font-size: 14px; line-height: 1.3; color: #fff; background: #1e1f22; box-shadow: 0 6px 20px rgba(0, 0, 0, .45); border-left: 4px solid #5865f2; }
.vc-pinterest-tool-toast-success { border-left-color: #23a55a; }
.vc-pinterest-tool-toast-failure { border-left-color: #f23f43; }
.vc-pinterest-tool-lightbox { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; background: rgba(0, 0, 0, .8); cursor: zoom-out; pointer-events: auto; }
/* Our window sits above Discord's own layers, so while Discord's Edit Image dialog is open the window steps aside (it comes back on Cancel). */
body[data-pinterart-editing] .amiricord-modal-backdrop { visibility: hidden; pointer-events: none; }
.vc-pinterest-tool-lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 8px 32px rgba(0, 0, 0, .6); }
`;

interface Page {
    document: Document;
    navigator: Navigator;
    setTimeout: typeof setTimeout;
}

const page = (): Page => globalThis as unknown as Page;

export function showToast(message: string, type: ToastType = Toasts.Type.MESSAGE): void {
    const { document: doc, setTimeout: later } = page();
    let box = doc.querySelector<HTMLElement>(".vc-pinterest-tool-toasts");
    if (!box) {
        box = doc.createElement("div");
        box.className = "vc-pinterest-tool-toasts";
        doc.body.append(box);
    }
    const toast = doc.createElement("div");
    toast.className = classes("vc-pinterest-tool-toast", type === Toasts.Type.SUCCESS && "vc-pinterest-tool-toast-success", type === Toasts.Type.FAILURE && "vc-pinterest-tool-toast-failure");
    toast.setAttribute("role", "status");
    toast.textContent = message;
    box.append(toast);
    later(() => {
        toast.remove();
        if (box && !box.childElementCount) box.remove();
    }, TOAST_LIFETIME_MS);
}

export function copyWithToast(text: string, message: string): void {
    const clipboard = page().navigator.clipboard;
    clipboard.writeText(text).then(
        () => { showToast(message, Toasts.Type.SUCCESS); },
        () => { showToast("Could not copy.", Toasts.Type.FAILURE); }
    );
}

/** Saves a file through a download link. The address is released a little later. */
export function saveFile(file: File): void {
    const { document: doc, setTimeout: later } = page();
    const address = URL.createObjectURL(file);
    const link = doc.createElement("a");
    link.href = address;
    link.download = file.name;
    link.click();
    later(() => { URL.revokeObjectURL(address); }, 10_000);
}

/** A full-screen look at one picture. A click or Escape closes it. */
export function openImageModal(image: { url: string; original?: string; width?: number; height?: number; }): void {
    const doc = page().document;
    const box = doc.createElement("div");
    box.className = "vc-pinterest-tool-lightbox";
    const picture = doc.createElement("img");
    picture.alt = "";
    box.append(picture);
    // The original first; the smaller copy when the original cannot be had.
    let stopLoading = loadPicture(image.original ?? image.url, blob => {
        if (blob) picture.src = blob;
        else if (image.original && image.original !== image.url) stopLoading = loadPicture(image.url, second => { if (second) picture.src = second; });
    });
    const close = () => {
        stopLoading();
        box.remove();
        doc.removeEventListener("keydown", onKey, true);
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
    };
    box.addEventListener("click", close);
    doc.addEventListener("keydown", onKey, true);
    doc.body.append(box);
}

/** Opens an address in the person's browser. Only https addresses; the page is not given access to the opener. */
export function openExternal(address: string): void {
    let parsed: URL;
    try {
        parsed = new URL(address);
    } catch {
        return;
    }
    if (parsed.protocol !== "https:") return;
    const link = page().document.createElement("a");
    link.href = parsed.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// The plugin's main-process functions, in the shape his screens call them
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface FetchedMedia extends MediaResult {
    dataUrl: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

export const Native = {
    warmUp(): Promise<void> {
        return host().native.warmUp();
    },
    async fetchMedia(url: string): Promise<FetchedMedia> {
        const media = await host().native.fetchMedia(url);
        return { ...media, dataUrl: `data:${media.type};base64,${bytesToBase64(new Uint8Array(media.data))}` };
    },
    /** The page size is the main process's own; `_perPage` stays so his calls keep their shape. */
    search(query: string, _perPage: number, mediaFilter: MediaFilter, bookmarks: string[], target: SearchKind, randomize: boolean) {
        return host().native.search({ query, mediaFilter, target, bookmarks, randomize });
    }
};
