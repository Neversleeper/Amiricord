/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The image editor as plain data: what the person chose (crop, turn, flip, colours), the history to undo it, the presets, and the maths that turns a choice into
// pixels to cut. No canvas and no page here, so all of it can be tested. Design: docs/analysis-34-pinterest-tool-editor.md.

import type { PluginStorage } from "../../api/storage";

export type OutputKind = "AVATAR" | "BANNER";
export type Rotation = 0 | 90 | 180 | 270;

/** The shape and the biggest size of what comes out. */
export const OUTPUT = {
    AVATAR: { aspect: 1, maxWidth: 512, maxHeight: 512 },
    BANNER: { aspect: 2.5, maxWidth: 1200, maxHeight: 480 }
} as const;

export const EDITOR_LIMITS = { minZoom: 1, maxZoom: 8, history: 50, presets: 30, presetNameChars: 30, maxSide: 8192 } as const;

export interface Adjustments {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    grayscale: number;
    sepia: number;
    /** A colour mixed over the picture (`#rrggbb`); how much is `tintAmount`. */
    tint: string;
    tintAmount: number;
}

export type NumericAdjustment = Exclude<keyof Adjustments, "tint">;

export const ADJUSTMENT_RANGES: Record<NumericAdjustment, readonly [number, number]> = {
    brightness: [-100, 100],
    contrast: [-100, 100],
    saturation: [-100, 100],
    hue: [-180, 180],
    grayscale: [0, 100],
    sepia: [0, 100],
    tintAmount: [0, 100]
};

export const NEUTRAL: Readonly<Adjustments> = { brightness: 0, contrast: 0, saturation: 0, hue: 0, grayscale: 0, sepia: 0, tint: "#f59e0b", tintAmount: 0 };

export interface EditState {
    output: OutputKind;
    rotation: Rotation;
    flipH: boolean;
    flipV: boolean;
    /** 1 shows the biggest possible part of the picture; more zooms in. */
    zoom: number;
    /** The middle of the crop, as a fraction (0 to 1) of the turned picture. */
    centerX: number;
    centerY: number;
    adjustments: Adjustments;
}

export interface Dims { width: number; height: number; }

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function initialState(output: OutputKind): EditState {
    return { output, rotation: 0, flipH: false, flipV: false, zoom: 1, centerX: 0.5, centerY: 0.5, adjustments: { ...NEUTRAL } };
}

export function rotatedSize(dims: Dims, rotation: Rotation): Dims {
    return rotation === 90 || rotation === 270 ? { width: dims.height, height: dims.width } : { width: dims.width, height: dims.height };
}

export interface CropRect { sx: number; sy: number; sw: number; sh: number; }

/** The crop in pixels of the turned picture. */
export function cropRect(state: EditState, dims: Dims): CropRect {
    const { width, height } = rotatedSize(dims, state.rotation);
    const { aspect } = OUTPUT[state.output];
    const baseW = width / height > aspect ? height * aspect : width;
    const baseH = width / height > aspect ? height : width / aspect;
    const zoom = clamp(state.zoom, EDITOR_LIMITS.minZoom, EDITOR_LIMITS.maxZoom);
    const sw = baseW / zoom;
    const sh = baseH / zoom;
    return {
        sx: clamp(state.centerX * width - sw / 2, 0, width - sw),
        sy: clamp(state.centerY * height - sh / 2, 0, height - sh),
        sw,
        sh
    };
}

/** Keep the centre where the whole crop is inside the picture, so dragging past the edge does not store a hidden distance. */
function settle(state: EditState, dims: Dims): EditState {
    const { width, height } = rotatedSize(dims, state.rotation);
    const crop = cropRect(state, dims);
    return { ...state, centerX: (crop.sx + crop.sw / 2) / width, centerY: (crop.sy + crop.sh / 2) / height };
}

export interface OutputPlan extends CropRect {
    outWidth: number;
    outHeight: number;
    rotation: Rotation;
    flipH: boolean;
    flipV: boolean;
}

/** Everything a canvas needs to draw the result: what to cut, how to turn it and how big it comes out (never bigger than the cut). */
export function planOutput(state: EditState, dims: Dims): OutputPlan {
    const crop = cropRect(state, dims);
    const { aspect, maxWidth, maxHeight } = OUTPUT[state.output];
    const outWidth = Math.max(1, Math.min(maxWidth, Math.floor(crop.sw)));
    const outHeight = Math.max(1, Math.min(maxHeight, Math.round(outWidth / aspect)));
    return { ...crop, outWidth, outHeight, rotation: state.rotation, flipH: state.flipH, flipV: state.flipV };
}

export function setZoom(state: EditState, zoom: number, dims: Dims): EditState {
    if (!Number.isFinite(zoom)) return state;
    return settle({ ...state, zoom: clamp(zoom, EDITOR_LIMITS.minZoom, EDITOR_LIMITS.maxZoom) }, dims);
}

/** Move the crop by a fraction of the turned picture (positive goes right and down). */
export function pan(state: EditState, dx: number, dy: number, dims: Dims): EditState {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return state;
    return settle({ ...state, centerX: state.centerX + dx, centerY: state.centerY + dy }, dims);
}

/** Turn a quarter turn to the right (1) or the left (-1). The crop goes back to the whole picture. */
export function rotate(state: EditState, direction: 1 | -1): EditState {
    const rotation = ((state.rotation + 90 * direction + 360) % 360) as Rotation;
    return { ...state, rotation, zoom: 1, centerX: 0.5, centerY: 0.5 };
}

/** Mirror the picture; the crop stays over the same part of it. */
export function flip(state: EditState, axis: "H" | "V"): EditState {
    return axis === "H" ? { ...state, flipH: !state.flipH, centerX: 1 - state.centerX } : { ...state, flipV: !state.flipV, centerY: 1 - state.centerY };
}

export function setOutput(state: EditState, output: OutputKind, dims: Dims): EditState {
    return output === state.output ? state : settle({ ...state, output }, dims);
}

export function setAdjustment(state: EditState, key: NumericAdjustment, value: number): EditState {
    if (typeof value !== "number" || !Number.isFinite(value)) return state;
    const [low, high] = ADJUSTMENT_RANGES[key];
    return { ...state, adjustments: { ...state.adjustments, [key]: clamp(Math.round(value), low, high) } };
}

export function setTint(state: EditState, tint: string): EditState {
    return HEX_RE.test(tint) ? { ...state, adjustments: { ...state.adjustments, tint: tint.toLowerCase() } } : state;
}

export function withAdjustments(state: EditState, adjustments: Adjustments): EditState {
    return { ...state, adjustments: sanitizeAdjustments(adjustments) };
}

/** Rebuild adjustments from anything: numbers are clamped and rounded, a bad value becomes the neutral one, a bad colour becomes the default. */
export function sanitizeAdjustments(raw: unknown): Adjustments {
    const source = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const out: Adjustments = { ...NEUTRAL };
    for (const key of Object.keys(ADJUSTMENT_RANGES) as NumericAdjustment[]) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value)) out[key] = clamp(Math.round(value), ADJUSTMENT_RANGES[key][0], ADJUSTMENT_RANGES[key][1]);
    }
    if (typeof source.tint === "string" && HEX_RE.test(source.tint)) out.tint = source.tint.toLowerCase();
    return out;
}

export function sameAdjustments(a: Adjustments, b: Adjustments): boolean {
    return a.tint === b.tint && (Object.keys(ADJUSTMENT_RANGES) as NumericAdjustment[]).every(key => a[key] === b[key]);
}

/** True when the colours do nothing (a tint colour with no amount changes nothing). */
export function isNeutral(adjustments: Adjustments): boolean {
    return (Object.keys(ADJUSTMENT_RANGES) as NumericAdjustment[]).every(key => adjustments[key] === 0);
}

export function isUntouched(state: EditState, output: OutputKind = state.output): boolean {
    const start = initialState(output);
    return state.output === output && state.rotation === 0 && !state.flipH && !state.flipV && state.zoom === 1 && state.centerX === start.centerX && state.centerY === start.centerY && isNeutral(state.adjustments);
}

// --- History ---------------------------------------------------------------------------------------------------------------------------------------------

/** Undo and redo. Changes with the same gesture key follow each other without making new steps (a drag of a slider is one step). */
export class EditHistory {
    private past: EditState[] = [];
    private future: EditState[] = [];
    private lastKey: string | null = null;

    constructor(private current: EditState) { }

    get present(): EditState {
        return this.current;
    }

    get canUndo() {
        return this.past.length > 0;
    }

    get canRedo() {
        return this.future.length > 0;
    }

    /** Make `next` the present. Nothing happens when it is the same as now. */
    push(next: EditState, gesture?: string) {
        if (JSON.stringify(next) === JSON.stringify(this.current)) return;
        if (gesture === undefined || gesture !== this.lastKey) {
            this.past.push(this.current);
            if (this.past.length > EDITOR_LIMITS.history) this.past.shift();
        }
        this.lastKey = gesture ?? null;
        this.future = [];
        this.current = next;
    }

    /** The gesture is over: the next change starts a new step even with the same key. */
    endGesture() {
        this.lastKey = null;
    }

    undo(): boolean {
        const previous = this.past.pop();
        if (!previous) return false;
        this.future.push(this.current);
        this.current = previous;
        this.lastKey = null;
        return true;
    }

    redo(): boolean {
        const next = this.future.pop();
        if (!next) return false;
        this.past.push(this.current);
        this.current = next;
        this.lastKey = null;
        return true;
    }
}

// --- Presets ---------------------------------------------------------------------------------------------------------------------------------------------

export interface Preset { name: string; adjustments: Adjustments; }

const preset = (name: string, changes: Partial<Adjustments>): Preset => ({ name, adjustments: { ...NEUTRAL, ...changes } });

export const BUILT_IN_PRESETS: readonly Preset[] = [
    preset("Original", {}),
    preset("Vivid", { saturation: 30, contrast: 10 }),
    preset("Soft", { contrast: -15, brightness: 5, saturation: -10 }),
    preset("Faded", { contrast: -20, saturation: -25, brightness: 8 }),
    preset("Noir", { grayscale: 100, contrast: 20 }),
    preset("Vintage", { sepia: 60, contrast: -10 }),
    preset("Warm", { tint: "#f59e0b", tintAmount: 20, saturation: 10 }),
    preset("Cool", { tint: "#3b82f6", tintAmount: 20 })
];

export function cleanPresetName(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const name = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, EDITOR_LIMITS.presetNameChars).trim();
    return name === "" ? null : name;
}

export type SavePresetResult = "saved" | "replaced" | "full" | "invalid";

const PRESETS_KEY = "editorPresets";

/** The person's own presets, kept in the plugin's storage. */
export class PresetStore {
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly storage: PluginStorage) { }

    private run<T>(work: () => Promise<T>): Promise<T> {
        const result = this.queue.then(work, work);
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async read(): Promise<Preset[]> {
        const saved = await this.storage.get(PRESETS_KEY);
        if (!Array.isArray(saved)) return [];
        const out: Preset[] = [];
        for (const item of saved) {
            const name = typeof item === "object" && item !== null ? cleanPresetName((item as Record<string, unknown>).name) : null;
            if (!name || out.some(known => known.name.toLowerCase() === name.toLowerCase())) continue;
            out.push({ name, adjustments: sanitizeAdjustments((item as Record<string, unknown>).adjustments) });
            if (out.length >= EDITOR_LIMITS.presets) break;
        }
        return out;
    }

    list(): Promise<Preset[]> {
        return this.run(() => this.read());
    }

    /** Keep the colours under a name. The same name (in any letter case) is replaced. */
    save(rawName: string, adjustments: Adjustments): Promise<SavePresetResult> {
        return this.run(async () => {
            const name = cleanPresetName(rawName);
            if (!name) return "invalid";
            const list = await this.read();
            const at = list.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
            const entry: Preset = { name, adjustments: sanitizeAdjustments(adjustments) };
            if (at >= 0) {
                list[at] = entry;
            } else {
                if (list.length >= EDITOR_LIMITS.presets) return "full";
                list.push(entry);
            }
            await this.storage.set(PRESETS_KEY, JSON.parse(JSON.stringify(list)));
            return at >= 0 ? "replaced" : "saved";
        });
    }

    remove(rawName: string): Promise<boolean> {
        return this.run(async () => {
            const name = cleanPresetName(rawName);
            if (!name) return false;
            const list = await this.read();
            const next = list.filter(item => item.name.toLowerCase() !== name.toLowerCase());
            if (next.length === list.length) return false;
            await this.storage.set(PRESETS_KEY, JSON.parse(JSON.stringify(next)));
            return true;
        });
    }
}
