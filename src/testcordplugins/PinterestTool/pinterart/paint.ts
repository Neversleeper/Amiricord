/*
 * Pinterart — colour brush for the editor.
 * Copyright (c) 2026 szcx404
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Paint is a stack of regions. Each tap (Auto) or stroke (Brush) creates one
// region that keeps its own colour, intensity and lightness, so picking a new
// colour only affects what you paint next.
//
// - Auto: the connected area around the tap whose colour and tint are close to
//   the tapped pixel (it follows shading but stops at outlines and does not
//   jump to other parts of the picture with a similar colour).
// - Animated GIFs: hair moves, so a fixed area would miss it on later frames.
//   An Auto region also remembers the colours it contained and an enlarged
//   "gate" around it; on every frame, pixels inside the gate whose colour was
//   in the region are painted.
// - Brush: a freehand area. Erase removes paint from every region.
//
// Masks are in image coordinates, long side MASK_SIDE px.

const MASK_SIDE = 512;
const UNDO_LIMIT = 20;

export interface PaintStyle {
    color: string;
    /** 0-100 */
    strength: number;
    /** -100..100 */
    lightness: number;
}

interface PaintRegion extends PaintStyle {
    id: number;
    kind: "auto" | "brush";
    mask: HTMLCanvasElement;
    gate: HTMLCanvasElement | null;
    /** 32×32×32 colour bins present in an Auto region (GIF tracking). */
    colors: Uint8Array | null;
    version: number;
    cache?: { key: string; mask: Uint8ClampedArray; gate: Uint8ClampedArray | null; };
}

export interface PaintSelection {
    width: number;
    height: number;
    regions: PaintRegion[];
    undo: PaintRegion[][];
    stroke: PaintRegion | null;
    nextId: number;
}

const newCanvas = (w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
};
const ctx2d = (canvas: HTMLCanvasElement) => canvas.getContext("2d", { willReadFrequently: true })!;

export function createSelection(width: number, height: number): PaintSelection {
    const scale = MASK_SIDE / Math.max(width, height);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        regions: [],
        undo: [],
        stroke: null,
        nextId: 1
    };
}

export function hasSelection(sel: PaintSelection | null) {
    return Boolean(sel?.regions.length);
}

// ---------------------------------------------------------------------------
// Undo (Ctrl+Z): snapshots of the region list, with copies of the masks
// ---------------------------------------------------------------------------

function cloneCanvas(source: HTMLCanvasElement) {
    const copy = newCanvas(source.width, source.height);
    copy.getContext("2d")!.drawImage(source, 0, 0);
    return copy;
}

export function pushUndo(sel: PaintSelection) {
    sel.undo.push(sel.regions.map(region => ({
        ...region,
        mask: cloneCanvas(region.mask),
        gate: region.gate ? cloneCanvas(region.gate) : null,
        cache: undefined
    })));
    if (sel.undo.length > UNDO_LIMIT) sel.undo.shift();
}

export function undo(sel: PaintSelection) {
    const previous = sel.undo.pop();
    if (!previous) return false;
    sel.regions = previous;
    sel.stroke = null;
    return true;
}

export function clearSelection(sel: PaintSelection) {
    if (!sel.regions.length) return;
    pushUndo(sel);
    sel.regions = [];
    sel.stroke = null;
}

// ---------------------------------------------------------------------------
// Auto: connected area around a tap
// ---------------------------------------------------------------------------

function readFrame(sel: PaintSelection, frame: CanvasImageSource) {
    const reader = newCanvas(sel.width, sel.height);
    const ctx = ctx2d(reader);
    ctx.drawImage(frame, 0, 0, sel.width, sel.height);
    return ctx.getImageData(0, 0, sel.width, sel.height).data;
}

// Weighted RGB distance plus a tint term (chroma relative to brightness), so
// dark brown hair and a dark grey background count as different colours.
function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    const l1 = (r1 + g1 + b1) / 3 + 24, l2 = (r2 + g2 + b2) / 3 + 24;
    const tr = ((r1 - g1) / l1 - (r2 - g2) / l2) * 110;
    const tb = ((b1 - g1) / l1 - (b2 - g2) / l2) * 110;
    return (2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9 + tr * tr + tb * tb;
}

const binOf = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * Adds the connected area around (x, y) (0..1 of the image) as a new region
 * painted with `style`. `frame` is the frame currently on screen.
 */
export function addAutoRegion(sel: PaintSelection, frame: CanvasImageSource, x: number, y: number, reach: number, style: PaintStyle) {
    const { width: w, height: h } = sel;
    const data = readFrame(sel, frame);
    const sx = Math.min(w - 1, Math.max(0, Math.floor(x * w)));
    const sy = Math.min(h - 1, Math.max(0, Math.floor(y * h)));

    // Median of a 5×5 patch: a stray outline pixel under the cursor is ignored.
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = (Math.min(h - 1, Math.max(0, sy + dy)) * w + Math.min(w - 1, Math.max(0, sx + dx))) * 4;
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1];
    const r0 = median(rs), g0 = median(gs), b0 = median(bs);

    // A pixel joins when it is close to the tapped colour, or close to the
    // neighbour it was reached from (smooth shading), but never further from
    // the tapped colour than the hard cap (anti-aliased outlines form a ramp
    // into other colours; the cap stops the fill from walking across it).
    const limit = 12 + reach * 0.9;
    const near = limit * limit;
    const step = (limit * 0.35) ** 2;
    const cap = (limit * 1.3) ** 2;

    const region = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    let size = 1;
    region[sy * w + sx] = 1;
    stack[top++] = sy * w + sx;
    while (top > 0) {
        const p = stack[--top];
        const px = p % w;
        const pi = p * 4;
        const neighbours = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1];
        for (const q of neighbours) {
            if (q < 0 || region[q]) continue;
            const qi = q * 4;
            if (data[qi + 3] < 16) continue;
            const fromSeed = colorDistance(data[qi], data[qi + 1], data[qi + 2], r0, g0, b0);
            if (fromSeed > cap) continue;
            if (fromSeed <= near || colorDistance(data[qi], data[qi + 1], data[qi + 2], data[pi], data[pi + 1], data[pi + 2]) <= step) {
                region[q] = 1;
                stack[top++] = q;
                size++;
            }
        }
    }

    // Colours found in the area, widened by one bin so GIF dithering and
    // slightly different shading on later frames still match.
    const counts = new Uint32Array(32768);
    for (let p = 0; p < region.length; p++) {
        if (!region[p]) continue;
        const i = p * 4;
        counts[binOf(data[i], data[i + 1], data[i + 2])]++;
    }
    const minCount = Math.max(1, Math.floor(size * 0.0015));
    const colors = new Uint8Array(32768);
    for (let bin = 0; bin < 32768; bin++) {
        if (counts[bin] < minCount) continue;
        const r = bin >> 10, g = (bin >> 5) & 31, b = bin & 31;
        for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
            const nr = r + dr, ng = g + dg, nb = b + db;
            if (nr >= 0 && nr < 32 && ng >= 0 && ng < 32 && nb >= 0 && nb < 32) colors[(nr << 10) | (ng << 5) | nb] = 1;
        }
    }

    const hard = newCanvas(w, h);
    const hctx = ctx2d(hard);
    const image = hctx.createImageData(w, h);
    for (let p = 0; p < region.length; p++) if (region[p]) image.data[p * 4 + 3] = 255;
    hctx.putImageData(image, 0, 0);

    // Exact area with softened edges, and a wider gate for moving GIF frames.
    const mask = newCanvas(w, h);
    const mctx = ctx2d(mask);
    mctx.filter = "blur(0.8px)";
    mctx.drawImage(hard, 0, 0);
    const gate = newCanvas(w, h);
    const gctx = ctx2d(gate);
    gctx.filter = `blur(${Math.round(Math.max(w, h) * 0.05)}px)`;
    for (let i = 0; i < 3; i++) gctx.drawImage(hard, 0, 0);

    pushUndo(sel);
    sel.regions.push({ ...style, id: sel.nextId++, kind: "auto", mask, gate, colors, version: 0 });
}

// ---------------------------------------------------------------------------
// Brush / Erase
// ---------------------------------------------------------------------------

/** Starts a stroke; painting creates a region with `style`, erasing affects all regions. */
export function beginStroke(sel: PaintSelection, erase: boolean, style: PaintStyle) {
    pushUndo(sel);
    if (erase) {
        sel.stroke = null;
        return;
    }
    const region: PaintRegion = { ...style, id: sel.nextId++, kind: "brush", mask: newCanvas(sel.width, sel.height), gate: null, colors: null, version: 0 };
    sel.regions.push(region);
    sel.stroke = region;
}

/** A soft round stroke between two points (0..1 coordinates). */
export function strokeTo(sel: PaintSelection, from: { x: number; y: number; }, to: { x: number; y: number; }, size: number, erase: boolean) {
    const { width: w, height: h } = sel;
    const radius = Math.max(1, (size / 100) * Math.max(w, h) * 0.12);
    const ax = from.x * w, ay = from.y * h, bx = to.x * w, by = to.y * h;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (radius * 0.3)));
    const stamp = (canvas: HTMLCanvasElement, mode: GlobalCompositeOperation) => {
        const ctx = ctx2d(canvas);
        ctx.save();
        ctx.globalCompositeOperation = mode;
        for (let i = 0; i <= steps; i++) {
            const cx = ax + (bx - ax) * (i / steps), cy = ay + (by - ay) * (i / steps);
            const gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
            gradient.addColorStop(0, "rgba(0,0,0,1)");
            gradient.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    };

    if (erase) {
        for (const region of sel.regions) {
            stamp(region.mask, "destination-out");
            if (region.gate) stamp(region.gate, "destination-out");
            region.version++;
        }
    } else if (sel.stroke) {
        stamp(sel.stroke.mask, "source-over");
        sel.stroke.version++;
    }
}

export function endStroke(sel: PaintSelection) {
    sel.stroke = null;
    // An erase that removed everything leaves empty regions; drop them.
    sel.regions = sel.regions.filter(region => {
        const data = ctx2d(region.mask).getImageData(0, 0, sel.width, sel.height).data;
        for (let i = 3; i < data.length; i += 32) if (data[i] > 8) return true;
        return false;
    });
}

// ---------------------------------------------------------------------------
// Rendering (preview, export and every GIF frame)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const n = parseInt(m ? m[1] : "ff4fa3", 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function alphaAt(canvas: HTMLCanvasElement, W: number, H: number) {
    const reader = newCanvas(W, H);
    const ctx = ctx2d(reader);
    ctx.drawImage(canvas, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const alpha = new Uint8ClampedArray(W * H);
    for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3];
    return alpha;
}

// Masks scaled to the frame size are cached: a GIF draws many frames at one size.
function regionAlpha(region: PaintRegion, W: number, H: number) {
    const key = `${W}x${H}:${region.version}`;
    if (region.cache?.key !== key) {
        region.cache = {
            key,
            mask: alphaAt(region.mask, W, H),
            gate: region.gate ? alphaAt(region.gate, W, H) : null
        };
    }
    return region.cache;
}

/**
 * Finds the region on another frame of a GIF: starting from pixels that still
 * overlap where it was tapped, grow through connected pixels whose colour was
 * in the region. It follows hair that moved, but does not jump to separate
 * parts of the picture that happen to share the colour.
 */
function followRegion(data: Uint8ClampedArray, W: number, H: number, colors: Uint8Array, mask: Uint8ClampedArray, gate: Uint8ClampedArray) {
    const total = W * H;
    const matched = new Uint8Array(total);
    for (let p = 0, i = 0; p < total; p++, i += 4) {
        if (data[i + 3] >= 16 && colors[binOf(data[i], data[i + 1], data[i + 2])]) matched[p] = 1;
    }
    const out = new Uint8Array(total);
    const stack = new Int32Array(total);
    let top = 0;
    for (let p = 0; p < total; p++) {
        if (matched[p] && (mask[p] > 100 || gate[p] > 200)) {
            out[p] = 1;
            stack[top++] = p;
        }
    }
    while (top > 0) {
        const p = stack[--top];
        const x = p % W;
        if (x > 0 && matched[p - 1] && !out[p - 1]) { out[p - 1] = 1; stack[top++] = p - 1; }
        if (x < W - 1 && matched[p + 1] && !out[p + 1]) { out[p + 1] = 1; stack[top++] = p + 1; }
        if (p >= W && matched[p - W] && !out[p - W]) { out[p - W] = 1; stack[top++] = p - W; }
        if (p < total - W && matched[p + W] && !out[p + W]) { out[p + W] = 1; stack[top++] = p + W; }
    }
    return out;
}

/**
 * Recolours `pixels` (the unfiltered frame) in place. `animated` uses colour
 * tracking for Auto regions so the paint follows movement between frames.
 * `highlight` tints painted pixels (preview only).
 */
export function paintPixels(pixels: ImageData, sel: PaintSelection, animated: boolean, highlight = false) {
    const { width: W, height: H, data } = pixels;
    for (const region of sel.regions) {
        const { mask, gate } = regionAlpha(region, W, H);
        const track = animated && region.kind === "auto" && gate && region.colors;
        const colors = region.colors!;
        const [tr, tg, tb] = hexToRgb(region.color);
        const [th, ts, tl] = rgbToHsl(tr, tg, tb);
        const strength = Math.max(0, Math.min(1, region.strength / 100));
        const lightShift = region.lightness / 100 * 0.3;

        const follow = track ? followRegion(data, W, H, colors, mask, gate!) : null;

        for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
            let weight: number;
            if (follow) {
                if (!follow[p]) continue;
                weight = 1;
            } else {
                if (mask[p] < 2) continue;
                weight = mask[p] / 255;
            }
            if (data[i + 3] < 8) continue;

            const r = data[i], g = data[i + 1], b = data[i + 2];
            const l = rgbToHsl(r, g, b)[2];
            const nl = Math.max(0, Math.min(1, l + (tl - l) * 0.45 + lightShift));
            const q = nl < 0.5 ? nl * (1 + ts) : nl + ts - nl * ts;
            const pp = 2 * nl - q;
            let nr = hue2rgb(pp, q, th + 1 / 3) * 255;
            let ng = hue2rgb(pp, q, th) * 255;
            let nb = hue2rgb(pp, q, th - 1 / 3) * 255;
            if (highlight) { nr = nr * 0.75 + 30; ng = ng * 0.75 + 22; nb = nb * 0.75 + 64; }
            const amount = weight * strength;
            data[i] = r + (nr - r) * amount;
            data[i + 1] = g + (ng - g) * amount;
            data[i + 2] = b + (nb - b) * amount;
        }
    }
}
