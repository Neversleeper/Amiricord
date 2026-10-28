/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import { BUILT_IN_PRESETS, EDITOR_LIMITS, NEUTRAL, type Preset } from "../src/testcordplugins/PinterestTool/editorModel";
import { EditorSession } from "../src/testcordplugins/PinterestTool/editorSession";
import { ARROW_STEP, EditorView, OUTPUT_OPTIONS, SLIDERS } from "../src/testcordplugins/PinterestTool/EditorView";
import { editorKindFor, PinterestWindow, type WindowParts } from "../src/testcordplugins/PinterestTool/PinterestWindow";
import { ThumbLoader } from "../src/testcordplugins/PinterestTool/thumbs";
import type { PinterestImageResult } from "../src/testcordplugins/PinterestTool/types";
import { createWindowOpener, pageTools } from "../src/testcordplugins/PinterestTool/window";
import { type SessionLibrary, WindowSession } from "../src/testcordplugins/PinterestTool/windowSession";
import { WINDOW_CSS } from "../src/testcordplugins/PinterestTool/windowStyles";

interface El { type: unknown; props: Record<string, any>; children: unknown[]; } // eslint-disable-line @typescript-eslint/no-explicit-any

const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

function fakeReact(states: unknown[] = []) {
    const queue = [...states];
    const set: unknown[] = [];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => [queue.length ? queue.shift() : typeof start === "function" ? (start as () => unknown)() : start, (value: unknown) => { set.push(value); }]) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    };
    return { react, set };
}

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

const textOf = (node: unknown): string => isEl(node) ? node.children.map(textOf).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const byLabel = (tree: unknown, label: string) => findAll(tree, el => el.props["aria-label"] === label)[0];
const byText = (tree: unknown, text: string) => findAll(tree, el => el.type === "button" && textOf(el) === text)[0];
const byClass = (tree: unknown, name: string) => findAll(tree, el => typeof el.props.className === "string" && el.props.className.split(" ").includes(name));

afterEach(() => { setReactSource(undefined); });

async function readyEditor(extra: { presets?: Preset[]; } = {}) {
    const calls: string[] = [];
    const drawn: unknown[] = [];
    const editor = new EditorSession({
        load: async () => ({ width: 1000, height: 500, source: "bitmap" }),
        draw: (_canvas, _source, plan, adjustments) => { drawn.push({ plan, adjustments }); },
        exportPng: async () => new Blob(["x"]),
        saveFile: (_blob, filename) => { calls.push(`file:${filename}`); },
        presets: { list: async () => extra.presets ?? [], save: async name => { calls.push(`save:${name}`); return "saved"; }, remove: async name => { calls.push(`remove:${name}`); return true; } }
    }, "AVATAR", "pinterest-x");
    await editor.init();
    return { editor, calls, drawn };
}

function view(editor: EditorSession, states: unknown[] = ["", null], onBack: () => void = () => undefined) {
    const { react, set } = fakeReact(states);
    setReactSource(() => react);
    const tree = render({ type: EditorView, props: { editor, onBack }, children: [] } satisfies El);
    return { tree, set };
}

describe("Pinterest editor: the screen", () => {
    it("shows the preview, the shape, the zoom, every slider with its range and value, and the presets", async () => {
        const { editor } = await readyEditor();
        editor.adjust("contrast", 25);
        const { tree } = view(editor);
        assert.ok(byLabel(tree, "Preview of the result"));
        assert.deepEqual(findAll(byLabel(tree, "Shape of the result"), el => el.type === "option").map(textOf), OUTPUT_OPTIONS.map(option => option.label));
        const zoom = byLabel(tree, "Zoom");
        assert.deepEqual([zoom.props.min, zoom.props.max, zoom.props.value, zoom.props.type], [EDITOR_LIMITS.minZoom, EDITOR_LIMITS.maxZoom, 1, "range"]);
        assert.equal(SLIDERS.length, 7);
        for (const { key, label } of SLIDERS) {
            const input = byLabel(tree, label);
            assert.ok(input, label);
            assert.equal(input.props.type, "range");
            assert.equal(input.props.disabled, false);
            assert.equal(input.props.value, key === "contrast" ? 25 : 0, label);
        }
        assert.deepEqual([byLabel(tree, "Hue").props.min, byLabel(tree, "Hue").props.max], [-180, 180]);
        assert.deepEqual([byLabel(tree, "Sepia").props.min, byLabel(tree, "Sepia").props.max], [0, 100]);
        assert.equal(byLabel(tree, "Tint colour").props.value, NEUTRAL.tint);
        for (const preset of BUILT_IN_PRESETS) assert.ok(byText(tree, preset.name), preset.name);
        assert.equal(findAll(tree, el => el.props.className === "pt-slider" && textOf(el).includes("25")).length, 1, "the value is written next to the slider");
    });

    it("a banner preview has its own shape class", async () => {
        const { editor } = await readyEditor();
        assert.equal(byClass(view(editor).tree, "pt-canvas-banner").length, 0);
        editor.setOutput("BANNER");
        assert.equal(byClass(view(editor).tree, "pt-canvas-banner").length, 1);
        assert.equal(byLabel(view(editor).tree, "Shape of the result").props.value, "BANNER");
    });

    it("gives the canvas to the editor, and takes it back with null", async () => {
        const { editor, drawn } = await readyEditor();
        const canvas = byLabel(view(editor).tree, "Preview of the result");
        canvas.props.ref({ id: "canvas" });
        assert.equal(drawn.length, 1);
        canvas.props.ref(null);
        editor.adjust("hue", 3);
        assert.equal(drawn.length, 1);
    });

    it("disables the controls while loading and says so; says why when it failed", async () => {
        const loading = new EditorSession({ load: () => new Promise(() => undefined), draw: () => undefined, exportPng: async () => new Blob(), saveFile: () => undefined, presets: { list: async () => [], save: async () => "saved", remove: async () => true } }, "AVATAR", "x");
        const tree = view(loading).tree;
        assert.equal(textOf(findAll(tree, el => el.props.role === "status")[0]), "Loading the picture…");
        for (const label of ["Zoom", "Brightness", "Shape of the result", "Tint colour", "Turn left", "Move up", "Mirror top to bottom"]) assert.equal(byLabel(tree, label).props.disabled, true, label);
        assert.equal(byText(tree, "Save as PNG").props.disabled, true);
        assert.equal(byText(tree, "Compare without colour changes").props.disabled, true);
        assert.equal(byText(tree, BUILT_IN_PRESETS[1].name).props.disabled, true);
        const failed = new EditorSession({ load: async () => { throw new Error("no picture"); }, draw: () => undefined, exportPng: async () => new Blob(), saveFile: () => undefined, presets: { list: async () => [], save: async () => "saved", remove: async () => true } }, "AVATAR", "x");
        await failed.init();
        assert.equal(textOf(byClass(view(failed).tree, "pt-error")[0]), "no picture");
    });

    it("sliders change the edit; letting go ends the gesture", async () => {
        const { editor } = await readyEditor();
        const { tree } = view(editor);
        const brightness = byLabel(tree, "Brightness");
        brightness.props.onChange({ target: { value: "30" } });
        brightness.props.onChange({ target: { value: "40" } });
        assert.equal(editor.state.edit.adjustments.brightness, 40);
        brightness.props.onMouseUp();
        brightness.props.onChange({ target: { value: "50" } });
        editor.undo();
        assert.equal(editor.state.edit.adjustments.brightness, 40, "released: a new step began");
        for (const handler of ["onTouchEnd", "onKeyUp", "onBlur"]) {
            const input = byLabel(view(editor).tree, "Hue");
            input.props.onChange({ target: { value: "10" } });
            input.props[handler]();
            input.props.onChange({ target: { value: "20" } });
            editor.undo();
            assert.equal(editor.state.edit.adjustments.hue, 10, handler);
            editor.undo();
        }
        const zoom = byLabel(view(editor).tree, "Zoom");
        zoom.props.onChange({ target: { value: "3" } });
        assert.equal(editor.state.edit.zoom, 3);
        zoom.props.onMouseUp();
        zoom.props.onChange({ target: { value: "4" } });
        editor.undo();
        assert.equal(editor.state.edit.zoom, 3);
    });

    it("the shape select and the tint colour change the edit", async () => {
        const { editor } = await readyEditor();
        const { tree } = view(editor);
        byLabel(tree, "Shape of the result").props.onChange({ target: { value: "BANNER" } });
        assert.equal(editor.state.edit.output, "BANNER");
        byLabel(tree, "Tint colour").props.onChange({ target: { value: "#112233" } });
        assert.equal(editor.state.edit.adjustments.tint, "#112233");
        byLabel(tree, "Tint colour").props.onBlur();
    });

    it("the arrows move the frame by a step, each press its own step", async () => {
        const { editor } = await readyEditor();
        editor.zoom(2);
        editor.endGesture();
        const { tree } = view(editor);
        byLabel(tree, "Move right").props.onClick();
        assert.ok(Math.abs(editor.state.edit.centerX - (0.5 + ARROW_STEP)) < 1e-9);
        byLabel(tree, "Move right").props.onClick();
        assert.ok(Math.abs(editor.state.edit.centerX - (0.5 + 2 * ARROW_STEP)) < 1e-9);
        editor.undo();
        assert.ok(Math.abs(editor.state.edit.centerX - (0.5 + ARROW_STEP)) < 1e-9, "two presses, two steps");
        byLabel(tree, "Move left").props.onClick();
        assert.ok(Math.abs(editor.state.edit.centerX - 0.5) < 1e-9);
        byLabel(tree, "Move down").props.onClick();
        assert.ok(Math.abs(editor.state.edit.centerY - (0.5 + ARROW_STEP)) < 1e-9);
        byLabel(tree, "Move up").props.onClick();
        assert.ok(Math.abs(editor.state.edit.centerY - 0.5) < 1e-9);
    });

    it("every arrow press is its own step, and the zoom slider moves in tenths", async () => {
        for (const [label, axis] of [["Move left", "centerX"], ["Move right", "centerX"], ["Move up", "centerY"], ["Move down", "centerY"]] as const) {
            const { editor } = await readyEditor();
            editor.zoom(2);
            editor.endGesture();
            const { tree } = view(editor);
            byLabel(tree, label).props.onClick();
            const once = editor.state.edit[axis];
            byLabel(tree, label).props.onClick();
            editor.undo();
            assert.equal(editor.state.edit[axis], once, label);
        }
        assert.equal(byLabel(view((await readyEditor()).editor).tree, "Zoom").props.step, 0.1);
    });

    it("turn and mirror buttons", async () => {
        const { editor } = await readyEditor();
        const { tree } = view(editor);
        byLabel(tree, "Turn right").props.onClick();
        assert.equal(editor.state.edit.rotation, 90);
        byLabel(tree, "Turn left").props.onClick();
        byLabel(tree, "Turn left").props.onClick();
        assert.equal(editor.state.edit.rotation, 270);
        byLabel(tree, "Mirror left to right").props.onClick();
        assert.equal(editor.state.edit.flipH, true);
        byLabel(tree, "Mirror top to bottom").props.onClick();
        assert.equal(editor.state.edit.flipV, true);
    });

    it("undo, redo and reset follow what can be done, and the back button leaves", async () => {
        const { editor } = await readyEditor();
        let back = 0;
        const fresh = view(editor, ["", null], () => { back++; }).tree;
        assert.equal(byText(fresh, "Undo").props.disabled, true);
        assert.equal(byText(fresh, "Redo").props.disabled, true);
        assert.equal(byText(fresh, "Reset").props.disabled, true);
        byText(fresh, "← Back to results").props.onClick();
        assert.equal(back, 1);
        editor.adjust("hue", 5);
        const touched = view(editor).tree;
        assert.equal(byText(touched, "Undo").props.disabled, false);
        assert.equal(byText(touched, "Reset").props.disabled, false);
        byText(touched, "Undo").props.onClick();
        assert.equal(editor.state.edit.adjustments.hue, 0);
        const undone = view(editor).tree;
        assert.equal(byText(undone, "Redo").props.disabled, false);
        byText(undone, "Redo").props.onClick();
        assert.equal(editor.state.edit.adjustments.hue, 5);
        byText(view(editor).tree, "Reset").props.onClick();
        assert.equal(editor.state.untouched, true);
    });

    it("presets: built-in and the person's own apply, can be removed, and a name is needed to save one", async () => {
        const mine: Preset = { name: "mine", adjustments: { ...NEUTRAL, sepia: 33 } };
        const { editor, calls } = await readyEditor({ presets: [mine] });
        const { tree } = view(editor);
        byText(tree, "Noir").props.onClick();
        assert.equal(editor.state.edit.adjustments.grayscale, 100);
        byText(tree, "mine").props.onClick();
        assert.equal(editor.state.edit.adjustments.sepia, 33);
        byLabel(tree, "Remove preset mine").props.onClick();
        assert.deepEqual(calls, ["remove:mine"]);
        assert.equal(byText(tree, "Save preset").props.disabled, true, "no name yet");
        assert.equal(byLabel(tree, "Preset name").props.maxLength, EDITOR_LIMITS.presetNameChars);
        const named = view(editor, ["  my look ", null]).tree;
        assert.equal(byText(named, "Save preset").props.disabled, false);
        byText(named, "Save preset").props.onClick();
        assert.deepEqual(calls, ["remove:mine", "save:  my look "]);
        const blank = view(editor, ["   ", null]).tree;
        assert.equal(byText(blank, "Save preset").props.disabled, true);
    });

    it("hides the list of own presets when there are none, and typing a name sets the text", async () => {
        const { editor } = await readyEditor();
        const { tree, set } = view(editor);
        assert.equal(findAll(tree, el => textOf(el) === "Yours:").length, 0);
        byLabel(tree, "Preset name").props.onChange({ target: { value: "abc" } });
        assert.deepEqual(set, ["abc"]);
    });

    it("compare shows and hides the colour changes", async () => {
        const { editor } = await readyEditor();
        const off = view(editor).tree;
        byText(off, "Compare without colour changes").props.onClick();
        assert.equal(editor.state.showOriginal, true);
        const on = view(editor).tree;
        assert.equal(byText(on, "Showing without colour changes").props["aria-pressed"], "true");
        byText(on, "Showing without colour changes").props.onClick();
        assert.equal(editor.state.showOriginal, false);
    });

    it("saves a PNG, shows when it is busy and the last note", async () => {
        const { editor, calls } = await readyEditor();
        const { tree } = view(editor);
        const button = byText(tree, "Save as PNG");
        assert.equal(button.props.disabled, false);
        button.props.onClick();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, ["file:pinterest-x-avatar.png"]);
        assert.equal(textOf(byClass(view(editor).tree, "pt-notice")[0]), "Saved to your downloads");
        (editor as unknown as { current: object; }).current = { ...editor.state, saving: true };
        const busy = view(editor).tree;
        assert.equal(byText(busy, "Saving…").props.disabled, true);
    });

    it("dragging the picture follows the pointer and ends as one step", async () => {
        const { editor } = await readyEditor();
        editor.zoom(2);
        editor.endGesture();
        const target = { getBoundingClientRect: () => ({ width: 200, height: 200 }), setPointerCapture: (_id: number) => undefined };
        const first = view(editor, ["", null]);
        const canvas = byLabel(first.tree, "Preview of the result");
        canvas.props.onPointerDown({ clientX: 100, clientY: 100, currentTarget: target, pointerId: 1 });
        assert.deepEqual(first.set, [{ x: 100, y: 100 }]);
        canvas.props.onPointerMove({ clientX: 120, clientY: 100, currentTarget: target });
        assert.equal(editor.state.edit.centerX, 0.5, "not dragging yet in this draw");
        const dragging = view(editor, ["", { x: 100, y: 100 }]);
        const moving = byLabel(dragging.tree, "Preview of the result");
        moving.props.onPointerMove({ clientX: 120, clientY: 100, currentTarget: target });
        assert.ok(Math.abs(editor.state.edit.centerX - (0.5 - 0.1 * 250 / 1000)) < 1e-9);
        assert.deepEqual(dragging.set, [{ x: 120, y: 100 }]);
        moving.props.onPointerMove({ clientX: 120, clientY: 100, currentTarget: { getBoundingClientRect: () => ({ width: 0, height: 0 }) } });
        assert.equal(dragging.set.length, 1, "a preview with no size is ignored");
        moving.props.onPointerMove({ clientX: 120, clientY: 100 });
        assert.equal(dragging.set.length, 1);
        moving.props.onPointerUp();
        assert.equal(dragging.set.at(-1), null);
        editor.adjust("hue", 1);
        editor.undo();
        assert.ok(editor.state.edit.centerX < 0.5, "the drag stayed one step apart from what came next");
        moving.props.onPointerCancel();
    });

    it("reads a drag in fractions of the preview's width and height separately, and ignores a preview with no height", async () => {
        const { editor } = await readyEditor();
        editor.zoom(2);
        editor.endGesture();
        const target = { getBoundingClientRect: () => ({ width: 400, height: 100 }) };
        const dragging = view(editor, ["", { x: 0, y: 0 }]);
        const canvas = byLabel(dragging.tree, "Preview of the result");
        canvas.props.onPointerMove({ clientX: 40, clientY: 10, currentTarget: target });
        assert.ok(Math.abs(editor.state.edit.centerX - (0.5 - 0.1 * 250 / 1000)) < 1e-9, "40 of 400 is a tenth across");
        assert.ok(Math.abs(editor.state.edit.centerY - (0.5 - 0.1 * 250 / 500)) < 1e-9, "10 of 100 is a tenth down");
        const flat = view(editor, ["", { x: 0, y: 0 }]);
        const before = editor.state.edit.centerX;
        byLabel(flat.tree, "Preview of the result").props.onPointerMove({ clientX: 40, clientY: 10, currentTarget: { getBoundingClientRect: () => ({ width: 400, height: 0 }) } });
        assert.equal(editor.state.edit.centerX, before);
    });

    it("two drags with the pointer lifted between are two steps", async () => {
        const { editor } = await readyEditor();
        editor.zoom(2);
        editor.endGesture();
        const target = { getBoundingClientRect: () => ({ width: 200, height: 200 }) };
        const moving = byLabel(view(editor, ["", { x: 0, y: 0 }]).tree, "Preview of the result");
        moving.props.onPointerMove({ clientX: 20, clientY: 0, currentTarget: target });
        const afterFirst = editor.state.edit.centerX;
        moving.props.onPointerUp();
        moving.props.onPointerMove({ clientX: 20, clientY: 0, currentTarget: target });
        editor.undo();
        assert.equal(editor.state.edit.centerX, afterFirst);
    });

    it("asks the page to follow the pointer with the pointer's id", async () => {
        const { editor } = await readyEditor();
        const captured: number[] = [];
        byLabel(view(editor).tree, "Preview of the result").props.onPointerDown({ clientX: 0, clientY: 0, currentTarget: { setPointerCapture: (id: number) => { captured.push(id); } }, pointerId: 7 });
        assert.deepEqual(captured, [7]);
    });

    it("keeps working when the page cannot capture the pointer", async () => {
        const { editor } = await readyEditor();
        const target = { setPointerCapture: () => { throw new Error("no capture"); } };
        const { tree, set } = view(editor);
        byLabel(tree, "Preview of the result").props.onPointerDown({ clientX: 1, clientY: 2, currentTarget: target, pointerId: 3 });
        assert.deepEqual(set, [{ x: 1, y: 2 }]);
        byLabel(tree, "Preview of the result").props.onPointerDown({ clientX: 1, clientY: 2 });
    });
});

// --- The window around the editor ------------------------------------------------------------------------------------------------------------------------

const pin = (id: string, extra: Partial<PinterestImageResult> = {}): PinterestImageResult => ({ id, title: `title ${id}`, description: "", url: `https://i.pinimg.com/originals/${id}.jpg`, width: 10, height: 10, dominantColor: null, pinterestUrl: null, isGif: false, ...extra });

function fakeLibrary(): SessionLibrary {
    return { favourites: async () => [], addFavourite: async () => "added", removeFavourite: async () => true, recent: async () => [], rememberSearch: async () => [], clearRecent: async () => undefined };
}

async function editorFor(result: PinterestImageResult = pin("a")) {
    void result;
    return (await readyEditor()).editor;
}

describe("Pinterest editor: opened from the window", () => {
    const created: Array<{ result: PinterestImageResult; kind: string; }> = [];
    const make = (create?: (result: PinterestImageResult, kind: "AVATAR" | "BANNER") => EditorSession) => new WindowSession({
        search: async () => ({ query: "q", guides: [], results: [pin("a")], bookmark: null }), library: fakeLibrary(), randomize: () => false, createEditor: create
    });

    it("opens the editor for a card, loads it and puts it in the state", async () => {
        created.length = 0;
        let inits = 0;
        const editor = await editorFor();
        const original = editor.init.bind(editor);
        editor.init = async () => { inits++; await original(); };
        const session = make((result, kind) => { created.push({ result, kind }); return editor; });
        session.openEditor(pin("a"), "BANNER");
        assert.equal(session.state.editor, editor);
        assert.deepEqual(created.map(item => [item.result.id, item.kind]), [["a", "BANNER"]]);
        assert.equal(inits, 1);
    });

    it("opens only one editor at a time", async () => {
        let made = 0;
        const session = make(() => { made++; return new EditorSession({ load: () => new Promise(() => undefined), draw: () => undefined, exportPng: async () => new Blob(), saveFile: () => undefined, presets: { list: async () => [], save: async () => "saved", remove: async () => true } }, "AVATAR", "x"); });
        session.openEditor(pin("a"), "AVATAR");
        session.openEditor(pin("b"), "AVATAR");
        assert.equal(made, 1);
    });

    it("says no to a GIF, does nothing without an editor maker or when one is open, and tells when making it fails", async () => {
        const editor = await editorFor();
        const session = make(() => editor);
        session.openEditor(pin("g", { isGif: true }), "AVATAR");
        assert.equal(session.state.editor, null);
        assert.equal(session.state.notice, "GIFs cannot be edited yet (they would lose their animation)");
        make().openEditor(pin("a"), "AVATAR");
        session.openEditor(pin("a"), "AVATAR");
        const first = session.state.editor;
        session.openEditor(pin("b"), "AVATAR");
        assert.equal(session.state.editor, first);
        const broken = make(() => { throw new Error("cannot start"); });
        broken.openEditor(pin("a"), "AVATAR");
        assert.equal(broken.state.editor, null);
        assert.equal(broken.state.notice, "cannot start");
        const without = make();
        without.openEditor(pin("a"), "AVATAR");
        assert.equal(without.state.editor, null);
        assert.equal(without.state.notice, null);
    });

    it("closing the editor closes it and shows the results again; closing the window closes it too", async () => {
        const editor = await editorFor();
        let closed = 0;
        const original = editor.close.bind(editor);
        editor.close = () => { closed++; original(); };
        const session = make(() => editor);
        session.closeEditor();
        assert.equal(closed, 0);
        session.openEditor(pin("a"), "AVATAR");
        session.closeEditor();
        assert.equal(session.state.editor, null);
        assert.equal(closed, 1);
        const other = await editorFor();
        let closedOther = 0;
        const originalOther = other.close.bind(other);
        other.close = () => { closedOther++; originalOther(); };
        const second = make(() => other);
        second.openEditor(pin("a"), "AVATAR");
        second.close();
        assert.equal(closedOther, 1);
        const idle = make();
        assert.doesNotThrow(() => { idle.close(); });
    });

    it("picks the shape an edit starts with", () => {
        assert.equal(editorKindFor(["AVATAR"], { width: 1000, height: 100 }), "AVATAR");
        assert.equal(editorKindFor(["BANNER"], { width: 100, height: 1000 }), "BANNER");
        assert.equal(editorKindFor(["AVATAR", "BANNER"], { width: 1800, height: 1000 }), "BANNER");
        assert.equal(editorKindFor(["AVATAR", "BANNER"], { width: 1799, height: 1000 }), "AVATAR");
        assert.equal(editorKindFor(["AVATAR", "BANNER"], { width: 1000, height: 1000 }), "AVATAR");
        assert.equal(editorKindFor(["AVATAR", "BANNER"], { width: 1000, height: 0 }), "AVATAR");
    });

    it("the card's Edit button opens the editor, and the editor takes the place of the results", async () => {
        const parts = Object.fromEntries(["Root", "Header", "Content", "Footer", "Close"].map(name => [name, ({ children }: { children?: unknown; }) => ({ type: name, props: {}, children: [children].flat() })]));
        const frame = { ModalRoot: parts.Root, ModalHeader: parts.Header, ModalContent: parts.Content, ModalFooter: parts.Footer, ModalCloseButton: parts.Close } as unknown as WindowParts;
        const opened: Array<[string, string]> = [];
        const session = make();
        session.openEditor = (result, kind) => { opened.push([result.id, kind]); };
        await session.search("x");
        const thumbs = new ThumbLoader({ fetchMedia: async () => ({ data: new ArrayBuffer(1), type: "image/png", filename: "x" }), createUrl: () => "blob:x", revokeUrl: () => undefined });
        thumbs.request = () => () => undefined;
        const { react } = fakeReact(["", null]);
        setReactSource(() => react);
        const tree = render({ type: PinterestWindow, props: { session, thumbs, parts: frame, style: () => ({}), onClose: () => undefined }, children: [] } satisfies El);
        const edit = byLabel(tree, "Edit: title a");
        assert.equal(textOf(edit), "Edit");
        edit.props.onClick();
        assert.deepEqual(opened, [["a", "AVATAR"]]);
        assert.equal(byClass(tree, "pt-editor").length, 0);

        const real = make(() => editorForSync());
        function editorForSync() {
            return new EditorSession({ load: () => new Promise(() => undefined), draw: () => undefined, exportPng: async () => new Blob(), saveFile: () => undefined, presets: { list: async () => [], save: async () => "saved", remove: async () => true } }, "AVATAR", "x");
        }
        await real.search("x");
        real.openEditor(pin("a"), "AVATAR");
        const { react: next } = fakeReact(["", "", null]);
        setReactSource(() => next);
        const shown = render({ type: PinterestWindow, props: { session: real, thumbs, parts: frame, style: () => ({}), onClose: () => undefined }, children: [] } satisfies El);
        assert.equal(byClass(shown, "pt-editor").length, 1);
        assert.equal(byClass(shown, "pt-grid").length, 0);
        byText(shown, "← Back to results").props.onClick();
        assert.equal(real.state.editor, null);
    });
});

describe("Pinterest editor: the window opener", () => {
    it("gives the window the means to make editors for the plugin's own storage and native functions", async () => {
        const { react } = fakeReact();
        setReactSource(() => react);
        const opened: Array<(props: { transitionState: number; onClose(): void; }) => unknown> = [];
        const stored: string[] = [];
        const component = (name: string) => ({ get: () => name });
        const ctx = {
            modals: { open: (render: never) => { opened.push(render); return "k"; }, close: () => undefined, closeAll: () => undefined },
            components: { ModalRoot: component("R"), ModalHeader: component("H"), ModalContent: component("C"), ModalFooter: component("F"), ModalCloseButton: component("X") },
            native: { call: async () => { throw new Error("offline"); } },
            storage: { get: async (key: string) => { stored.push(key); return undefined; }, set: async () => undefined },
            addStyle: () => ({ update: () => undefined, remove: () => undefined })
        } as never;
        createWindowOpener(ctx, undefined).open();
        const element = (opened[0]({ transitionState: 1, onClose: () => undefined }) as El).children[0] as El;
        const session = element.props.session as WindowSession;
        session.openEditor(pin("a"), "BANNER");
        const editor = session.state.editor!;
        assert.ok(editor, "an editor was made");
        assert.equal(editor.state.edit.output, "BANNER");
        await editor.init();
        assert.equal(editor.state.status, "error", "the picture could not come through the offline main process");
        assert.ok(stored.includes("editorPresets"), "the saved presets come from the plugin's storage");
        session.close();
    });
});

// --- The page tools ----------------------------------------------------------------------------------------------------------------------------------------

describe("Pinterest editor: the page tools", () => {
    it("fetches through the main process, decodes with the page, makes canvases, and starts a download then lets the address go", async () => {
        const link: { href: string; download: string; clicked: number; click(): void; } = { href: "", download: "", clicked: 0, click() { this.clicked++; } };
        const made: string[] = [];
        const timers: Array<() => void> = [];
        const bitmap = { width: 3, height: 4 };
        const tools = pageTools({ fetchMedia: async url => ({ data: new ArrayBuffer(1), type: "image/png", filename: url }) }, {
            createImageBitmap: async () => bitmap,
            document: { createElement: tag => { made.push(tag); return tag === "a" ? link : { tag }; } },
            setTimeout: (work, ms) => { assert.equal(ms, 10_000); timers.push(work); return 0; }
        });
        assert.equal((await tools.fetchMedia("https://i.pinimg.com/a.png")).filename, "https://i.pinimg.com/a.png");
        assert.equal(await tools.createBitmap(new Blob(["x"])), bitmap);
        assert.deepEqual(tools.makeCanvas(), { tag: "canvas" });
        tools.download(new Blob(["x"], { type: "image/png" }), "pic.png");
        assert.equal(link.download, "pic.png");
        assert.match(link.href, /^blob:/);
        assert.equal(link.clicked, 1);
        assert.deepEqual(made, ["canvas", "a"]);
        assert.equal(timers.length, 1);
        timers[0]();
    });
});

describe("Pinterest editor: the CSS", () => {
    it("has a rule for every pt- class the editor screen uses", async () => {
        const { editor } = await readyEditor({ presets: [{ name: "mine", adjustments: NEUTRAL }] });
        editor.setOutput("BANNER");
        const used = new Set<string>();
        const walk = (node: unknown) => {
            if (!isEl(node)) return;
            String(node.props.className ?? "").split(" ").filter(name => name.startsWith("pt-")).forEach(name => used.add(name));
            node.children.forEach(walk);
        };
        walk(view(editor).tree);
        const failed = new EditorSession({ load: async () => { throw new Error("x"); }, draw: () => undefined, exportPng: async () => new Blob(), saveFile: () => undefined, presets: { list: async () => [], save: async () => "saved", remove: async () => true } }, "AVATAR", "x");
        await failed.init();
        walk(view(failed).tree);
        assert.ok(used.size >= 15, `only ${used.size} classes found`);
        for (const name of used) assert.ok(new RegExp(`\.${name}(?![\w-])`).test(WINDOW_CSS), `no style for .${name}`);
    });
});
