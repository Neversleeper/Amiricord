/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import { SettingsClient } from "../src/api/settingsClient";
import type { PluginStorage } from "../src/api/storage";
import {
    bindHost, bytesToBase64, classes, copyWithToast, DataStore, FluxDispatcher, holdPictures, HOST_CSS, type HostBindings, loadPicture, Logger, ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize,
    Native, openExternal, openImageModal, ReactDOMPortal, saveFile, showToast, TOAST_LIFETIME_MS, Toasts, unbindHost, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "../src/testcordplugins/PinterestTool/pinterart/host";
import { cl, settings } from "../src/testcordplugins/PinterestTool/pinterart/shared";
import { settings as pluginSettings } from "../src/testcordplugins/PinterestTool/settings";

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

function fakeReact(extra: Partial<ReactLike> = {}) {
    const calls: string[] = [];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => { calls.push("useState"); return [start, () => undefined]; }) as ReactLike["useState"],
        useEffect: () => { calls.push("useEffect"); },
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        ...extra
    };
    return { react, calls };
}

function memoryStorage(): PluginStorage & { data: Map<string, unknown>; } {
    const data = new Map<string, unknown>();
    return { data, get: async key => data.get(key) as never, set: async (key, value) => { data.set(key, value); }, delete: async key => data.delete(key) as never, keys: async () => [...data.keys()] } as never;
}

function bindings(extra: Partial<HostBindings> = {}): HostBindings & { searches: unknown[][]; dispatched: unknown[]; } {
    const searches: unknown[][] = [];
    const dispatched: unknown[] = [];
    return {
        storage: memoryStorage(),
        native: {
            warmUp: async () => undefined,
            fetchMedia: async () => ({ data: new TextEncoder().encode("Hi").buffer as ArrayBuffer, type: "image/png", filename: "a.png" }),
            search: async options => { searches.push([options]); return { query: options.query, guides: [], results: [], bookmark: null }; }
        },
        dispatch: action => { dispatched.push(action); },
        createPortal: (children, container) => ({ portal: children, container }),
        modal: { Root: "root-part", Header: "header-part", Content: "content-part", CloseButton: "close-part" },
        report: () => undefined,
        searches,
        dispatched,
        ...extra
    } as never;
}

afterEach(() => {
    unbindHost();
    setReactSource(undefined);
});

describe("the host layer of the ported interface", () => {
    it("refuses to work before the plugin started and after it stopped", async () => {
        await assert.rejects(DataStore.get("k"), /not started/);
        bindHost(bindings());
        await DataStore.set("k", 1);
        unbindHost();
        await assert.rejects(DataStore.get("k"), /not started/);
        assert.throws(() => FluxDispatcher.dispatch({ type: "X" }), /not started/);
    });

    it("keeps values in the plugin's own storage", async () => {
        const b = bindings();
        bindHost(b);
        await DataStore.set("PinterestTool_recent_searches_v1", ["a", "b"]);
        assert.deepEqual(await DataStore.get("PinterestTool_recent_searches_v1"), ["a", "b"]);
        assert.deepEqual((b.storage as ReturnType<typeof memoryStorage>).data.get("PinterestTool_recent_searches_v1"), ["a", "b"]);
        assert.equal(await DataStore.get("missing"), undefined);
    });

    it("waits for the storage to finish writing", async () => {
        let finished = false;
        bindHost(bindings({ storage: { get: async () => undefined, set: async () => { await new Promise(resolve => setImmediate(resolve)); finished = true; } } as never }));
        await DataStore.set("k", 1);
        assert.equal(finished, true);
    });

    it("sends actions to Discord's dispatcher and portals to react-dom", () => {
        const b = bindings();
        bindHost(b);
        FluxDispatcher.dispatch({ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", pendingAvatar: 1 });
        assert.deepEqual(b.dispatched, [{ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", pendingAvatar: 1 }]);
        assert.deepEqual(ReactDOMPortal.createPortal("kids", "box"), { portal: "kids", container: "box" });
    });

    it("turns his search call into the options object of the main-process search", async () => {
        const b = bindings();
        bindHost(b);
        const payload = await Native.search("cats", 8, "GIFS", ["bk1"], "BANNER", true);
        assert.deepEqual(b.searches, [[{ query: "cats", mediaFilter: "GIFS", target: "BANNER", bookmarks: ["bk1"], randomize: true }]]);
        assert.equal(payload.query, "cats");
    });

    it("adds a data address to the downloaded picture and keeps the rest", async () => {
        bindHost(bindings());
        const media = await Native.fetchMedia("https://i.pinimg.com/x.png");
        assert.equal(media.dataUrl, "data:image/png;base64,SGk=");
        assert.equal(media.type, "image/png");
        assert.equal(media.filename, "a.png");
        assert.equal(media.data.byteLength, 2);
    });

    it("warms the session up through the main process", async () => {
        let warmed = 0;
        bindHost(bindings({ native: { ...bindings().native, warmUp: async () => { warmed++; } } }));
        await Native.warmUp();
        assert.equal(warmed, 1);
    });

    it("encodes bytes as base64 the same way as Node, also past the chunk size", () => {
        const big = new Uint8Array(0x8000 * 2 + 5).map((_, index) => index % 251);
        assert.equal(bytesToBase64(big), Buffer.from(big).toString("base64"));
        assert.equal(bytesToBase64(new Uint8Array(0)), "");
    });

    it("joins class names and skips what is not a name", () => {
        assert.equal(classes("a", false, "", null, undefined, "b"), "a b");
        assert.equal(classes(), "");
    });

    it("builds his prefixed class names", () => {
        assert.equal(cl("grid"), "vc-pinterest-tool-grid");
        assert.equal(cl("a", false, "", undefined, "b"), "vc-pinterest-tool-a vc-pinterest-tool-b");
        assert.equal(cl(), "");
    });

    it("logs with the plugin name in front", () => {
        const seen: unknown[][] = [];
        const saved = { error: console.error, warn: console.warn, info: console.info };
        console.error = (...args: unknown[]) => { seen.push(["error", ...args]); };
        console.warn = (...args: unknown[]) => { seen.push(["warn", ...args]); };
        console.info = (...args: unknown[]) => { seen.push(["info", ...args]); };
        try {
            const log = new Logger("PinterestTool");
            log.error("e", 1);
            log.warn("w");
            log.info("i");
        } finally {
            Object.assign(console, saved);
        }
        assert.deepEqual(seen, [["error", "[PinterestTool]", "e", 1], ["warn", "[PinterestTool]", "w"], ["info", "[PinterestTool]", "i"]]);
    });

    it("sizes of the window keep his names", () => {
        assert.deepEqual(ModalSize, { SMALL: "small", MEDIUM: "medium", LARGE: "large", DYNAMIC: "dynamic" });
        assert.deepEqual(Toasts.Type, { MESSAGE: "message", SUCCESS: "success", FAILURE: "failure" });
    });
});

describe("React hooks of the host layer", () => {
    it("ask Discord's React at the moment they are called", () => {
        const calls: string[] = [];
        const { react } = fakeReact({
            useState: ((start: unknown) => { calls.push("useState"); return [start, () => undefined]; }) as never,
            useEffect: () => { calls.push("useEffect"); },
            useRef: initial => ({ current: initial }),
            useMemo: factory => factory(),
            useLayoutEffect: () => { calls.push("useLayoutEffect"); }
        });
        setReactSource(() => react);
        assert.equal(useState(5)[0], 5);
        useEffect(() => undefined, []);
        useLayoutEffect(() => undefined, []);
        assert.deepEqual(useRef(3), { current: 3 });
        assert.equal(useMemo(() => "made", []), "made");
        assert.deepEqual(calls, ["useState", "useEffect", "useLayoutEffect"]);
    });

    it("use the plain effect when this React has no layout effect", () => {
        const { react, calls } = fakeReact();
        setReactSource(() => react);
        useLayoutEffect(() => undefined, []);
        assert.deepEqual(calls, ["useEffect"]);
    });

    it("say which hook is missing instead of crashing somewhere else", () => {
        setReactSource(() => fakeReact().react);
        assert.throws(() => useRef(1), /no useRef/);
        assert.throws(() => useMemo(() => 1, []), /no useMemo/);
    });

    it("fail clearly while React is not found", () => {
        setReactSource(() => undefined);
        assert.throws(() => useState(1), /React was not found/);
    });
});

describe("the window pieces of the host layer", () => {
    it("draw the part that was bound, with the props they got", () => {
        setReactSource(() => fakeReact().react);
        bindHost(bindings());
        const asElement = (piece: unknown, props: Record<string, unknown>) => (piece as (props: Record<string, unknown>) => El)(props);
        assert.equal(asElement(ModalRoot, { size: "large" }).type, "root-part");
        assert.deepEqual(asElement(ModalRoot, { size: "large" }).props, { size: "large" });
        assert.equal(asElement(ModalHeader, {}).type, "header-part");
        assert.equal(asElement(ModalContent, {}).type, "content-part");
        assert.equal(asElement(ModalCloseButton, { onClick: 1 }).type, "close-part");
    });
});

// A page that is only as big as the host layer needs.
class FakeNode {
    className = "";
    children: FakeNode[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, Array<(event: unknown) => void>>();
    textContent = "";
    href = "";
    download = "";
    target = "";
    rel = "";
    src = "";
    alt = "";
    removed = false;
    clicks = 0;
    parent: FakeNode | undefined;
    get childElementCount() { return this.children.length; }
    constructor(readonly tag: string) { }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    append(child: FakeNode) { child.parent = this; this.children.push(child); }
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    click() { this.clicks++; }
    addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    fire(type: string, event: unknown = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

describe("toasts, clipboard, downloads, links and the picture preview", () => {
    const original = { document: Object.getOwnPropertyDescriptor(globalThis, "document"), navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"), setTimeout: globalThis.setTimeout };
    let body: FakeNode;
    let timers: Array<{ run(): void; ms: number; }>;
    let written: string[];
    let writeResult: Promise<void>;
    let docListeners: Map<string, Array<(event: unknown) => void>>;
    let removedListeners: string[];

    beforeEach(() => {
        body = new FakeNode("body");
        timers = [];
        written = [];
        writeResult = Promise.resolve();
        docListeners = new Map();
        removedListeners = [];
        const doc = {
            body,
            createElement: (tag: string) => new FakeNode(tag),
            querySelector: (selector: string) => {
                const wanted = selector.replace(".", "");
                return body.children.find(child => child.className === wanted) ?? null;
            },
            addEventListener: (type: string, listener: (event: unknown) => void) => { docListeners.set(type, [...(docListeners.get(type) ?? []), listener]); },
            removeEventListener: (type: string) => { removedListeners.push(type); }
        };
        Object.defineProperty(globalThis, "document", { value: doc, configurable: true, writable: true });
        Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: (text: string) => { written.push(text); return writeResult; } } }, configurable: true, writable: true });
        (globalThis as { setTimeout: unknown; }).setTimeout = ((run: () => void, ms: number) => { timers.push({ run, ms }); return 0; }) as never;
    });

    afterEach(() => {
        if (original.document) Object.defineProperty(globalThis, "document", original.document); else delete (globalThis as { document?: unknown; }).document;
        if (original.navigator) Object.defineProperty(globalThis, "navigator", original.navigator);
        globalThis.setTimeout = original.setTimeout;
    });

    it("shows a toast in one shared box and takes both away afterwards", () => {
        showToast("one", Toasts.Type.SUCCESS);
        showToast("two", Toasts.Type.FAILURE);
        showToast("three");
        const box = body.children[0];
        assert.equal(body.children.length, 1);
        assert.equal(box.className, "vc-pinterest-tool-toasts");
        assert.deepEqual(box.children.map(toast => toast.className), [
            "vc-pinterest-tool-toast vc-pinterest-tool-toast-success",
            "vc-pinterest-tool-toast vc-pinterest-tool-toast-failure",
            "vc-pinterest-tool-toast"
        ]);
        assert.deepEqual(box.children.map(toast => toast.textContent), ["one", "two", "three"]);
        assert.equal(box.children[0].attributes.get("role"), "status");
        assert.deepEqual(timers.map(timer => timer.ms), [3500, 3500, 3500]);
        assert.equal(TOAST_LIFETIME_MS, 3500);

        timers[0].run();
        assert.equal(box.removed, false);
        timers[1].run();
        assert.equal(box.removed, false);
        timers[2].run();
        assert.equal(box.removed, true);
    });

    it("copies the text and says so, or says it could not", async () => {
        copyWithToast("https://i.pinimg.com/a.jpg", "Image link copied.");
        await writeResult;
        await Promise.resolve();
        assert.deepEqual(written, ["https://i.pinimg.com/a.jpg"]);
        assert.equal(body.children[0].children[0].textContent, "Image link copied.");
        assert.match(body.children[0].children[0].className, /toast-success/);

        writeResult = Promise.reject(new Error("denied"));
        copyWithToast("x", "never shown");
        await writeResult.catch(() => undefined);
        await Promise.resolve();
        assert.equal(body.children[0].children[1].textContent, "Could not copy.");
        assert.match(body.children[0].children[1].className, /toast-failure/);
    });

    it("saves a file through a download link and releases the address later", () => {
        const created: string[] = [];
        const revoked: string[] = [];
        const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
        URL.createObjectURL = (() => { created.push("blob:x"); return "blob:x"; }) as never;
        URL.revokeObjectURL = ((address: string) => { revoked.push(address); }) as never;
        const links: FakeNode[] = [];
        const doc = globalThis.document as unknown as { createElement(tag: string): FakeNode; };
        const make = doc.createElement;
        doc.createElement = (tag: string) => { const node = make(tag); links.push(node); return node; };
        try {
            saveFile(new File(["x"], "pic.png", { type: "image/png" }));
            assert.equal(links[0].tag, "a");
            assert.equal(links[0].href, "blob:x");
            assert.equal(links[0].download, "pic.png");
            assert.equal(links[0].clicks, 1);
            assert.deepEqual(revoked, []);
            assert.equal(timers[0].ms, 10_000);
            timers[0].run();
            assert.deepEqual(revoked, ["blob:x"]);
        } finally {
            URL.createObjectURL = saved.create;
            URL.revokeObjectURL = saved.revoke;
        }
    });

    it("opens only https addresses, without giving the page access to the opener", () => {
        const links: FakeNode[] = [];
        const doc = globalThis.document as unknown as { createElement(tag: string): FakeNode; };
        const make = doc.createElement;
        doc.createElement = (tag: string) => { const node = make(tag); links.push(node); return node; };
        openExternal("http://www.pinterest.com/pin/1/");
        openExternal("javascript:alert(1)");
        openExternal("not an address");
        openExternal("");
        assert.equal(links.length, 0);
        openExternal("https://www.pinterest.com/pin/1/");
        assert.equal(links.length, 1);
        assert.equal(links[0].href, "https://www.pinterest.com/pin/1/");
        assert.equal(links[0].target, "_blank");
        assert.equal(links[0].rel, "noopener noreferrer");
        assert.equal(links[0].clicks, 1);
    });

    it("shows a picture full screen, loaded through the main process, and closes it on a click or Escape", async () => {
        const b = bindings();
        bindHost(b);
        openImageModal({ url: "https://i.pinimg.com/736x/a.jpg", original: "https://i.pinimg.com/originals/a.jpg" });
        const box = body.children[0];
        assert.equal(box.className, "vc-pinterest-tool-lightbox");
        assert.equal(box.children[0].alt, "");
        await new Promise(resolve => setImmediate(resolve));
        assert.match(box.children[0].src, /^blob:/);

        let stopped = 0;
        docListeners.get("keydown")![0]({ key: "Enter", stopPropagation: () => { stopped++; } });
        assert.equal(box.removed, false);
        assert.equal(stopped, 0);
        docListeners.get("keydown")![0]({ key: "Escape", stopPropagation: () => { stopped++; } });
        assert.equal(box.removed, true);
        assert.equal(stopped, 1);
        assert.deepEqual(removedListeners, ["keydown"]);

        openImageModal({ url: "https://i.pinimg.com/736x/b.jpg" });
        const second = body.children[0];
        second.fire("click");
        assert.equal(second.removed, true);
    });

    it("shows a picture that has only one address, and stops waiting for it when the preview is closed first", async () => {
        bindHost(bindings());
        openImageModal({ url: "https://i.pinimg.com/736x/a.jpg" });
        await new Promise(resolve => setImmediate(resolve));
        assert.match(body.children[0].children[0].src, /^blob:/);
        docListeners.get("keydown")![0]({ key: "Escape", stopPropagation: () => undefined });

        openImageModal({ url: "https://i.pinimg.com/736x/b.jpg" });
        const closing = body.children[0];
        docListeners.get("keydown")![1]({ key: "Escape", stopPropagation: () => undefined });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closing.children[0].src, "", "a closed preview is not filled in afterwards");
    });

    it("takes every picture address back when the plugin stops", async () => {
        const revoked: string[] = [];
        const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
        URL.createObjectURL = (() => "blob:one") as never;
        URL.revokeObjectURL = ((address: string) => { revoked.push(address); }) as never;
        try {
            bindHost(bindings());
            let got: string | null = null;
            loadPicture("https://i.pinimg.com/a.jpg", blob => { got = blob; });
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(got, "blob:one");
            assert.deepEqual(revoked, []);
            unbindHost();
            assert.deepEqual(revoked, ["blob:one"]);
        } finally {
            URL.createObjectURL = saved.create;
            URL.revokeObjectURL = saved.revoke;
        }
    });

    it("falls back to the smaller copy when the original cannot be had", async () => {
        const asked: string[] = [];
        bindHost(bindings({ native: { ...bindings().native, fetchMedia: async (url: string) => { asked.push(url); if (url.includes("originals")) throw new Error("no"); return { data: new ArrayBuffer(2), type: "image/png", filename: "a.png" }; } } as never }));
        openImageModal({ url: "https://i.pinimg.com/736x/a.jpg", original: "https://i.pinimg.com/originals/a.jpg" });
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(asked, ["https://i.pinimg.com/originals/a.jpg", "https://i.pinimg.com/736x/a.jpg"]);
        assert.match(body.children[0].children[0].src, /^blob:/);
    });

    it("keeps new pictures waiting while one the person picked is downloaded", async () => {
        const asked: string[] = [];
        bindHost(bindings({ native: { ...bindings().native, fetchMedia: async (url: string) => { asked.push(url); return { data: new ArrayBuffer(1), type: "image/png", filename: "x.png" }; } } as never }));
        holdPictures(true);
        loadPicture("https://i.pinimg.com/a.jpg", () => undefined);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(asked, []);
        holdPictures(false);
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(asked, ["https://i.pinimg.com/a.jpg"]);
        unbindHost();
        assert.doesNotThrow(() => { holdPictures(true); });
    });

    it("gives no picture before the plugin started", async () => {
        let answer: string | null | undefined;
        loadPicture("https://i.pinimg.com/a.jpg", blob => { answer = blob; });
        await Promise.resolve();
        assert.equal(answer, null);
    });

    it("carries the styles of the toasts and the preview", () => {
        assert.match(HOST_CSS, /\.vc-pinterest-tool-toasts/);
        assert.match(HOST_CSS, /\.vc-pinterest-tool-lightbox/);
        assert.match(HOST_CSS, /body\[data-pinterart-editing\] \.amiricord-modal-backdrop \{ visibility: hidden/);
    });
});

describe("the settings the way his screens read them", () => {
    afterEach(() => { pluginSettings.unbind(); });

    it("give the saved or default values of the keys asked for", () => {
        setReactSource(() => fakeReact().react);
        pluginSettings.bind(new SettingsClient({ schema: 1, plugins: { PinterestTool: { values: { colorTheme: "violet" } } } }, () => undefined), "PinterestTool");
        assert.deepEqual(settings.use(["colorTheme", "appearance"]), { colorTheme: "violet", appearance: "AUTO" });
        assert.equal(settings.store.customAccent, "#f59e0b");
        settings.store.colorTheme = "cyan";
        assert.equal(settings.store.colorTheme, "cyan");
    });

    it("redraw when a setting changes and stop listening when the screen goes away", () => {
        const effects: Array<() => void | (() => void)> = [];
        let bumps = 0;
        const results: number[] = [];
        const { react } = fakeReact({
            useState: ((start: number) => [start, (update: (count: number) => number) => { results.push(update(5)); bumps++; }]) as never,
            useEffect: run => { effects.push(run); }
        });
        setReactSource(() => react);
        pluginSettings.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "PinterestTool");
        settings.use(["appearance"]);
        assert.equal(effects.length, 1);
        const stop = effects[0]() as () => void;
        settings.store.appearance = "DARK";
        assert.equal(bumps, 1);
        assert.deepEqual(results, [6], "a change asks for a different count so the screen is drawn again");
        settings.store.appearance = "LIGHT";
        assert.equal(bumps, 2);
        stop();
        settings.store.appearance = "AUTO";
        assert.equal(bumps, 2);
    });
});
