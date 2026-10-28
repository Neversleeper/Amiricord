/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What happens inside one open editor, without React or a real canvas: loading the picture, every change (kept in the history), the presets and saving a file.
// Drawing, loading and saving go through functions given from outside, so the tests use fakes. The screen (`EditorView.tsx`) only draws `state` and calls these
// methods. Design: docs/analysis-34-pinterest-tool-editor.md.

import {
    type Adjustments, cropRect, EditHistory, EDITOR_LIMITS, type EditState, flip, initialState, isUntouched, NEUTRAL, type NumericAdjustment, type OutputKind, type OutputPlan, pan, planOutput,
    type Preset, rotate, rotatedSize, setAdjustment, setOutput, setTint, setZoom, withAdjustments
} from "./editorModel";
import { describeFailure } from "./windowSession";

export interface LoadedSource {
    width: number;
    height: number;
    /** Whatever the drawing function understands (an `ImageBitmap` in the page). */
    source: unknown;
    /** Let the picture's memory go. */
    release?(): void;
}

export interface EditorDeps {
    load(): Promise<LoadedSource>;
    draw(canvas: unknown, source: unknown, plan: OutputPlan, adjustments: Adjustments): void;
    exportPng(source: unknown, plan: OutputPlan, adjustments: Adjustments): Promise<Blob>;
    saveFile(blob: Blob, filename: string): void;
    presets: {
        list(): Promise<Preset[]>;
        save(name: string, adjustments: Adjustments): Promise<"saved" | "replaced" | "full" | "invalid">;
        remove(name: string): Promise<boolean>;
    };
}

export interface EditorState {
    status: "loading" | "ready" | "error";
    error: string | null;
    edit: EditState;
    canUndo: boolean;
    canRedo: boolean;
    /** Show the cut picture without the colour changes, to compare. */
    showOriginal: boolean;
    presets: Preset[];
    notice: string | null;
    saving: boolean;
    /** True when nothing has been changed yet. */
    untouched: boolean;
}

const PRESET_NOTICES = { saved: "Preset saved", replaced: "Preset replaced", full: "You have too many saved presets, remove one first", invalid: "Give the preset a name" } as const;

export class EditorSession {
    private readonly history: EditHistory;
    private loaded: LoadedSource | null = null;
    private canvas: unknown = null;
    private closed = false;
    private current: EditorState;
    private readonly listeners = new Set<() => void>();

    /** `name` is the start of the file name when saving. */
    constructor(private readonly deps: EditorDeps, output: OutputKind, private readonly name: string) {
        this.history = new EditHistory(initialState(output));
        this.current = { status: "loading", error: null, edit: this.history.present, canUndo: false, canRedo: false, showOriginal: false, presets: [], notice: null, saving: false, untouched: true };
    }

    get state(): EditorState {
        return this.current;
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private set(patch: Partial<EditorState>) {
        if (this.closed) return;
        this.current = { ...this.current, ...patch };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A screen that fails to redraw must not stop the editor.
            }
        }
    }

    /** Load the picture and the saved presets. Never throws. */
    async init(): Promise<void> {
        const presets = this.deps.presets.list().then(list => { this.set({ presets: list }); }, () => undefined);
        try {
            const loaded = await this.deps.load();
            if (this.closed) {
                loaded.release?.();
                return;
            }
            if (!(loaded.width > 0 && loaded.height > 0) || loaded.width > EDITOR_LIMITS.maxSide || loaded.height > EDITOR_LIMITS.maxSide) {
                loaded.release?.();
                this.set({ status: "error", error: "That picture is too big to edit here." });
            } else {
                this.loaded = loaded;
                this.set({ status: "ready", error: null });
                this.redraw();
            }
        } catch (error) {
            this.set({ status: "error", error: describeFailure(error) });
        }
        await presets;
    }

    /** The `<canvas>` of the screen, or null when it goes away. */
    attachCanvas(canvas: unknown) {
        this.canvas = canvas;
        this.redraw();
    }

    private redraw() {
        if (!this.loaded || !this.canvas || this.closed) return;
        try {
            this.deps.draw(this.canvas, this.loaded.source, planOutput(this.history.present, this.loaded), this.current.showOriginal ? NEUTRAL : this.history.present.adjustments);
        } catch (error) {
            this.set({ notice: `Could not draw the picture: ${describeFailure(error)}` });
        }
    }

    private sync() {
        const edit = this.history.present;
        this.set({ edit, canUndo: this.history.canUndo, canRedo: this.history.canRedo, untouched: isUntouched(edit), notice: null });
        this.redraw();
    }

    private change(next: (edit: EditState, dims: LoadedSource) => EditState, gesture?: string) {
        if (!this.loaded) return;
        this.history.push(next(this.history.present, this.loaded), gesture);
        this.sync();
    }

    adjust(key: NumericAdjustment, value: number) {
        this.change(edit => setAdjustment(edit, key, value), `adjust:${key}`);
    }

    tint(color: string) {
        this.change(edit => setTint(edit, color), "tint");
    }

    zoom(value: number) {
        this.change((edit, dims) => setZoom(edit, value, dims), "zoom");
    }

    /** Move the crop by a fraction of the picture. Moves in a row (one drag) are one step. */
    pan(dx: number, dy: number) {
        this.change((edit, dims) => pan(edit, dx, dy, dims), "pan");
    }

    /** Drag the picture under the frame: the amounts are fractions of the preview, so the picture follows the pointer. */
    drag(fx: number, fy: number) {
        this.change((edit, dims) => {
            const crop = cropRect(edit, dims);
            const size = rotatedSize(dims, edit.rotation);
            return pan(edit, (-fx * crop.sw) / size.width, (-fy * crop.sh) / size.height, dims);
        }, "pan");
    }

    /** The slider or the drag ended: the next change is a new step. */
    endGesture() {
        this.history.endGesture();
    }

    rotate(direction: 1 | -1) {
        this.change(edit => rotate(edit, direction));
    }

    flip(axis: "H" | "V") {
        this.change(edit => flip(edit, axis));
    }

    setOutput(output: OutputKind) {
        this.change((edit, dims) => setOutput(edit, output, dims));
    }

    usePreset(adjustments: Adjustments) {
        this.change(edit => withAdjustments(edit, adjustments));
    }

    reset() {
        this.change(edit => initialState(edit.output));
    }

    undo() {
        if (this.history.undo()) this.sync();
    }

    redo() {
        if (this.history.redo()) this.sync();
    }

    setShowOriginal(show: boolean) {
        if (show === this.current.showOriginal) return;
        this.set({ showOriginal: show });
        this.redraw();
    }

    async savePreset(name: string): Promise<void> {
        try {
            const result = await this.deps.presets.save(name, this.history.present.adjustments);
            this.set({ notice: PRESET_NOTICES[result], presets: await this.deps.presets.list() });
        } catch (error) {
            this.set({ notice: describeFailure(error) });
        }
    }

    async removePreset(name: string): Promise<void> {
        try {
            await this.deps.presets.remove(name);
            this.set({ notice: "Preset removed", presets: await this.deps.presets.list() });
        } catch (error) {
            this.set({ notice: describeFailure(error) });
        }
    }

    /** Make the PNG and hand it to the browser as a download. */
    async save(): Promise<void> {
        const loaded = this.loaded;
        if (!loaded || this.current.saving) return;
        this.set({ saving: true, notice: null });
        try {
            const edit = this.history.present;
            const blob = await this.deps.exportPng(loaded.source, planOutput(edit, loaded), edit.adjustments);
            if (this.closed) return;
            this.deps.saveFile(blob, `${this.name}-${edit.output.toLowerCase()}.png`);
            this.set({ saving: false, notice: "Saved to your downloads" });
        } catch (error) {
            this.set({ saving: false, notice: `Could not save: ${describeFailure(error)}` });
        }
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.loaded?.release?.();
        this.loaded = null;
        this.canvas = null;
        this.listeners.clear();
    }
}
