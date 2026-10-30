/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import { CUSTOM_CSS_MAX, SAFE_MODE_NOTE } from "../src/plugins/Settings/customCss";
import { INTRO_TEXT, KEEP_AFTER_MS, makeCustomCssWindow } from "../src/plugins/Settings/CustomCssWindow";
import type { WindowParts } from "../src/plugins/Settings/PluginWindow";

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

function render(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(render);
    if (!isEl(node)) return node;
    if (typeof node.type === "function") {
        const children = node.children.length <= 1 ? node.children[0] : node.children;
        return render((node.type as (props: unknown) => unknown)({ ...node.props, ...(children === undefined ? {} : { children }) }));
    }
    return { ...node, children: node.children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined).map(render) };
}

function findAll(node: unknown, test: (el: El) => boolean, found: El[] = []): El[] {
    if (!isEl(node)) return found;
    if (test(node)) found.push(node);
    for (const child of node.children) findAll(child, test, found);
    return found;
}

function textOf(node: unknown): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!isEl(node)) return "";
    return node.children.map(textOf).join("");
}

const hasClass = (el: El, name: string) => typeof el.props.className === "string" && el.props.className.split(" ").includes(name);

beforeEach(() => { mock.timers.enable({ apis: ["setTimeout"] }); });
afterEach(() => {
    mock.timers.reset();
    setReactSource(undefined);
});

const part = (className: string) => ({ children }: { children?: unknown; }) => ({ type: "div", props: { className }, children: [children].flat() });
const parts: WindowParts = {
    ModalRoot: part("root"), ModalHeader: part("header"), ModalContent: part("content"), ModalFooter: part("footer"),
    ModalCloseButton: ({ onClick }) => ({ type: "button", props: { className: "close", onClick }, children: ["x"] })
};

interface Draw {
    saved?: { on: boolean; text: string; };
    safe?: boolean;
    /** What `save` answers: a sentence for a refusal, null for success. */
    refuse?: string | null;
    /** The state a later render would start with: the draft and the note. */
    state?: { draft?: string; note?: string | null; };
}

function draw(over: Draw = {}) {
    const saved = over.saved ?? { on: true, text: "a { color: red }" };
    const saves: string[] = [];
    const switches: boolean[] = [];
    const closes: number[] = [];
    const initial = [over.state?.draft ?? saved.text, over.state?.note ?? null];
    const bySetter: unknown[][] = initial.map(() => []);
    let slot = 0;
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((_start: unknown) => { const index = slot++; return [initial[index], (value: unknown) => { bySetter[index].push(value); }]; }) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    setReactSource(() => react);
    const Window = makeCustomCssWindow({
        // The switch lives in the main tab: what was asked of it last is what is read.
        read: () => ({ on: switches.length > 0 ? switches[switches.length - 1] : saved.on, text: saved.text }),
        save: text => { saves.push(text); return over.refuse ?? null; },
        setOn: on => { switches.push(on); },
        safeMode: () => over.safe ?? false,
        parts
    });
    const tree = render(Window({ onClose: () => { closes.push(1); } }));
    return { tree, saves, switches, closes, bySetter };
}

const buttonByText = (tree: unknown, text: string) => findAll(tree, el => el.type === "button" && textOf(el) === text)[0];
const press = (el: El) => (el.props.onClick as () => void)();
const editor = (tree: unknown) => findAll(tree, el => el.type === "textarea")[0];
const type = (tree: unknown, value: string) => (editor(tree).props.onChange as (event: { target: { value: string; }; }) => void)({ target: { value } });

describe("the Custom CSS window", () => {
    it("shows the saved sheet in a plain text box, with the explanation and the count, and has a Close button and no Save", () => {
        const { tree } = draw();
        const box = editor(tree);
        assert.equal(box.props.value, "a { color: red }");
        assert.equal(box.props["aria-label"], "Custom CSS");
        assert.equal(box.props.spellCheck, false);
        assert.ok(textOf(tree).includes(INTRO_TEXT));
        assert.ok(textOf(tree).includes(`16 / ${CUSTOM_CSS_MAX.toLocaleString("en-US")}`));
        assert.equal(findAll(tree, el => el.props.role === "alert").length, 0);
        assert.equal(findAll(tree, el => el.type === "button" && textOf(el) === "Save").length, 0, "there is no Save: what is typed is kept by itself");
        assert.equal(findAll(tree, el => el.type === "button" && textOf(el) === "Close").length, 1);
    });

    it("has no switch of its own: turning Custom CSS on and off is done in the main tab", () => {
        const { tree } = draw({ saved: { on: false, text: "" } });
        assert.equal(findAll(tree, el => el.props.role === "switch").length, 0);
        assert.ok(!textOf(tree).includes("Apply my CSS"));
    });

    it("says so when safe mode is on, because nothing will show until Discord starts normally", () => {
        assert.ok(textOf(draw({ safe: true }).tree).includes(SAFE_MODE_NOTE));
        assert.ok(!textOf(draw({ safe: false }).tree).includes(SAFE_MODE_NOTE));
    });

    it("keeps what is typed after a short pause, and not before", () => {
        const { tree, saves, bySetter } = draw();
        type(tree, "b { color: blue }");
        assert.deepEqual(bySetter[0], ["b { color: blue }"]);
        assert.deepEqual(saves, [], "not at the key itself");
        mock.timers.tick(KEEP_AFTER_MS - 1);
        assert.deepEqual(saves, []);
        mock.timers.tick(1);
        assert.deepEqual(saves, ["b { color: blue }"]);
    });

    it("writes only the last text when the person keeps typing, never one write per letter", () => {
        const { tree, saves } = draw();
        type(tree, "b");
        mock.timers.tick(100);
        type(tree, "b {");
        mock.timers.tick(100);
        type(tree, "b { color: blue }");
        mock.timers.tick(KEEP_AFTER_MS);
        assert.deepEqual(saves, ["b { color: blue }"]);
        mock.timers.tick(1000);
        assert.deepEqual(saves, ["b { color: blue }"], "nothing is written twice");
    });

    it("turns Custom CSS on at once when something is typed while it was off, only once while typing goes on, and never for an empty sheet or when it was already on", () => {
        const off = draw({ saved: { on: false, text: "" } });
        type(off.tree, "a { color: red }");
        type(off.tree, "a { color: red; }");
        assert.deepEqual(off.switches, [true]);
        const already = draw({ saved: { on: true, text: "" } });
        type(already.tree, "a {}");
        assert.deepEqual(already.switches, []);
        const blank = draw({ saved: { on: false, text: "x" } });
        type(blank.tree, "  \n");
        assert.deepEqual(blank.switches, []);
        mock.timers.tick(KEEP_AFTER_MS);
        assert.deepEqual(blank.saves, ["  \n"], "emptying the box is kept too, so the sheet can be cleared");
    });

    it("keeps nothing and turns nothing on for a sheet the rules refuse, and says why in the footer, next to Close", () => {
        const off = draw({ saved: { on: false, text: "" } });
        type(off.tree, "@import 'x.css';");
        mock.timers.tick(KEEP_AFTER_MS);
        assert.deepEqual(off.saves, []);
        assert.deepEqual(off.switches, []);
        const bad = draw({ state: { draft: "@import 'x.css';" } });
        const footer = findAll(bad.tree, el => hasClass(el, "footer"))[0];
        const alert = findAll(footer, el => el.props.role === "alert");
        assert.equal(alert.length, 1);
        assert.match(textOf(alert[0]), /@import is not allowed/);
        assert.equal(findAll(findAll(bad.tree, el => hasClass(el, "content"))[0], el => el.props.role === "alert").length, 0, "not below the box, where it could be out of sight");
        const long = draw({ state: { draft: "a".repeat(CUSTOM_CSS_MAX + 1) } });
        assert.match(textOf(findAll(long.tree, el => el.props.role === "alert")[0]), /longer than 30,000/);
    });

    it("shows the sentence the store gives back when it refuses a sheet", () => {
        const { tree, bySetter } = draw({ refuse: "must be at most 30000 characters" });
        type(tree, "b {}");
        mock.timers.tick(KEEP_AFTER_MS);
        assert.deepEqual(bySetter[1], [null, "must be at most 30000 characters"]);
        const shown = draw({ state: { note: "must be at most 30000 characters" } });
        assert.match(textOf(findAll(shown.tree, el => el.props.role === "alert")[0]), /must be at most 30000/);
    });

    it("keeps what is waiting when the window is closed, so closing in the pause loses nothing, and does not write it a second time", () => {
        const { tree, saves, closes, bySetter } = draw();
        type(tree, "b { color: blue }");
        press(buttonByText(tree, "Close"));
        assert.deepEqual(saves, ["b { color: blue }"]);
        assert.equal(closes.length, 1);
        mock.timers.tick(1000);
        assert.deepEqual(saves, ["b { color: blue }"]);
        assert.deepEqual(bySetter[1], [null], "nothing is shown to a window that is closing");
        const cross = draw();
        type(cross.tree, "c {}");
        press(findAll(cross.tree, el => hasClass(el, "close"))[0]);
        assert.deepEqual(cross.saves, ["c {}"]);
        assert.equal(cross.closes.length, 1);
    });

    it("closes at once and writes nothing when nothing was typed", () => {
        const { tree, saves, closes } = draw();
        press(buttonByText(tree, "Close"));
        assert.equal(closes.length, 1);
        assert.deepEqual(saves, []);
    });

    it("writes four spaces at the cursor when Tab is pressed in the box, keeps it like any typing, and leaves the focus alone for Shift+Tab, Ctrl+Tab and every other key", () => {
        const { tree, bySetter, saves } = draw();
        const carets: number[] = [];
        let prevented = 0;
        const pressKey = (over: Record<string, unknown>) => (editor(tree).props.onKeyDown as (event: unknown) => void)({
            key: "Tab", preventDefault: () => { prevented++; },
            target: { value: "a{}", selectionStart: 1, selectionEnd: 1, setSelectionRange: (start: number) => { carets.push(start); } }, ...over
        });
        pressKey({});
        assert.equal(prevented, 1);
        assert.deepEqual(bySetter[0], ["a    {}"]);
        assert.deepEqual(bySetter[1], [null], "the last note is cleared, as for any typing");
        mock.timers.tick(KEEP_AFTER_MS);
        assert.deepEqual(carets, [5], "the cursor goes back after the spaces");
        assert.deepEqual(saves, ["a    {}"]);
        for (const other of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { key: "a" }, { key: "Enter" }]) pressKey(other);
        assert.equal(prevented, 1, "nothing else is taken");
        assert.equal(bySetter[0].length, 1);
    });
});
