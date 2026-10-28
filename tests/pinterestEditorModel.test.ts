/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PluginStorage } from "../src/api/storage";
import {
    ADJUSTMENT_RANGES, BUILT_IN_PRESETS, cleanPresetName, cropRect, EditHistory, EDITOR_LIMITS, flip, initialState, isNeutral, isUntouched, NEUTRAL, OUTPUT, pan, planOutput,
    PresetStore, rotate, rotatedSize, sameAdjustments, sanitizeAdjustments, setAdjustment, setOutput, setTint, setZoom, withAdjustments
} from "../src/testcordplugins/PinterestTool/editorModel";

const dims = { width: 1000, height: 500 };

function memoryStorage(initial: Record<string, unknown> = {}) {
    const data = new Map<string, unknown>(Object.entries(initial));
    const storage = {
        get: async (key: string) => data.get(key),
        set: async (key: string, value: unknown) => { data.set(key, value); },
        delete: async (key: string) => { data.delete(key); },
        keys: async () => [...data.keys()]
    } as unknown as PluginStorage;
    return { storage, data };
}

describe("Pinterest editor: the crop", () => {
    it("starts untouched, centred, whole and unturned", () => {
        const state = initialState("AVATAR");
        assert.deepEqual(state, { output: "AVATAR", rotation: 0, flipH: false, flipV: false, zoom: 1, centerX: 0.5, centerY: 0.5, adjustments: NEUTRAL });
        assert.notEqual(state.adjustments, NEUTRAL, "its own copy");
        assert.equal(isUntouched(state), true);
    });

    it("cuts the biggest square from a wide picture, and the biggest 5:2 band from it", () => {
        assert.deepEqual(cropRect(initialState("AVATAR"), dims), { sx: 250, sy: 0, sw: 500, sh: 500 });
        assert.deepEqual(cropRect(initialState("BANNER"), dims), { sx: 0, sy: 50, sw: 1000, sh: 400 });
    });

    it("cuts from a tall picture too, and from a turned one", () => {
        assert.deepEqual(cropRect(initialState("AVATAR"), { width: 500, height: 1000 }), { sx: 0, sy: 250, sw: 500, sh: 500 });
        assert.deepEqual(cropRect(initialState("BANNER"), { width: 500, height: 1000 }), { sx: 0, sy: 400, sw: 500, sh: 200 });
        assert.deepEqual(cropRect({ ...initialState("AVATAR"), rotation: 90 }, dims), { sx: 0, sy: 250, sw: 500, sh: 500 });
        assert.deepEqual(rotatedSize(dims, 90), { width: 500, height: 1000 });
        assert.deepEqual(rotatedSize(dims, 270), { width: 500, height: 1000 });
        assert.deepEqual(rotatedSize(dims, 180), dims);
        assert.deepEqual(rotatedSize(dims, 0), dims);
    });

    it("zooming makes the frame smaller around the same centre", () => {
        const zoomed = setZoom(initialState("AVATAR"), 2, dims);
        assert.equal(zoomed.zoom, 2);
        assert.deepEqual(cropRect(zoomed, dims), { sx: 375, sy: 125, sw: 250, sh: 250 });
    });

    it("keeps the zoom between 1 and 8 and ignores a number that is not one", () => {
        const start = initialState("AVATAR");
        assert.equal(setZoom(start, 0.2, dims).zoom, EDITOR_LIMITS.minZoom);
        assert.equal(setZoom(start, 50, dims).zoom, EDITOR_LIMITS.maxZoom);
        assert.equal(setZoom(start, NaN, dims), start);
        assert.equal(setZoom(start, Infinity, dims), start);
        assert.equal(cropRect({ ...start, zoom: 99 }, dims).sw, 500 / 8, "a zoom stored out of range is still cut within it");
        assert.equal(cropRect({ ...start, zoom: 0.1 }, dims).sw, 500);
    });

    it("moves the frame, and never lets it leave the picture or remember a distance it could not go", () => {
        const start = initialState("AVATAR");
        assert.equal(pan(start, 0.1, 0, dims).centerX, 0.6);
        const far = pan(start, 0.5, 0, dims);
        assert.equal(far.centerX, 0.75, "stops at the edge");
        assert.deepEqual(cropRect(far, dims), { sx: 500, sy: 0, sw: 500, sh: 500 });
        assert.equal(pan(far, -0.1, 0, dims).centerX, 0.65, "coming back moves at once");
        const up = pan(setZoom(start, 2, dims), 0, -1, dims);
        assert.equal(up.centerY, 0.25);
        assert.equal(pan(start, NaN, 0, dims), start);
        assert.equal(pan(start, 0, Infinity, dims), start);
    });

    it("turns by quarters in both directions and goes back to the whole picture", () => {
        const moved = pan(setZoom(initialState("AVATAR"), 3, dims), 0.1, 0.1, dims);
        const right = rotate(moved, 1);
        assert.equal(right.rotation, 90);
        assert.equal(right.zoom, 1);
        assert.equal(right.centerX, 0.5);
        assert.equal(right.centerY, 0.5);
        assert.equal(rotate({ ...moved, rotation: 270 }, 1).rotation, 0);
        assert.equal(rotate(initialState("AVATAR"), -1).rotation, 270);
        assert.equal(rotate({ ...moved, rotation: 90 }, -1).rotation, 0);
        assert.equal(rotate({ ...moved, rotation: 180 }, 1).rotation, 270);
    });

    it("mirrors and keeps the frame over the same part of the picture", () => {
        const start = { ...initialState("AVATAR"), centerX: 0.3, centerY: 0.2 };
        const h = flip(start, "H");
        assert.equal(h.flipH, true);
        assert.equal(h.centerX, 0.7);
        assert.equal(h.centerY, 0.2);
        const v = flip(start, "V");
        assert.equal(v.flipV, true);
        assert.equal(v.centerY, 0.8);
        assert.equal(v.centerX, 0.3);
        assert.equal(flip(h, "H").flipH, false);
        assert.equal(flip(v, "V").flipV, false);
    });

    it("changing the shape keeps the frame inside the picture", () => {
        const wide = pan(setZoom(initialState("BANNER"), 2, dims), 0.9, 0.9, dims);
        const square = setOutput(wide, "AVATAR", dims);
        assert.equal(square.output, "AVATAR");
        const crop = cropRect(square, dims);
        assert.ok(crop.sx >= 0 && crop.sx + crop.sw <= dims.width && crop.sy >= 0 && crop.sy + crop.sh <= dims.height);
        const same = initialState("AVATAR");
        assert.equal(setOutput(same, "AVATAR", dims), same);
    });

    it("plans the output: the shape of the choice, never bigger than the cut or than the limit", () => {
        assert.deepEqual(planOutput(initialState("AVATAR"), dims), { sx: 250, sy: 0, sw: 500, sh: 500, outWidth: 500, outHeight: 500, rotation: 0, flipH: false, flipV: false });
        assert.deepEqual(planOutput(initialState("BANNER"), dims), { sx: 0, sy: 50, sw: 1000, sh: 400, outWidth: 1000, outHeight: 400, rotation: 0, flipH: false, flipV: false });
        const huge = planOutput(initialState("AVATAR"), { width: 3000, height: 3000 });
        assert.equal(huge.outWidth, OUTPUT.AVATAR.maxWidth);
        assert.equal(huge.outHeight, OUTPUT.AVATAR.maxHeight);
        const banner = planOutput(initialState("BANNER"), { width: 4000, height: 2000 });
        assert.equal(banner.outWidth, 1200);
        assert.equal(banner.outHeight, 480);
        assert.deepEqual([planOutput(initialState("BANNER"), { width: 4, height: 2 }).outWidth, planOutput(initialState("BANNER"), { width: 4, height: 2 }).outHeight], [4, 2], "the height is rounded, not cut");
        const tiny = planOutput(initialState("AVATAR"), { width: 3, height: 2 });
        assert.deepEqual([tiny.outWidth, tiny.outHeight], [2, 2]);
        const sliver = planOutput(initialState("BANNER"), { width: 1, height: 1 });
        assert.deepEqual([sliver.outWidth, sliver.outHeight], [1, 1], "never zero");
        const turned = planOutput({ ...initialState("AVATAR"), rotation: 90, flipH: true }, dims);
        assert.equal(turned.rotation, 90);
        assert.equal(turned.flipH, true);
        assert.equal(turned.flipV, false);
    });
});

describe("Pinterest editor: the colours", () => {
    it("keeps every value inside its range and whole", () => {
        const start = initialState("AVATAR");
        assert.equal(setAdjustment(start, "brightness", 150).adjustments.brightness, 100);
        assert.equal(setAdjustment(start, "brightness", -150).adjustments.brightness, -100);
        assert.equal(setAdjustment(start, "brightness", 12.6).adjustments.brightness, 13);
        assert.equal(setAdjustment(start, "hue", -500).adjustments.hue, -180);
        assert.equal(setAdjustment(start, "hue", 500).adjustments.hue, 180);
        assert.equal(setAdjustment(start, "grayscale", -5).adjustments.grayscale, 0);
        assert.equal(setAdjustment(start, "sepia", 101).adjustments.sepia, 100);
        assert.equal(setAdjustment(start, "tintAmount", 40).adjustments.tintAmount, 40);
        assert.equal(setAdjustment(start, "contrast", NaN), start);
        assert.equal(setAdjustment(start, "contrast", Infinity), start);
        assert.equal(setAdjustment(start, "contrast", "5" as unknown as number), start);
        assert.equal(setAdjustment(start, "saturation", 7).adjustments.saturation, 7);
        assert.equal(start.adjustments.brightness, 0, "the old state is not changed");
    });

    it("accepts a tint colour only as #rrggbb and writes it in lower case", () => {
        const start = initialState("AVATAR");
        assert.equal(setTint(start, "#ABCDEF").adjustments.tint, "#abcdef");
        for (const bad of ["red", "#abc", "#abcdeg", "abcdef", "#abcdef0", ""]) assert.equal(setTint(start, bad), start, bad);
    });

    it("rebuilds adjustments from anything", () => {
        assert.deepEqual(sanitizeAdjustments(null), NEUTRAL);
        assert.deepEqual(sanitizeAdjustments("x"), NEUTRAL);
        assert.deepEqual(sanitizeAdjustments([1, 2]), NEUTRAL);
        const dirty = sanitizeAdjustments({ brightness: "5", contrast: 200, hue: 3.4, saturation: NaN, sepia: -9, grayscale: 50, tintAmount: 20.5, tint: "zzz", extra: 1 });
        assert.deepEqual(dirty, { brightness: 0, contrast: 100, saturation: 0, hue: 3, grayscale: 50, sepia: 0, tint: "#f59e0b", tintAmount: 21 });
        assert.equal(sanitizeAdjustments({ tint: "#00FF00" }).tint, "#00ff00");
        assert.notEqual(sanitizeAdjustments(null), NEUTRAL);
    });

    it("withAdjustments puts a whole look in, cleaned", () => {
        const state = withAdjustments(initialState("AVATAR"), { ...NEUTRAL, brightness: 999, sepia: 30 });
        assert.equal(state.adjustments.brightness, 100);
        assert.equal(state.adjustments.sepia, 30);
    });

    it("knows when the colours do nothing, and compares two looks", () => {
        assert.equal(isNeutral(NEUTRAL), true);
        for (const key of Object.keys(ADJUSTMENT_RANGES) as Array<keyof typeof ADJUSTMENT_RANGES>) assert.equal(isNeutral({ ...NEUTRAL, [key]: 1 }), false, key);
        assert.equal(isNeutral({ ...NEUTRAL, tint: "#000000" }), true, "a colour with no amount does nothing");
        assert.equal(sameAdjustments(NEUTRAL, { ...NEUTRAL }), true);
        assert.equal(sameAdjustments(NEUTRAL, { ...NEUTRAL, tint: "#000000" }), false);
        for (const key of Object.keys(ADJUSTMENT_RANGES) as Array<keyof typeof ADJUSTMENT_RANGES>) assert.equal(sameAdjustments(NEUTRAL, { ...NEUTRAL, [key]: 2 }), false, key);
    });

    it("says an edit is untouched only when nothing was changed", () => {
        const start = initialState("BANNER");
        assert.equal(isUntouched(start), true);
        assert.equal(isUntouched({ ...start, rotation: 90 }), false);
        assert.equal(isUntouched({ ...start, flipH: true }), false);
        assert.equal(isUntouched({ ...start, flipV: true }), false);
        assert.equal(isUntouched({ ...start, zoom: 1.5 }), false);
        assert.equal(isUntouched({ ...start, centerX: 0.4 }), false);
        assert.equal(isUntouched({ ...start, centerY: 0.4 }), false);
        assert.equal(isUntouched({ ...start, adjustments: { ...NEUTRAL, hue: 1 } }), false);
        assert.equal(isUntouched(start, "AVATAR"), false, "another shape counts as a change");
    });

    it("has built-in presets with distinct names, starting with a neutral one, all valid", () => {
        assert.equal(BUILT_IN_PRESETS[0].name, "Original");
        assert.equal(isNeutral(BUILT_IN_PRESETS[0].adjustments), true);
        assert.equal(new Set(BUILT_IN_PRESETS.map(preset => preset.name.toLowerCase())).size, BUILT_IN_PRESETS.length);
        for (const preset of BUILT_IN_PRESETS.slice(1)) assert.equal(isNeutral(preset.adjustments), false, preset.name);
        for (const preset of BUILT_IN_PRESETS) assert.deepEqual(sanitizeAdjustments(preset.adjustments), preset.adjustments, preset.name);
    });
});

describe("Pinterest editor: undo and redo", () => {
    const step = (state = initialState("AVATAR"), value = 1) => setAdjustment(state, "brightness", value);

    it("goes back and forward over each step", () => {
        const history = new EditHistory(initialState("AVATAR"));
        assert.equal(history.canUndo, false);
        assert.equal(history.canRedo, false);
        assert.equal(history.undo(), false);
        assert.equal(history.redo(), false);
        history.push(step(history.present, 10));
        history.push(setAdjustment(history.present, "contrast", 20));
        assert.equal(history.canUndo, true);
        assert.equal(history.undo(), true);
        assert.equal(history.present.adjustments.contrast, 0);
        assert.equal(history.present.adjustments.brightness, 10);
        assert.equal(history.canRedo, true);
        assert.equal(history.redo(), true);
        assert.equal(history.present.adjustments.contrast, 20);
        assert.equal(history.canRedo, false);
        history.undo();
        history.undo();
        assert.equal(history.present.adjustments.brightness, 0);
        assert.equal(history.canUndo, false);
    });

    it("redo puts the step back so it can be undone again", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push(step(history.present, 10));
        history.push(step(history.present, 20));
        history.undo();
        history.redo();
        history.undo();
        assert.equal(history.present.adjustments.brightness, 10);
        assert.equal(history.canUndo, true);
    });

    it("an undo ends the gesture, so the same gesture afterwards is a new step", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push(step(history.present, 10), "slider");
        history.undo();
        history.push(step(history.present, 20), "slider");
        assert.equal(history.canUndo, true);
    });

    it("does nothing when nothing changed", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push({ ...initialState("AVATAR") });
        assert.equal(history.canUndo, false);
    });

    it("forgets what could be redone when a new change is made", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push(step(history.present, 10));
        history.undo();
        assert.equal(history.canRedo, true);
        history.push(step(history.present, 30));
        assert.equal(history.canRedo, false);
        assert.equal(history.present.adjustments.brightness, 30);
    });

    it("makes one step of a whole drag, and a new one after the drag ends or with another gesture", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push(step(history.present, 10), "slider");
        history.push(step(history.present, 20), "slider");
        history.push(step(history.present, 30), "slider");
        history.undo();
        assert.equal(history.present.adjustments.brightness, 0, "one undo for the whole drag");
        history.redo();
        history.endGesture();
        history.push(step(history.present, 40), "slider");
        history.undo();
        assert.equal(history.present.adjustments.brightness, 30);
        history.push(setAdjustment(history.present, "contrast", 5), "other");
        history.push(setAdjustment(history.present, "contrast", 6), "another");
        history.undo();
        assert.equal(history.present.adjustments.contrast, 5);
    });

    it("a change without a gesture is always its own step, even twice in a row", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push(step(history.present, 10));
        history.push(step(history.present, 20));
        history.undo();
        assert.equal(history.present.adjustments.brightness, 10);
    });

    it("undo and redo end a gesture", () => {
        const history = new EditHistory(initialState("AVATAR"));
        history.push(step(history.present, 10), "slider");
        history.undo();
        history.redo();
        history.push(step(history.present, 20), "slider");
        history.undo();
        assert.equal(history.present.adjustments.brightness, 10);
    });

    it("keeps at most 50 steps", () => {
        const history = new EditHistory(initialState("AVATAR"));
        for (let i = 1; i <= EDITOR_LIMITS.history + 10; i++) history.push(step(history.present, i % 100));
        let undone = 0;
        while (history.undo()) undone++;
        assert.equal(undone, EDITOR_LIMITS.history);
    });
});

describe("Pinterest editor: the person's presets", () => {
    const look = { ...NEUTRAL, sepia: 40 };

    it("saves, lists, replaces a name in any letter case, and removes", async () => {
        const { storage } = memoryStorage();
        const store = new PresetStore(storage);
        assert.deepEqual(await store.list(), []);
        assert.equal(await store.save("  My look ", look), "saved");
        assert.deepEqual(await store.list(), [{ name: "My look", adjustments: look }]);
        assert.equal(await store.save("MY LOOK", { ...look, sepia: 70 }), "replaced");
        const after = await store.list();
        assert.equal(after.length, 1);
        assert.equal(after[0].name, "MY LOOK");
        assert.equal(after[0].adjustments.sepia, 70);
        assert.equal(await store.remove("my look"), true);
        assert.equal(await store.remove("my look"), false);
        assert.deepEqual(await store.list(), []);
    });

    it("refuses an empty name or one that is not text, cleans odd characters, and cuts long names", async () => {
        const { storage } = memoryStorage();
        const store = new PresetStore(storage);
        assert.equal(await store.save("   ", look), "invalid");
        assert.equal(await store.save(5 as unknown as string, look), "invalid");
        assert.equal(await store.save("a\u0000\tb\nc", look), "saved");
        assert.equal(await store.save("x".repeat(80), look), "saved");
        const names = (await store.list()).map(preset => preset.name);
        assert.deepEqual(names, ["a b c", "x".repeat(EDITOR_LIMITS.presetNameChars)]);
        assert.equal(await store.remove(""), false);
        assert.equal(await store.remove(7 as unknown as string), false);
    });

    it("keeps at most 30, and still replaces when full", async () => {
        const { storage } = memoryStorage();
        const store = new PresetStore(storage);
        for (let i = 0; i < EDITOR_LIMITS.presets; i++) assert.equal(await store.save(`p${i}`, look), "saved");
        assert.equal(await store.save("one more", look), "full");
        assert.equal(await store.save("P3", { ...look, sepia: 90 }), "replaced");
        assert.equal((await store.list()).length, EDITOR_LIMITS.presets);
    });

    it("rebuilds what it reads, dropping damaged, repeated or too many entries", async () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, adjustments: { sepia: 5 } }));
        const { storage } = memoryStorage({ editorPresets: [null, 5, "x", { name: 3 }, { name: "  " }, { name: "A", adjustments: { sepia: 500, tint: "bad" } }, { name: "a", adjustments: {} }, ...many] });
        const list = await new PresetStore(storage).list();
        assert.equal(list.length, EDITOR_LIMITS.presets);
        assert.deepEqual(list[0], { name: "A", adjustments: { ...NEUTRAL, sepia: 100 } });
        assert.equal(list.filter(item => item.name.toLowerCase() === "a").length, 1);
        const { storage: broken } = memoryStorage({ editorPresets: "not a list" });
        assert.deepEqual(await new PresetStore(broken).list(), []);
    });

    it("saves only plain data under its own key", async () => {
        const { storage, data } = memoryStorage();
        await new PresetStore(storage).save("one", { ...look, extra: 1 } as never);
        assert.deepEqual([...data.keys()], ["editorPresets"]);
        assert.deepEqual(data.get("editorPresets"), [{ name: "one", adjustments: look }]);
    });

    it("does one change at a time, so quick saves are all kept, and a failure does not stop the next", async () => {
        const { storage } = memoryStorage();
        const store = new PresetStore(storage);
        const results = await Promise.all([store.save("a", look), store.save("b", look), store.save("c", look)]);
        assert.deepEqual(results, ["saved", "saved", "saved"]);
        assert.equal((await store.list()).length, 3);
        let fail = true;
        const flaky = new PresetStore({ get: async () => { if (fail) throw new Error("down"); return []; }, set: async () => undefined } as unknown as PluginStorage);
        await assert.rejects(flaky.list(), /down/);
        fail = false;
        assert.deepEqual(await flaky.list(), []);
    });

    it("cleanPresetName cleans or refuses", () => {
        assert.equal(cleanPresetName("  hi   there "), "hi there");
        assert.equal(cleanPresetName(""), null);
        assert.equal(cleanPresetName(undefined), null);
        assert.equal(cleanPresetName("a".repeat(31)), "a".repeat(30));
        assert.equal(cleanPresetName(`${"a".repeat(29)} b`), `${"a".repeat(29)}`, "a cut that ends in a space loses it");
    });
});
