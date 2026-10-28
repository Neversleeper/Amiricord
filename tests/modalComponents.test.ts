/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FindersFor, ReactLike } from "../src/api/common";
import { COMPONENT_NAMES, COMPONENT_SNIPPETS, declareCommon } from "../src/api/discordComponents";
import { type DialogBox, type FallbackComponents, makeFallbackComponents, type ModalDocument } from "../src/api/fallbackComponents";
import { FALLBACK_CSS } from "../src/api/fallbackStyles";
import type { Finder } from "../src/webpack/finders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests look at props whose shapes differ per component
interface FakeElement { type: unknown; props: Record<string, any>; children: unknown[]; }
const el = (value: unknown) => value as FakeElement;

type Effect = { run: () => void | (() => void); deps?: readonly unknown[]; };

/** A React that keeps the effects a component asked for, so a test can run them and their cleanups by hand. */
function fakeReact() {
    const effects: Effect[] = [];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies FakeElement),
        Fragment: Symbol("fragment"),
        useState: initial => [typeof initial === "function" ? (initial as () => never)() : initial, () => undefined],
        useEffect: (run, deps) => { effects.push({ run, deps }); },
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    };
    return { react, effects };
}

/** A document that keeps its key listeners and can press a key. */
function fakeDocument(activeElement?: unknown) {
    const listeners = new Set<(event: { key: string; }) => void>();
    const page: ModalDocument = {
        addEventListener: (_type, listener) => { listeners.add(listener); },
        removeEventListener: (_type, listener) => { listeners.delete(listener); },
        activeElement
    };
    return { page, listeners, press: (key: string) => { for (const listener of [...listeners]) listener({ key }); } };
}

function modal(options: { document?: ModalDocument | undefined; } = {}) {
    const { react, effects } = fakeReact();
    const parts = makeFallbackComponents(react, () => options.document);
    return { parts, effects };
}

/** The window sitting inside Discord's own dialog box, which carries Discord's focus lock. */
describe("ModalRoot inside Discord's dialog box", () => {
    const dialogBox = (() => undefined) as unknown as DialogBox;

    function withBox(document?: ModalDocument) {
        const { react, effects } = fakeReact();
        const parts = makeFallbackComponents(react, () => document, dialogBox);
        return { parts, effects };
    }

    it("draws the window as Discord's box, with a ref OBJECT (the lock reads `current`), our class and the label, inside our backdrop", () => {
        const { parts } = withBox();
        const backdrop = el(parts.ModalRoot({ size: "large", label: "Plugin", children: "content" }));
        assert.equal(backdrop.props.className, "amiricord-modal-backdrop");
        const box = el(backdrop.children[0]);
        assert.equal(box.type, dialogBox);
        assert.equal(box.props.className, "amiricord-modal amiricord-modal-large");
        assert.equal(box.props["aria-label"], "Plugin");
        assert.equal(typeof box.props.ref, "object");
        assert.equal(box.props.ref.current, null);
        assert.deepEqual(box.children, ["content"]);
        assert.equal(box.props.role, undefined, "the box sets the role itself");
    });

    it("still closes on Escape and on a click on the backdrop", () => {
        const doc = fakeDocument();
        const { parts, effects } = withBox(doc.page);
        let closed = 0;
        const backdrop = el(parts.ModalRoot({ onClose: () => { closed++; } }));
        const cleanup = effects[0].run() as () => void;
        doc.press("Escape");
        backdrop.props.onMouseDown({ target: 1, currentTarget: 1 });
        backdrop.props.onMouseDown({ target: 1, currentTarget: 2 });
        assert.equal(closed, 2);
        cleanup();
    });

    it("takes the focus once, from an effect that runs on mount, unless it is already inside the box", () => {
        const inside = {};
        const doc = fakeDocument(inside);
        const { parts, effects } = withBox(doc.page);
        const box = el(el(parts.ModalRoot({})).children[0]);
        assert.equal(effects.length, 2, "the key listener and the focus");
        assert.deepEqual(effects[1].deps, [], "it does not run again at a redraw");
        let focused = 0;
        assert.doesNotThrow(() => { effects[1].run(); }, "no element yet, nothing to focus");
        box.props.ref.current = { focus: () => { focused++; }, contains: (other: unknown) => other === inside };
        effects[1].run();
        assert.equal(focused, 0, "the focus is already inside");
        box.props.ref.current = { focus: () => { focused++; }, contains: () => false };
        effects[1].run();
        assert.equal(focused, 1);
    });

    it("leaves the plain window alone when there is no dialog box (no extra effect, the callback ref as before)", () => {
        const { react, effects } = fakeReact();
        let states = 0;
        const counting: ReactLike = { ...react, useState: ((initial: unknown) => { states++; return react.useState(initial as never); }) as ReactLike["useState"] };
        const plain = makeFallbackComponents(counting, () => undefined);
        const box = el(el(plain.ModalRoot({})).children[0]);
        assert.equal(states, 0, "no state is kept for a box that is not there");
        assert.equal(box.type, "div");
        assert.equal(typeof box.props.ref, "function");
        assert.equal(effects.length, 1);
    });
});

describe("fallback ModalRoot", () => {
    it("draws a backdrop with a dialog inside it, with the label, the right role and a size", () => {
        const { parts } = modal();
        const backdrop = el(parts.ModalRoot({ size: "large", label: "Pinterest", children: "content" }));
        assert.equal(backdrop.props.className, "amiricord-modal-backdrop");
        const dialog = el(backdrop.children[0]);
        assert.equal(dialog.props.className, "amiricord-modal amiricord-modal-large");
        assert.equal(dialog.props.role, "dialog");
        assert.equal(dialog.props["aria-modal"], true);
        assert.equal(dialog.props["aria-label"], "Pinterest");
        assert.equal(dialog.props.tabIndex, -1);
        assert.deepEqual(dialog.children, ["content"]);
    });

    it("lets a plugin colour and direct its own window: class names, inline style and text direction go on the dialog", () => {
        const { parts } = modal();
        const style = { "--pt-accent": "#e60023" };
        const dialog = el(el(parts.ModalRoot({ size: "large", className: "vc-pinterest-tool-profile-modal", style, dir: "rtl" })).children[0]);
        assert.equal(dialog.props.className, "amiricord-modal amiricord-modal-large vc-pinterest-tool-profile-modal");
        assert.equal(dialog.props.style, style);
        assert.equal(dialog.props.dir, "rtl");
        const plain = el(el(parts.ModalRoot({})).children[0]);
        assert.equal(plain.props.className, "amiricord-modal amiricord-modal-medium", "no extra class, no trailing space");
        assert.equal(plain.props.style, undefined);
        assert.equal(plain.props.dir, undefined);
    });

    it("lets a plugin's own class sizes the header, content and footer", () => {
        const { parts } = modal();
        assert.equal(el(parts.ModalHeader({ className: "mine" })).props.className, "amiricord-modal-header mine");
        assert.equal(el(parts.ModalContent({ className: "mine" })).props.className, "amiricord-modal-content mine");
        assert.equal(el(parts.ModalFooter({ className: "mine" })).props.className, "amiricord-modal-footer mine");
        assert.equal(el(parts.ModalHeader({})).props.className, "amiricord-modal-header");
        assert.equal(el(parts.ModalContent({})).props.className, "amiricord-modal-content");
        assert.equal(el(parts.ModalFooter({})).props.className, "amiricord-modal-footer");
    });

    it("is medium by default and falls back to medium for a size it does not know", () => {
        const { parts } = modal();
        assert.match(el(el(parts.ModalRoot({})).children[0]).props.className, /amiricord-modal-medium$/);
        assert.match(el(el(parts.ModalRoot({ size: "nope" as never })).children[0]).props.className, /amiricord-modal-medium$/);
        for (const size of ["small", "medium", "large", "dynamic"] as const) assert.match(el(el(parts.ModalRoot({ size })).children[0]).props.className, new RegExp(`amiricord-modal-${size}$`));
    });

    it("closes on a click on the backdrop itself, never on a click inside the window", () => {
        const { parts } = modal();
        let closed = 0;
        const backdrop = el(parts.ModalRoot({ onClose: () => { closed++; } }));
        const inner = {};
        backdrop.props.onMouseDown({ target: inner, currentTarget: backdrop });
        assert.equal(closed, 0);
        backdrop.props.onMouseDown({ target: backdrop, currentTarget: backdrop });
        assert.equal(closed, 1);
        assert.doesNotThrow(() => el(parts.ModalRoot({})).props.onMouseDown({ target: 1, currentTarget: 1 }), "without onClose a click does nothing");
    });

    it("closes on Escape and on no other key, and stops listening when it goes away", () => {
        const doc = fakeDocument();
        const { parts, effects } = modal({ document: doc.page });
        let closed = 0;
        const onClose = () => { closed++; };
        parts.ModalRoot({ onClose });
        assert.equal(effects.length, 1);
        assert.deepEqual(effects[0].deps, [onClose], "the listener is renewed when onClose changes");
        const cleanup = effects[0].run() as () => void;
        assert.equal(doc.listeners.size, 1);
        doc.press("a");
        doc.press("Enter");
        assert.equal(closed, 0);
        doc.press("Escape");
        assert.equal(closed, 1);
        cleanup();
        assert.equal(doc.listeners.size, 0);
        doc.press("Escape");
        assert.equal(closed, 1);
    });

    it("listens for nothing when there is no onClose or no page", () => {
        const doc = fakeDocument();
        const withoutClose = modal({ document: doc.page });
        withoutClose.parts.ModalRoot({});
        assert.equal(withoutClose.effects[0].run(), undefined);
        assert.equal(doc.listeners.size, 0);
        const withoutPage = modal({ document: undefined });
        withoutPage.parts.ModalRoot({ onClose: () => undefined });
        assert.equal(withoutPage.effects[0].run(), undefined);
    });

    it("takes the focus when it appears, unless the focus is already inside it, and ignores the removal", () => {
        const inside = {};
        const doc = fakeDocument(inside);
        const { parts } = modal({ document: doc.page });
        const focus = el(el(parts.ModalRoot({})).children[0]).props.ref as (element: unknown) => void;
        let focused = 0;
        focus({ focus: () => { focused++; }, contains: (other: unknown) => other === inside });
        assert.equal(focused, 0, "the focus is already inside");
        focus({ focus: () => { focused++; }, contains: () => false });
        assert.equal(focused, 1);
        assert.doesNotThrow(() => { focus(null); });
    });

    it("uses the same function to take the focus at every draw, so a redraw does not steal it", () => {
        const { parts } = modal();
        const first = el(el(parts.ModalRoot({})).children[0]).props.ref;
        const second = el(el(parts.ModalRoot({ size: "small" })).children[0]).props.ref;
        assert.equal(first, second);
    });

    it("reads the page's document when none is given", () => {
        const { react } = fakeReact();
        const doc = fakeDocument();
        const globals = globalThis as { document?: ModalDocument; };
        const before = globals.document;
        globals.document = doc.page;
        try {
            const parts = makeFallbackComponents(react);
            const effects: Effect[] = [];
            const withEffects = makeFallbackComponents({ ...react, useEffect: (run, deps) => { effects.push({ run, deps }); } });
            withEffects.ModalRoot({ onClose: () => undefined });
            effects[0].run();
            assert.equal(doc.listeners.size, 1);
            void parts;
        } finally {
            globals.document = before;
        }
    });
});

describe("the other window pieces", () => {
    it("have a class each to style, and the close button has a name for screen readers and calls its handler", () => {
        const { parts } = modal();
        assert.equal(el(parts.ModalHeader({ children: "t" })).props.className, "amiricord-modal-header");
        assert.equal(el(parts.ModalContent({ children: "c" })).props.className, "amiricord-modal-content");
        assert.equal(el(parts.ModalFooter({ children: "f" })).props.className, "amiricord-modal-footer");
        const close = el(parts.ModalCloseButton({ onClick: () => { clicked++; } }));
        let clicked = 0;
        assert.equal(close.type, "button");
        assert.equal(close.props.type, "button");
        assert.equal(close.props["aria-label"], "Close");
        close.props.onClick();
        assert.equal(clicked, 1);
        assert.doesNotThrow(() => el(parts.ModalCloseButton({})).props.onClick());
        assert.deepEqual(el(parts.ModalHeader({ children: "t" })).children, ["t"]);
    });

    it("every class they use has a rule in the styles", () => {
        const { parts } = modal();
        const used = new Set<string>();
        const walk = (value: unknown) => {
            if (typeof value !== "object" || value === null) return;
            const element = value as FakeElement;
            String(element.props?.className ?? "").split(" ").filter(Boolean).forEach(name => used.add(name));
            element.children?.forEach(walk);
        };
        [parts.ModalRoot({ size: "small" }), parts.ModalRoot({ size: "medium" }), parts.ModalRoot({ size: "large" }), parts.ModalRoot({ size: "dynamic" }),
            parts.ModalHeader({}), parts.ModalContent({}), parts.ModalFooter({}), parts.ModalCloseButton({})].forEach(walk);
        assert.ok(used.size >= 9);
        for (const name of used) assert.ok(new RegExp(`\\.${name}(?![\\w-])`).test(FALLBACK_CSS), `no style for .${name}`);
    });

    it("styles a window over everything, centred, that keeps to the screen and scrolls its content", () => {
        const rule = (selector: string) => FALLBACK_CSS.split("\n").find(line => line.startsWith(selector + " {")) ?? "";
        assert.match(rule(".amiricord-modal-backdrop"), /position: fixed; inset: 0; z-index: 1002;/);
        assert.match(rule(".amiricord-modal-backdrop"), /align-items: center; justify-content: center/);
        assert.match(rule(".amiricord-modal"), /max-height: 100%/);
        assert.match(rule(".amiricord-modal-content"), /overflow-y: auto/);
        assert.match(rule(".amiricord-modal-backdrop"), /pointer-events: auto;/, "Discord's layer may not take clicks itself, so the window must");
        assert.match(rule(".amiricord-modal"), /pointer-events: auto;/);
        assert.match(rule(".amiricord-modal-backdrop"), /background: rgba\(0, 0, 0, \.35\)/, "Discord's own layer already darkens the page");
        assert.match(rule(".amiricord-modal"), /var\(--modal-background, var\(--background-primary,/);
    });
});

describe("window pieces in the common layer", () => {
    const finderOf = <T>(description: string): Finder<T> => ({ description, get: () => undefined, require: () => { throw new Error("missing"); }, ready: () => Promise.reject(new Error("missing")) });
    function setup() {
        const asked: string[] = [];
        const { react } = fakeReact();
        const finders = {
            byProps: (...args: string[]) => { asked.push(`props:${args.join("|")}`); return { ...finderOf("react"), get: () => react } as unknown as Finder<unknown>; },
            byCode: (...args: string[]) => { asked.push(`code:${args.join("|")}`); return finderOf(`code:${args.join("|")}`); },
            componentByCode: (...args: string[]) => { asked.push(`component:${args.join("|")}`); return finderOf(`component:${args.join("|")}`); }
        } as unknown as FindersFor;
        const misses: string[] = [];
        return { parts: declareCommon(finders, name => misses.push(name)), asked, misses };
    }

    it("gives our own window pieces once React exists, and tells once for each that Discord's was not used", () => {
        const { parts, misses } = setup();
        const names = ["ModalRoot", "ModalHeader", "ModalContent", "ModalFooter", "ModalCloseButton"] as const;
        for (const name of names) {
            assert.equal(typeof parts[name].get(), "function", name);
            assert.equal(parts[name].usingFallback(), true);
            parts[name].get();
        }
        assert.deepEqual(misses, [...names]);
    });

    it("looks up nothing for them in Discord's code, so a wrong guess can never put another component in a window", () => {
        const { parts, asked } = setup();
        parts.ModalRoot.get();
        parts.ModalFooter.get();
        const known = Object.values(COMPONENT_SNIPPETS).map(snippets => `component:${snippets.join("|")}`);
        assert.deepEqual(asked.filter(question => !question.startsWith("props:") && !known.includes(question)), [], "only Button, Text, Heading and the dialog box have snippets");
        assert.equal(Object.keys(COMPONENT_SNIPPETS).some(name => name.startsWith("Modal")), false);
    });

    it("lists the components a plugin may ask for, each one declared", () => {
        const { parts } = setup();
        assert.deepEqual([...COMPONENT_NAMES], ["Button", "Text", "Heading", "Switch", "TextInput", "Select", "ModalRoot", "ModalHeader", "ModalContent", "ModalFooter", "ModalCloseButton"]);
        for (const name of COMPONENT_NAMES) assert.equal(typeof (parts as unknown as Record<string, { get(): unknown; }>)[name].get, "function", name);
    });

    it("gives each window piece its own fallback, not another one's", () => {
        const { parts } = setup();
        const classes = { ModalRoot: "amiricord-modal-backdrop", ModalHeader: "amiricord-modal-header", ModalContent: "amiricord-modal-content", ModalFooter: "amiricord-modal-footer" } as const;
        for (const [name, className] of Object.entries(classes)) {
            const component = parts[name as keyof typeof classes].get() as (props: object) => unknown;
            assert.equal(el(component({})).props.className, className, name);
        }
    });

    it("has a fallback for every name in the list", () => {
        const { react } = fakeReact();
        const built = makeFallbackComponents(react) as FallbackComponents;
        for (const name of COMPONENT_NAMES) assert.equal(typeof built[name], "function", name);
    });
});
