/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { setReactSource } from "../src/api/jsxRuntime";
import type { EnginePluginContext } from "../src/renderer/engine";
import plugin from "../src/testcordplugins/PinterestTool/index";
import { DataStore, ModalRoot, ReactDOMPortal } from "../src/testcordplugins/PinterestTool/pinterart/host";
import { PINTEREST_CSS, PINTEREST_CSS_NAME } from "../src/testcordplugins/PinterestTool/pinterart/styles";
import manifest from "../src/testcordplugins/PinterestTool/plugin.json";

const names = ["document", "Element", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame"];
const saved = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

/** What the focus guard looks at: a target that says whether it is inside our window. */
class FakeElement {
    constructor(private readonly insideWindow: boolean) {}
    closest(selector: string) { return this.insideWindow && selector === ".amiricord-modal-backdrop" ? this : null; }
}

interface Page {
    listeners: Map<string, Array<(event: unknown) => void>>;
    removed: string[];
    observers: Array<{ observed: boolean; disconnected: boolean; }>;
    frames: Array<() => void>;
    cancelled: number[];
}

function fakePage(): Page {
    const page: Page = { listeners: new Map(), removed: [], observers: [], frames: [], cancelled: [] };
    define("document", {
        body: {},
        addEventListener: (type: string, listener: (event: unknown) => void) => { page.listeners.set(type, [...(page.listeners.get(type) ?? []), listener]); },
        removeEventListener: (type: string) => { page.removed.push(type); },
        querySelectorAll: () => []
    });
    define("Element", FakeElement);
    define("MutationObserver", class {
        state = { observed: false, disconnected: false };
        constructor() { page.observers.push(this.state); }
        observe() { this.state.observed = true; }
        disconnect() { this.state.disconnected = true; }
    });
    define("requestAnimationFrame", (run: () => void) => { page.frames.push(run); return page.frames.length; });
    define("cancelAnimationFrame", (id: number) => { page.cancelled.push(id); });
    return page;
}

function fakeContext(portal: unknown = { createPortal: (children: unknown, container: unknown) => ({ portal: children, container }) }) {
    const styles: Array<{ css: string; name?: string; }> = [];
    const opened: unknown[] = [];
    const stored = new Map<string, unknown>();
    const dispatched: unknown[] = [];
    const reported: string[] = [];
    const ctx = {
        finders: { byProps: () => ({ get: () => portal ?? undefined }) },
        common: { FluxDispatcher: { get: () => ({ dispatch: (action: unknown) => { dispatched.push(action); } }) } },
        components: Object.fromEntries(["ModalRoot", "ModalHeader", "ModalContent", "ModalFooter", "ModalCloseButton"].map(name => [name, { get: () => name }])),
        storage: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value); } },
        native: { call: async () => undefined },
        modals: { open: (render: unknown) => { opened.push(render); return "key"; }, close: () => undefined, closeAll: () => undefined },
        addStyle: (css: string, name?: string) => { styles.push({ css, name }); return { remove: () => undefined }; },
        reportError: (source: string) => { reported.push(source); }
    };
    return { ctx: ctx as unknown as EnginePluginContext, styles, opened, stored, dispatched, reported };
}

afterEach(() => {
    for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
});

const key = (extra: Record<string, unknown> = {}) => ({ key: "P", ctrlKey: true, shiftKey: true, preventDefault: () => { prevented++; }, ...extra });
let prevented = 0;

describe("Pinterest Tool as a plugin", () => {
    afterEach(() => { plugin.stop?.(undefined as never); });

    it("starts by adding its styles, watching Discord's dialogs and listening for Ctrl+Shift+P, and contacts nobody", async () => {
        const page = fakePage();
        const setup = fakeContext();
        plugin.start!(setup.ctx);
        assert.deepEqual(setup.styles.map(style => style.name), ["pinterart-host", PINTEREST_CSS_NAME]);
        assert.equal(setup.styles[1].css, PINTEREST_CSS);
        assert.equal(page.observers.length, 1);
        assert.equal(page.observers[0].observed, true);
        assert.equal(page.frames.length, 1, "one scan of the open dialogs is queued");
        assert.deepEqual([...page.listeners.keys()].sort(), ["focusin", "focusout", "keydown", "pointerdown"]);
        // The host layer is ready: its storage is the plugin's.
        await DataStore.set("k", 1);
        assert.equal(setup.stored.get("k"), 1);
        assert.deepEqual(setup.opened, []);
    });

    it("draws a menu where it is when react-dom's portal cannot be found, and through the portal when it can", () => {
        fakePage();
        plugin.start!(fakeContext(null).ctx);
        assert.equal(ReactDOMPortal.createPortal("menu", "box"), "menu");
        plugin.stop!(undefined as never);
        fakePage();
        plugin.start!(fakeContext().ctx);
        assert.deepEqual(ReactDOMPortal.createPortal("menu", "box"), { portal: "menu", container: "box" });
    });

    it("asks for the window pieces when the window is drawn, because React may not exist yet when the plugin starts", () => {
        fakePage();
        const setup = fakeContext();
        let ready: unknown;
        (setup.ctx.components as unknown as Record<string, { get(): unknown; }>).ModalRoot = { get: () => ready };
        plugin.start!(setup.ctx);
        setReactSource(() => ({ createElement: (type: unknown) => ({ type }), Fragment: Symbol("f") }) as never);
        try {
            assert.equal((ModalRoot({}) as { type: unknown; }).type, undefined);
            ready = "late root";
            assert.equal((ModalRoot({}) as { type: unknown; }).type, "late root");
        } finally {
            setReactSource(undefined);
        }
    });

    it("opens the window with the shortcut and with nothing else", () => {
        const page = fakePage();
        const setup = fakeContext();
        plugin.start!(setup.ctx);
        prevented = 0;
        const onKey = page.listeners.get("keydown")![0];
        onKey(key({ key: "x" }));
        onKey(key({ ctrlKey: false }));
        onKey(key({ shiftKey: false }));
        onKey(key({ altKey: true }));
        onKey(key({ repeat: true }));
        assert.equal(setup.opened.length, 0);
        assert.equal(prevented, 0);
        onKey(key());
        assert.equal(setup.opened.length, 1);
        assert.equal(prevented, 1);
    });

    it("does not let Discord's focus guard see focus that moves inside our window, and lets everything else through", () => {
        const page = fakePage();
        plugin.start!(fakeContext().ctx);
        for (const type of ["focusin", "focusout"]) {
            const guard = page.listeners.get(type)![0];
            const stopped: string[] = [];
            const event = (target: unknown) => ({ target, stopPropagation: () => { stopped.push(type); } });
            guard(event(new FakeElement(true)));
            assert.equal(stopped.length, 1, `${type} inside the window is kept from Discord`);
            guard(event(new FakeElement(false)));
            guard(event({}));
            guard(event(null));
            assert.equal(stopped.length, 1, `${type} anywhere else goes on`);
        }
    });

    it("stops listening, stops watching and lets go of the host layer", async () => {
        const page = fakePage();
        const setup = fakeContext();
        plugin.start!(setup.ctx);
        plugin.stop!(undefined as never);
        assert.ok(page.removed.includes("keydown"));
        assert.ok(page.removed.includes("pointerdown"));
        assert.ok(page.removed.includes("focusin") && page.removed.includes("focusout"));
        assert.equal(page.observers[0].disconnected, true);
        assert.deepEqual(page.cancelled, [1], "the queued scan is cancelled");
        await assert.rejects(DataStore.get("k"), /not started/);
        // A second stop does nothing.
        plugin.stop!(undefined as never);
    });
});

describe("the manifest of the plugin", () => {
    it("declares what the interface really does", () => {
        assert.deepEqual(manifest.permissions.system, { clipboard: true, openExternal: true });
        assert.deepEqual(manifest.permissions.native.functions, ["fetchMedia", "search", "warmUp"]);
        assert.deepEqual(manifest.secrets, ["pinterestCookie"]);
        assert.ok(manifest.credits.some(credit => /Pinterart/.test(credit.name) && /szcx404/.test(credit.name) && /szaleniec1327/.test(credit.name)));
        assert.ok(manifest.permissions.network.every(rule => rule.from === "main"));
    });
});
