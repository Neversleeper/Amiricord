/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type CanvasLike, drawPlan, exportPng } from "../src/testcordplugins/PinterestTool/editorCanvas";
import { createEditorFor, fileBase, type PageTools } from "../src/testcordplugins/PinterestTool/editorGlue";
import { type Adjustments, BUILT_IN_PRESETS, EDITOR_LIMITS, NEUTRAL, type OutputPlan, type Preset } from "../src/testcordplugins/PinterestTool/editorModel";
import { type EditorDeps, EditorSession, type LoadedSource } from "../src/testcordplugins/PinterestTool/editorSession";
import type { MediaResult, PinterestImageResult } from "../src/testcordplugins/PinterestTool/types";

function later<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
    return { promise, resolve, reject };
}

function make(options: { width?: number; height?: number; load?: () => Promise<LoadedSource>; } = {}) {
    const drawn: Array<{ canvas: unknown; source: unknown; plan: OutputPlan; adjustments: Adjustments; }> = [];
    const saved: Array<{ blob: Blob; filename: string; }> = [];
    const released: string[] = [];
    let presets: Preset[] = [];
    const calls: string[] = [];
    const fail: Record<string, boolean> = {};
    const exports = { next: later<Blob>(), count: 0, auto: true };
    const deps: EditorDeps = {
        load: options.load ?? (async () => ({ width: options.width ?? 1000, height: options.height ?? 500, source: "bitmap", release: () => { released.push("released"); } })),
        draw: (canvas, source, plan, adjustments) => { if (fail.draw) throw new Error("canvas broke"); drawn.push({ canvas, source, plan, adjustments }); },
        exportPng: async (_source, _plan, _adjustments) => {
            exports.count++;
            if (fail.export) throw new Error("no png");
            return exports.auto ? new Blob(["png"]) : exports.next.promise;
        },
        saveFile: (blob, filename) => { saved.push({ blob, filename }); },
        presets: {
            list: async () => { if (fail.list) throw new Error("list broke"); return presets; },
            save: async (name, adjustments) => { calls.push(`save:${name}`); if (fail.save) throw new Error("save broke"); presets = [...presets, { name, adjustments }]; return name === "full" ? "full" : name === "" ? "invalid" : "saved"; },
            remove: async name => { calls.push(`remove:${name}`); if (fail.remove) throw new Error("remove broke"); presets = presets.filter(item => item.name !== name); return true; }
        }
    };
    const editor = new EditorSession(deps, "AVATAR", "pinterest-abc");
    return { editor, drawn, saved, released, calls, fail, exports, setPresets: (list: Preset[]) => { presets = list; } };
}

async function ready(options?: Parameters<typeof make>[0]) {
    const t = make(options);
    await t.editor.init();
    t.editor.attachCanvas("canvas");
    t.drawn.length = 0;
    return t;
}

describe("Pinterest editor: opening", () => {
    it("starts loading and untouched", () => {
        const { editor } = make();
        const state = editor.state;
        assert.equal(state.status, "loading");
        assert.equal(state.untouched, true);
        assert.equal(state.canUndo, false);
        assert.equal(state.canRedo, false);
        assert.equal(state.showOriginal, false);
        assert.equal(state.saving, false);
        assert.equal(state.notice, null);
        assert.deepEqual(state.presets, []);
        assert.equal(state.edit.output, "AVATAR");
    });

    it("loads the picture and the saved presets, and draws as soon as there is a canvas", async () => {
        const t = make();
        t.setPresets([{ name: "mine", adjustments: NEUTRAL }]);
        t.editor.attachCanvas("canvas");
        assert.equal(t.drawn.length, 0, "nothing to draw yet");
        await t.editor.init();
        assert.equal(t.editor.state.status, "ready");
        assert.deepEqual(t.editor.state.presets.map(preset => preset.name), ["mine"]);
        assert.equal(t.drawn.length, 1);
        assert.equal(t.drawn[0].canvas, "canvas");
        assert.equal(t.drawn[0].source, "bitmap");
        assert.deepEqual(t.drawn[0].plan, { sx: 250, sy: 0, sw: 500, sh: 500, outWidth: 500, outHeight: 500, rotation: 0, flipH: false, flipV: false });
        assert.deepEqual(t.drawn[0].adjustments, NEUTRAL);
    });

    it("draws when the canvas arrives after the picture, and does not draw into a canvas that went away", async () => {
        const t = make();
        await t.editor.init();
        assert.equal(t.drawn.length, 0);
        t.editor.attachCanvas("canvas");
        assert.equal(t.drawn.length, 1);
        t.editor.attachCanvas(null);
        t.editor.adjust("hue", 5);
        assert.equal(t.drawn.length, 1);
    });

    it("says why when the picture cannot be loaded, and still lists the presets", async () => {
        const t = make({ load: async () => { throw new Error("Pinterest said no"); } });
        t.setPresets([{ name: "mine", adjustments: NEUTRAL }]);
        await t.editor.init();
        assert.equal(t.editor.state.status, "error");
        assert.equal(t.editor.state.error, "Pinterest said no");
        assert.equal(t.editor.state.presets.length, 1);
    });

    it("refuses a picture that is empty or too big, and lets its memory go", async () => {
        for (const [width, height] of [[0, 10], [10, 0], [EDITOR_LIMITS.maxSide + 1, 10], [10, EDITOR_LIMITS.maxSide + 1], [NaN, 5]]) {
            const t = make({ width, height });
            await t.editor.init();
            assert.equal(t.editor.state.status, "error", `${width}x${height}`);
            assert.match(t.editor.state.error!, /too big/);
            assert.deepEqual(t.released, ["released"]);
        }
        const exact = make({ width: EDITOR_LIMITS.maxSide, height: EDITOR_LIMITS.maxSide });
        await exact.editor.init();
        assert.equal(exact.editor.state.status, "ready");
    });

    it("is ready only when the saved presets have been listed too", async () => {
        const gate = later<Preset[]>();
        const editor = new EditorSession({
            load: async () => ({ width: 10, height: 10, source: "b" }), draw: () => undefined, exportPng: async () => new Blob(), saveFile: () => undefined,
            presets: { list: () => gate.promise, save: async () => "saved", remove: async () => true }
        }, "AVATAR", "x");
        let finished = false;
        const done = editor.init().then(() => { finished = true; });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(finished, false, "init waits for the list");
        gate.resolve([{ name: "late", adjustments: NEUTRAL }]);
        await done;
        assert.equal(editor.state.presets.length, 1);
    });

    it("keeps working when the saved presets cannot be read", async () => {
        const t = make();
        t.fail.list = true;
        await t.editor.init();
        assert.equal(t.editor.state.status, "ready");
        assert.deepEqual(t.editor.state.presets, []);
    });

    it("throws the picture away when the editor was closed while it loaded", async () => {
        const gate = later<LoadedSource>();
        const released: string[] = [];
        const t = make({ load: () => gate.promise });
        const done = t.editor.init();
        t.editor.close();
        gate.resolve({ width: 10, height: 10, source: "x", release: () => { released.push("r"); } });
        await done;
        assert.deepEqual(released, ["r"]);
        assert.equal(t.editor.state.status, "loading");
    });

    it("ignores changes before the picture is there", async () => {
        const t = make();
        t.editor.adjust("hue", 5);
        t.editor.rotate(1);
        t.editor.zoom(2);
        t.editor.drag(0.1, 0.1);
        t.editor.pan(0.1, 0);
        t.editor.flip("H");
        t.editor.setOutput("BANNER");
        t.editor.usePreset(BUILT_IN_PRESETS[1].adjustments);
        t.editor.tint("#ffffff");
        t.editor.reset();
        t.editor.undo();
        t.editor.redo();
        assert.equal(t.editor.state.untouched, true);
        assert.equal(t.editor.state.canUndo, false);
        await t.editor.save();
        assert.equal(t.exports.count, 0);
    });
});

describe("Pinterest editor: changes", () => {
    it("every change is drawn again with the right plan and colours, and marks the edit as touched", async () => {
        const t = await ready();
        t.editor.adjust("brightness", 20);
        assert.equal(t.editor.state.untouched, false);
        assert.equal(t.editor.state.edit.adjustments.brightness, 20);
        assert.equal(t.drawn.length, 1);
        assert.equal(t.drawn[0].adjustments.brightness, 20);
        t.editor.tint("#00ff00");
        assert.equal(t.drawn.at(-1)!.adjustments.tint, "#00ff00");
        t.editor.rotate(1);
        assert.equal(t.drawn.at(-1)!.plan.rotation, 90);
        t.editor.flip("H");
        assert.equal(t.drawn.at(-1)!.plan.flipH, true);
        t.editor.flip("V");
        assert.equal(t.drawn.at(-1)!.plan.flipV, true);
        t.editor.setOutput("BANNER");
        assert.equal(t.drawn.at(-1)!.plan.outHeight < t.drawn.at(-1)!.plan.outWidth, true);
        assert.equal(t.editor.state.edit.output, "BANNER");
    });

    it("zoom and arrows move the plan", async () => {
        const t = await ready();
        t.editor.zoom(2);
        assert.equal(t.drawn.at(-1)!.plan.sw, 250);
        t.editor.endGesture();
        t.editor.pan(0.1, 0);
        assert.equal(t.editor.state.edit.centerX, 0.6);
        t.editor.pan(0, 0.1);
        assert.equal(t.editor.state.edit.centerY, 0.6);
    });

    it("dragging the picture moves it with the pointer, by a fraction of the preview", async () => {
        const t = await ready();
        t.editor.zoom(2);
        t.editor.endGesture();
        t.editor.drag(-0.2, 0);
        assert.ok(Math.abs(t.editor.state.edit.centerX - 0.55) < 1e-9, "dragging left shows what is to the right");
        t.editor.drag(0, 0.4);
        assert.ok(Math.abs(t.editor.state.edit.centerY - (0.5 - 0.4 * 250 / 500)) < 1e-9, "dragging down shows what is above");
    });

    it("drag amounts follow the turned picture", async () => {
        const t = await ready();
        t.editor.rotate(1);
        t.editor.zoom(2);
        t.editor.endGesture();
        t.editor.drag(0.5, 0);
        const turnedWidth = 500;
        const cropWidth = 250;
        assert.ok(Math.abs(t.editor.state.edit.centerX - (0.5 - 0.5 * cropWidth / turnedWidth)) < 1e-9);
    });

    it("a whole drag of a slider is one step to undo; another slider is another step", async () => {
        const t = await ready();
        t.editor.adjust("brightness", 10);
        t.editor.adjust("brightness", 20);
        t.editor.adjust("brightness", 30);
        t.editor.adjust("contrast", 5);
        t.editor.undo();
        assert.equal(t.editor.state.edit.adjustments.contrast, 0);
        assert.equal(t.editor.state.edit.adjustments.brightness, 30);
        t.editor.undo();
        assert.equal(t.editor.state.edit.adjustments.brightness, 0);
        assert.equal(t.editor.state.canUndo, false);
        assert.equal(t.editor.state.canRedo, true);
        t.editor.redo();
        assert.equal(t.editor.state.edit.adjustments.brightness, 30);
        assert.equal(t.editor.state.untouched, false);
    });

    it("tint and zoom are separate steps, and every zoom call without a gesture end is merged", async () => {
        const t = await ready();
        t.editor.tint("#112233");
        t.editor.zoom(2);
        t.editor.undo();
        assert.equal(t.editor.state.edit.zoom, 1);
        assert.equal(t.editor.state.edit.adjustments.tint, "#112233");
        t.editor.zoom(2);
        t.editor.zoom(3);
        t.editor.undo();
        assert.equal(t.editor.state.edit.zoom, 1, "a drag of the zoom slider is one step");
    });

    it("ending a gesture makes the next move a new step", async () => {
        const t = await ready();
        t.editor.adjust("hue", 10);
        t.editor.endGesture();
        t.editor.adjust("hue", 20);
        t.editor.undo();
        assert.equal(t.editor.state.edit.adjustments.hue, 10);
    });

    it("undo and redo redraw, and do nothing when there is nothing to do", async () => {
        const t = await ready();
        t.editor.undo();
        t.editor.redo();
        assert.equal(t.drawn.length, 0);
        t.editor.adjust("hue", 10);
        t.editor.undo();
        assert.equal(t.drawn.at(-1)!.adjustments.hue, 0);
        t.editor.redo();
        assert.equal(t.drawn.at(-1)!.adjustments.hue, 10);
    });

    it("reset goes back to untouched (and keeps the chosen shape), and can be undone", async () => {
        const t = await ready();
        t.editor.setOutput("BANNER");
        t.editor.adjust("sepia", 50);
        t.editor.rotate(1);
        t.editor.reset();
        assert.equal(t.editor.state.edit.output, "BANNER");
        assert.equal(t.editor.state.edit.rotation, 0);
        assert.equal(t.editor.state.edit.adjustments.sepia, 0);
        assert.equal(t.editor.state.untouched, true, "nothing left to reset");
        t.editor.undo();
        assert.equal(t.editor.state.edit.rotation, 90);
    });

    it("applies a look as one step", async () => {
        const t = await ready();
        t.editor.usePreset(BUILT_IN_PRESETS[4].adjustments);
        assert.equal(t.editor.state.edit.adjustments.grayscale, 100);
        t.editor.undo();
        assert.equal(t.editor.state.edit.adjustments.grayscale, 0);
    });

    it("clears the notice on a change", async () => {
        const t = await ready();
        await t.editor.savePreset("a");
        assert.equal(t.editor.state.notice, "Preset saved");
        t.editor.adjust("hue", 3);
        assert.equal(t.editor.state.notice, null);
    });

    it("shows the cut without colour changes on request, and draws only when that changes", async () => {
        const t = await ready();
        t.editor.adjust("sepia", 80);
        t.drawn.length = 0;
        t.editor.setShowOriginal(true);
        assert.equal(t.editor.state.showOriginal, true);
        assert.deepEqual(t.drawn.at(-1)!.adjustments, NEUTRAL);
        t.editor.setShowOriginal(true);
        assert.equal(t.drawn.length, 1);
        t.editor.adjust("sepia", 90);
        assert.deepEqual(t.drawn.at(-1)!.adjustments, NEUTRAL, "still the original while comparing");
        t.editor.setShowOriginal(false);
        assert.equal(t.drawn.at(-1)!.adjustments.sepia, 90);
        assert.equal(t.editor.state.edit.adjustments.sepia, 90, "the edit itself is never changed by comparing");
    });

    it("tells the person when drawing fails, and goes on", async () => {
        const t = await ready();
        t.fail.draw = true;
        t.editor.adjust("hue", 4);
        assert.match(t.editor.state.notice!, /Could not draw the picture: canvas broke/);
        assert.equal(t.editor.state.edit.adjustments.hue, 4);
    });
});

describe("Pinterest editor: presets and saving", () => {
    it("saves the current colours under a name and refreshes the list", async () => {
        const t = await ready();
        t.editor.adjust("sepia", 40);
        await t.editor.savePreset("warm");
        assert.deepEqual(t.calls, ["save:warm"]);
        assert.equal(t.editor.state.notice, "Preset saved");
        assert.equal(t.editor.state.presets[0].adjustments.sepia, 40);
    });

    it("says it when the list is full or the name is empty", async () => {
        const t = await ready();
        await t.editor.savePreset("full");
        assert.equal(t.editor.state.notice, "You have too many saved presets, remove one first");
        await t.editor.savePreset("");
        assert.equal(t.editor.state.notice, "Give the preset a name");
    });

    it("says it when saving or removing a preset fails", async () => {
        const t = await ready();
        t.fail.save = true;
        await t.editor.savePreset("a");
        assert.equal(t.editor.state.notice, "save broke");
        t.fail.remove = true;
        await t.editor.removePreset("a");
        assert.equal(t.editor.state.notice, "remove broke");
    });

    it("removes a preset and refreshes the list", async () => {
        const t = await ready();
        await t.editor.savePreset("a");
        await t.editor.removePreset("a");
        assert.deepEqual(t.calls, ["save:a", "remove:a"]);
        assert.deepEqual(t.editor.state.presets, []);
        assert.equal(t.editor.state.notice, "Preset removed");
    });

    it("saves a PNG with the plan and a file name that tells the shape, and says so", async () => {
        const t = await ready();
        t.editor.setOutput("BANNER");
        await t.editor.save();
        assert.equal(t.saved.length, 1);
        assert.equal(t.saved[0].filename, "pinterest-abc-banner.png");
        assert.equal(t.editor.state.notice, "Saved to your downloads");
        assert.equal(t.editor.state.saving, false);
    });

    it("is busy while saving and takes no second save then", async () => {
        const t = await ready();
        t.exports.auto = false;
        const first = t.editor.save();
        assert.equal(t.editor.state.saving, true);
        await t.editor.save();
        assert.equal(t.exports.count, 1);
        t.exports.next.resolve(new Blob(["x"]));
        await first;
        assert.equal(t.saved.length, 1);
        assert.equal(t.editor.state.saving, false);
    });

    it("tells the person when the PNG could not be made, and can try again", async () => {
        const t = await ready();
        t.fail.export = true;
        await t.editor.save();
        assert.equal(t.editor.state.notice, "Could not save: no png");
        assert.equal(t.editor.state.saving, false);
        assert.equal(t.saved.length, 0);
        t.fail.export = false;
        await t.editor.save();
        assert.equal(t.saved.length, 1);
    });

    it("does not hand over a file when the editor was closed meanwhile", async () => {
        const t = await ready();
        t.exports.auto = false;
        const pending = t.editor.save();
        t.editor.close();
        t.exports.next.resolve(new Blob(["x"]));
        await pending;
        assert.equal(t.saved.length, 0);
    });
});

describe("Pinterest editor: listening and closing", () => {
    it("tells listeners at every change, stops for one that unsubscribes, and survives one that throws", async () => {
        const t = await ready();
        let heard = 0;
        const stop = t.editor.subscribe(() => { heard++; });
        t.editor.subscribe(() => { throw new Error("bad screen"); });
        t.editor.adjust("hue", 1);
        assert.ok(heard >= 1);
        const before = heard;
        stop();
        t.editor.adjust("hue", 2);
        assert.equal(heard, before);
    });

    it("on close lets the picture go once, and then ignores everything", async () => {
        const t = await ready();
        let heard = 0;
        t.editor.subscribe(() => { heard++; });
        t.editor.close();
        t.editor.close();
        assert.deepEqual(t.released, ["released"]);
        t.editor.adjust("hue", 5);
        t.editor.attachCanvas("again");
        assert.equal(heard, 0);
        assert.equal(t.drawn.length, 0);
        await t.editor.save();
        assert.equal(t.exports.count, 0);
    });
});

// --- The canvas ----------------------------------------------------------------------------------------------------------------------------------------

function fakeCanvas() {
    const log: Array<[string, ...unknown[]]> = [];
    const canvas: CanvasLike & { log: typeof log; pixels: Uint8ClampedArray | null; blobType?: string; } = {
        width: 0,
        height: 0,
        log,
        pixels: null,
        getContext: () => ({
            save: () => { log.push(["save"]); },
            restore: () => { log.push(["restore"]); },
            translate: (x: number, y: number) => { log.push(["translate", x, y]); },
            rotate: (angle: number) => { log.push(["rotate", angle]); },
            scale: (x: number, y: number) => { log.push(["scale", x, y]); },
            drawImage: (...args: unknown[]) => { log.push(["drawImage", ...args]); },
            getImageData: (x: number, y: number, w: number, h: number) => {
                log.push(["getImageData", x, y, w, h]);
                canvas.pixels = new Uint8ClampedArray(w * h * 4).fill(100);
                return { data: canvas.pixels };
            },
            putImageData: (_data: unknown, x: number, y: number) => { log.push(["putImageData", x, y]); }
        }) as never,
        toBlob: (callback, type) => { canvas.blobType = type; callback(new Blob(["p"], { type: "image/png" })); }
    };
    return canvas;
}

const plan = (extra: Partial<OutputPlan> = {}): OutputPlan => ({ sx: 10, sy: 20, sw: 300, sh: 200, outWidth: 150, outHeight: 100, rotation: 0, flipH: false, flipV: false, ...extra });

describe("Pinterest editor: drawing", () => {
    it("turns the picture on a scratch canvas, then cuts and scales it onto the target and applies the colours", () => {
        const target = fakeCanvas();
        const scratches: Array<ReturnType<typeof fakeCanvas>> = [];
        drawPlan(target, "image", { width: 800, height: 600 }, plan({ rotation: 90, flipH: true }), { ...NEUTRAL, brightness: 10 }, () => { const c = fakeCanvas(); scratches.push(c); return c; });
        assert.equal(scratches.length, 1);
        const scratch = scratches[0];
        assert.deepEqual([scratch.width, scratch.height], [600, 800], "a quarter turn swaps the sides");
        assert.deepEqual(scratch.log, [["translate", 300, 400], ["rotate", Math.PI / 2], ["scale", -1, 1], ["drawImage", "image", -400, -300]]);
        assert.deepEqual([target.width, target.height], [150, 100]);
        assert.deepEqual(target.log[0], ["drawImage", scratch, 10, 20, 300, 200, 0, 0, 150, 100]);
        assert.deepEqual(target.log[1], ["getImageData", 0, 0, 150, 100]);
        assert.equal(target.pixels![0], 126, "the colours were applied to the pixels");
        assert.equal(target.pixels![3], 100, "not to alpha");
        assert.deepEqual(target.log[2], ["putImageData", 0, 0]);
    });

    it("keeps the sides for no turn or a half turn, and mirrors the other way for flipV", () => {
        for (const rotation of [0, 180] as const) {
            const scratches: Array<ReturnType<typeof fakeCanvas>> = [];
            drawPlan(fakeCanvas(), "image", { width: 800, height: 600 }, plan({ rotation, flipV: true }), NEUTRAL, () => { const c = fakeCanvas(); scratches.push(c); return c; });
            assert.deepEqual([scratches[0].width, scratches[0].height], [800, 600], String(rotation));
            assert.deepEqual(scratches[0].log[1], ["rotate", (rotation * Math.PI) / 180]);
            assert.deepEqual(scratches[0].log[2], ["scale", 1, -1]);
        }
        const scratches: Array<ReturnType<typeof fakeCanvas>> = [];
        drawPlan(fakeCanvas(), "image", { width: 800, height: 600 }, plan({ rotation: 270 }), NEUTRAL, () => { const c = fakeCanvas(); scratches.push(c); return c; });
        assert.deepEqual([scratches[0].width, scratches[0].height], [600, 800]);
    });

    it("sets a good smoothing quality", () => {
        const target = fakeCanvas();
        let quality: unknown;
        const real = target.getContext;
        target.getContext = kind => { const context = real(kind) as { imageSmoothingQuality?: unknown; }; Object.defineProperty(context, "imageSmoothingQuality", { set: value => { quality = value; }, get: () => quality }); return context as never; };
        drawPlan(target, "image", { width: 10, height: 10 }, plan(), NEUTRAL, fakeCanvas);
        assert.equal(quality, "high");
    });

    it("says it when the page gives no canvas context", () => {
        const none = (): CanvasLike => ({ width: 0, height: 0, getContext: () => null });
        assert.throws(() => { drawPlan(fakeCanvas(), "image", { width: 10, height: 10 }, plan(), NEUTRAL, none); }, /could not give a canvas/);
        const good = fakeCanvas();
        const scratchOk = (() => { let first = true; return (): CanvasLike => { if (first) { first = false; return fakeCanvas(); } return none(); }; })();
        assert.throws(() => { drawPlan(none(), "image", { width: 10, height: 10 }, plan(), NEUTRAL, scratchOk); }, /could not give a canvas/);
        void good;
    });

    it("makes a PNG, or says why not", async () => {
        const made: Array<ReturnType<typeof fakeCanvas>> = [];
        const blob = await exportPng("image", { width: 800, height: 600 }, plan(), NEUTRAL, () => { const c = fakeCanvas(); made.push(c); return c; });
        assert.equal(blob.type, "image/png");
        assert.ok(made.some(c => c.blobType === "image/png"), "asked for a PNG");
        const noBlob = (): CanvasLike => { const c = fakeCanvas(); delete c.toBlob; return c; };
        await assert.rejects(exportPng("image", { width: 10, height: 10 }, plan(), NEUTRAL, noBlob), /cannot make a PNG/);
        const empty = (): CanvasLike => { const c = fakeCanvas(); c.toBlob = callback => { callback(null); }; return c; };
        await assert.rejects(exportPng("image", { width: 10, height: 10 }, plan(), NEUTRAL, empty), /could not make the PNG/);
    });
});

// --- The glue with the page ------------------------------------------------------------------------------------------------------------------------------

const picture = (extra: Partial<PinterestImageResult> = {}): PinterestImageResult => ({ id: "pin-1", title: "t", description: "", url: "https://i.pinimg.com/originals/a.jpg", width: 10, height: 10, dominantColor: null, pinterestUrl: null, isGif: false, ...extra });

function fakeTools(options: { failFirst?: boolean; type?: string; bitmapFails?: boolean; } = {}) {
    const fetched: string[] = [];
    const closed: string[] = [];
    const downloads: Array<{ blob: Blob; filename: string; }> = [];
    const blobs: Blob[] = [];
    let canvases = 0;
    const tools: PageTools = {
        fetchMedia: async url => {
            fetched.push(url);
            if (options.failFirst && fetched.length === 1) throw new Error("original is gone");
            return { data: new ArrayBuffer(4), type: options.type ?? "image/jpeg", filename: "a.jpg" } satisfies MediaResult;
        },
        createBitmap: async blob => {
            blobs.push(blob);
            if (options.bitmapFails) throw new Error("cannot decode");
            return { width: 640, height: 480, close: () => { closed.push("closed"); } };
        },
        makeCanvas: () => { canvases++; return fakeCanvas(); },
        download: (blob, filename) => { downloads.push({ blob, filename }); }
    };
    return { tools, fetched, closed, downloads, blobs, canvases: () => canvases };
}

const noPresets = { list: async () => [], save: async () => "saved" as const, remove: async () => true };

describe("Pinterest editor: the glue with the page", () => {
    it("loads the full picture, draws it and saves it through the page", async () => {
        const t = fakeTools();
        const editor = createEditorFor(picture(), "BANNER", t.tools, noPresets);
        const canvas = fakeCanvas();
        editor.attachCanvas(canvas);
        await editor.init();
        assert.equal(editor.state.status, "ready");
        assert.deepEqual(t.fetched, ["https://i.pinimg.com/originals/a.jpg"]);
        assert.equal(t.blobs[0].type, "image/jpeg", "the picture keeps its type");
        assert.equal(editor.state.edit.output, "BANNER");
        assert.equal(canvas.width, 640, "a banner of a 640 wide picture is 640 wide");
        assert.equal(canvas.height, 256);
        assert.equal(t.canvases() >= 1, true, "a scratch canvas was asked for");
        await editor.save();
        assert.equal(t.downloads.length, 1);
        assert.equal(t.downloads[0].filename, "pinterest-pin-1-banner.png");
        editor.close();
        assert.deepEqual(t.closed, ["closed"]);
    });

    it("tries the smaller copy when the original cannot be had", async () => {
        const t = fakeTools({ failFirst: true });
        const editor = createEditorFor(picture({ fallbackUrl: "https://i.pinimg.com/736x/a.jpg" }), "AVATAR", t.tools, noPresets);
        await editor.init();
        assert.equal(editor.state.status, "ready");
        assert.deepEqual(t.fetched, ["https://i.pinimg.com/originals/a.jpg", "https://i.pinimg.com/736x/a.jpg"]);
    });

    it("does not ask twice for the same address", async () => {
        const t = fakeTools({ failFirst: true });
        const editor = createEditorFor(picture({ fallbackUrl: "https://i.pinimg.com/originals/a.jpg" }), "AVATAR", t.tools, noPresets);
        await editor.init();
        assert.equal(editor.state.status, "error");
        assert.deepEqual(t.fetched, ["https://i.pinimg.com/originals/a.jpg"]);
        assert.equal(editor.state.error, "original is gone");
    });

    it("refuses an answer that is not a picture, or one the page cannot decode", async () => {
        const html = createEditorFor(picture(), "AVATAR", fakeTools({ type: "text/html" }).tools, noPresets);
        await html.init();
        assert.equal(html.state.status, "error");
        assert.match(html.state.error!, /not a picture/);
        const broken = createEditorFor(picture(), "AVATAR", fakeTools({ bitmapFails: true }).tools, noPresets);
        await broken.init();
        assert.equal(broken.state.error, "cannot decode");
    });

    it("says something even if a non-error was thrown", async () => {
        const tools = fakeTools().tools;
        tools.fetchMedia = () => Promise.reject("odd");
        const editor = createEditorFor(picture(), "AVATAR", tools, noPresets);
        await editor.init();
        assert.equal(editor.state.error, "The picture could not be loaded.");
    });

    it("names files safely", () => {
        assert.equal(fileBase("1234_ab-C"), "pinterest-1234_ab-C");
        assert.equal(fileBase("../../evil name.exe"), "pinterest-evilnameexe");
        assert.equal(fileBase("???"), "pinterest-picture");
        assert.equal(fileBase("x".repeat(100)), `pinterest-${"x".repeat(40)}`);
    });

    it("gives the presets it was given to the editor", async () => {
        const saved: string[] = [];
        const editor = createEditorFor(picture(), "AVATAR", fakeTools().tools, { ...noPresets, save: async name => { saved.push(name); return "saved" as const; } });
        await editor.init();
        await editor.savePreset("mine");
        assert.deepEqual(saved, ["mine"]);
    });
});
