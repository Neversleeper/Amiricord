/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseGIF } from "gifuct-js";

import { GIFEncoder, quantize } from "../src/testcordplugins/GifCaptioner/codec";
import {
    applyPaletteTransparent, type CanvasLike, type Context2D, type EncodeDeps, type FrameSource, GifRenderer, scaleFactorFor
} from "../src/testcordplugins/GifCaptioner/encode";
import { captionGif, captionMedia, captionVideo, type FrameDeps, seekTo, type VideoLike, waitForLoadedData } from "../src/testcordplugins/GifCaptioner/frames";
import type { CaptionMedia, CaptionTransform } from "../src/testcordplugins/GifCaptioner/media";

interface Recorder { calls: string[]; canvas: CanvasLike; ctx: Context2D; }

function fakeCanvas(width: number, height: number): Recorder {
    const calls: string[] = [];
    const ctx: Context2D = {
        font: "", fillStyle: "", textAlign: "", textBaseline: "",
        // Each character is half the font size wide.
        measureText: text => ({ width: text.length * (Number.parseFloat(ctx.font) || 10) / 2 }),
        fillRect: (x, y, w, h) => { calls.push(`fillRect ${x} ${y} ${w} ${h} ${ctx.fillStyle}`); },
        fillText: (text, x, y) => { calls.push(`fillText ${text} ${x} ${y}`); },
        clearRect: (x, y, w, h) => { calls.push(`clearRect ${x} ${y} ${w} ${h}`); },
        drawImage: (_source, x, y, w, h) => { calls.push(`drawImage ${x} ${y} ${w ?? ""} ${h ?? ""}`); },
        getImageData: (_x, _y, w, h) => {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < w * h; i++) { data[4 * i] = (i * 40) % 256; data[4 * i + 1] = 80; data[4 * i + 2] = 200; data[4 * i + 3] = 255; }
            return { data };
        },
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: (_data, x, y) => { calls.push(`putImageData ${x} ${y}`); }
    };
    const canvas: CanvasLike = { width, height, getContext: () => ctx };
    return { calls, canvas, ctx };
}

function setup(overrides: Partial<EncodeDeps> = {}, maxFileSize = 25 * 1024 * 1024) {
    const canvases: Recorder[] = [];
    const failures: string[] = [];
    const delivered: File[] = [];
    const deps: EncodeDeps = {
        makeCanvas: (w, h) => { const made = fakeCanvas(w, h); canvases.push(made); return made.canvas; },
        font: () => "Roboto",
        maxFileSize: () => maxFileSize,
        fail: message => { failures.push(message); },
        deliver: file => { delivered.push(file); },
        ...overrides
    };
    return { deps, canvases, failures, delivered };
}

const transform = (extra: Partial<CaptionTransform> = {}): CaptionTransform => ({ height: 50, text: "hello", size: 20, type: "caption", width: 100, ...extra });

describe("GifCaptioner: the numbers", () => {
    it("works out how much smaller the result must be for the file limit and for the canvas limit", () => {
        assert.equal(scaleFactorFor(100, 100, 1, 1_000_000), 1);
        assert.equal(scaleFactorFor(100, 100, 10, 10_000), Math.sqrt(10));
        assert.equal(scaleFactorFor(4000, 4000, 1, Number.MAX_SAFE_INTEGER), 2, "16 million pixels against four million");
        assert.equal(scaleFactorFor(2000, 2000, 1, Number.MAX_SAFE_INTEGER), 1, "exactly four million is fine");
        assert.equal(scaleFactorFor(10, 10, 1000, 100), Math.sqrt(1000), "frames count");
    });

    it("gives each pixel the number of its colour, and 255 to a see-through one", () => {
        const data = new Uint8ClampedArray([10, 10, 10, 255, 250, 250, 250, 255, 0, 0, 0, 0, 12, 12, 12, 255]);
        const palette = [[0, 0, 0], [255, 255, 255]];
        assert.deepEqual([...applyPaletteTransparent(data, palette, 1)], [0, 1, 255, 0]);
        assert.deepEqual([...applyPaletteTransparent(new Uint8ClampedArray([5, 5, 5, 1]), palette, 1)], [0], "a pixel as transparent as the threshold counts as solid");
        assert.deepEqual([...applyPaletteTransparent(new Uint8ClampedArray([5, 5, 5, 0]), palette, 1)], [255]);
        assert.equal(applyPaletteTransparent(new Uint8ClampedArray(7), palette, 1).length, 1, "a part of a pixel is not a pixel");
    });
});

describe("GifCaptioner: the caption and the frames", () => {
    it("draws the caption on a white band at the top and makes the canvas tall enough for both", () => {
        const world = setup();
        new GifRenderer(world.deps, { frames: 1, width: 100, height: 50, transform: transform({ text: "hello world", size: 20 }) });
        const main = world.canvases[0];
        // "hello world" is 11 characters of 10 pixels: 110, wider than 100, so two lines of 20 plus 10 above the 50 of the media.
        assert.deepEqual([main.canvas.width, main.canvas.height], [100, 2 * 20 + 10 + 50]);
        assert.deepEqual(main.calls.filter(call => call.startsWith("fill")), [
            "fillRect 0 0 100 50 white", "fillText hello 50 5", "fillText world 50 25"
        ]);
        assert.equal(main.ctx.font, "20px Roboto");
        assert.deepEqual([main.ctx.fillStyle, main.ctx.textAlign, main.ctx.textBaseline], ["black", "center", "top"]);
    });

    it("makes everything smaller when the file would be too big, the caption too", () => {
        const world = setup({}, 10_000);
        new GifRenderer(world.deps, { frames: 10, width: 100, height: 50, transform: transform({ text: "hi", size: 20 }) });
        // 100 by 80 pixels for 10 frames against 10 000 bytes: scale sqrt(8).
        const scale = Math.sqrt(8);
        const main = world.canvases[0];
        assert.equal(main.canvas.width, Math.floor(100 / scale));
        assert.equal(main.canvas.height, Math.floor(80 / scale));
        assert.equal(main.ctx.font, `${Math.floor(20 / scale)}px Roboto`);
    });

    it("never makes a canvas smaller than one pixel", () => {
        const world = setup({}, 1);
        new GifRenderer(world.deps, { frames: 1000, width: 3, height: 3, transform: transform({ size: 1, text: "x" }) });
        assert.deepEqual([world.canvases[0].canvas.width, world.canvases[0].canvas.height > 0], [1, true]);
        assert.match(world.canvases[0].ctx.font, /^1px /);
    });

    it("draws a video frame under the caption and writes it with its delay", () => {
        const written: Array<{ delay: number | undefined; transparent: boolean | undefined; transparentIndex: number | undefined; width: number; height: number; }> = [];
        const world = setup({ encoder: () => ({ writeFrame: (_i, w, h, o) => { written.push({ delay: o?.delay, transparent: o?.transparent, transparentIndex: o?.transparentIndex, width: w, height: h }); }, finish: () => undefined, bytesView: () => new Uint8Array(1) }) });
        const renderer = new GifRenderer(world.deps, { frames: 2, width: 100, height: 50, transform: transform({ text: "a" }) });
        const main = world.canvases[0];
        main.calls.length = 0;
        renderer.addVideoFrame("video", 40);
        renderer.addVideoFrame("video", 60);
        // The band for one line of 20 pixels is 30 tall, so the frame goes at y = 30.
        assert.deepEqual(main.calls, ["clearRect 0 30 100 50", "drawImage 0 30 100 50", "clearRect 0 30 100 50", "drawImage 0 30 100 50"]);
        assert.deepEqual(written, [
            { delay: 40, transparent: true, transparentIndex: 255, width: 100, height: 80 },
            { delay: 60, transparent: true, transparentIndex: 255, width: 100, height: 80 }
        ]);
    });

    it("draws the pieces of a GIF over each other, and clears the picture after a frame that asked for it", () => {
        const world = setup();
        const renderer = new GifRenderer(world.deps, { frames: 3, width: 10, height: 10, transform: transform({ width: 10, height: 10, text: "a", size: 10 }) });
        const screen = { lsd: { width: 12, height: 8 } };
        const frame = (extra: Partial<FrameSource> = {}): FrameSource => ({ patch: new Uint8ClampedArray(2 * 2 * 4), delay: 30, dims: { width: 2, height: 2, left: 3, top: 1 }, ...extra });
        renderer.addGifFrame(frame({ disposalType: 2 }), screen);
        renderer.addGifFrame(frame(), screen);
        renderer.addGifFrame(frame({ dims: { width: 4, height: 3, left: 0, top: 0 }, patch: new Uint8ClampedArray(4 * 3 * 4) }), screen);
        const [, temp, picture] = world.canvases;
        assert.deepEqual([picture.canvas.width, picture.canvas.height], [12, 8], "the whole screen of the GIF");
        assert.deepEqual([temp.canvas.width, temp.canvas.height], [4, 3], "the size of the last piece");
        assert.deepEqual(picture.calls, ["drawImage 3 1  ", "clearRect 0 0 12 8", "drawImage 3 1  ", "drawImage 0 0  "]);
        assert.deepEqual(temp.calls, ["putImageData 0 0", "putImageData 0 0", "putImageData 0 0"]);
        assert.deepEqual(world.canvases.length, 3, "the helper canvases are made once");
        // On the main canvas each GIF frame is drawn under the caption band (10 pixels of text plus the padding), after clearing the same place.
        assert.deepEqual(world.canvases[0].calls.filter(call => call.startsWith("clearRect") || call.startsWith("drawImage")), Array(3).fill(["clearRect 0 20 10 10", "drawImage 0 20 10 10"]).flat());
    });

    it("makes a new picture buffer when only the width or only the height of a piece changes", () => {
        const world = setup();
        const renderer = new GifRenderer(world.deps, { frames: 3, width: 10, height: 10, transform: transform({ width: 10, height: 10, text: "a", size: 10 }) });
        const screen = { lsd: { width: 12, height: 8 } };
        const sizes: Array<[number, number]> = [];
        const piece = (width: number, height: number): FrameSource => ({ patch: new Uint8ClampedArray(width * height * 4), delay: 1, dims: { width, height, left: 0, top: 0 } });
        const temp = () => world.canvases[1];
        renderer.addGifFrame(piece(2, 2), screen);
        sizes.push([temp().canvas.width, temp().canvas.height]);
        renderer.addGifFrame(piece(3, 2), screen);
        sizes.push([temp().canvas.width, temp().canvas.height]);
        renderer.addGifFrame(piece(3, 4), screen);
        sizes.push([temp().canvas.width, temp().canvas.height]);
        renderer.addGifFrame(piece(3, 4), screen);
        assert.deepEqual(sizes, [[2, 2], [3, 2], [3, 4]]);
        assert.equal(temp().calls.filter(call => call.startsWith("putImageData")).length, 4);
    });

    it("keeps the media at least one pixel tall, and tells each colour channel apart", () => {
        const world = setup({}, 1);
        const renderer = new GifRenderer(world.deps, { frames: 1000, width: 3, height: 3, transform: transform({ size: 1, text: "x", width: 3, height: 3 }) });
        renderer.addVideoFrame("v", 1);
        assert.match(world.canvases[0].calls.at(-1)!, /^drawImage 0 \d+ 1 1$/);
        const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
        const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
        assert.deepEqual([...applyPaletteTransparent(data, palette, 1)], [0, 1, 2, 1]);
        const blues = [[0, 0, 100], [0, 0, 255]];
        assert.deepEqual([...applyPaletteTransparent(new Uint8ClampedArray([0, 0, 100, 255]), blues, 1)], [0], "the blue channel is the third number, not the alpha");
    });

    it("writes a real GIF with the size of the canvas and the frames it was given", () => {
        const world = setup();
        const renderer = new GifRenderer(world.deps, { frames: 2, width: 16, height: 8, transform: transform({ width: 16, height: 8, text: "a", size: 10 }) });
        renderer.addVideoFrame("v", 100);
        renderer.addVideoFrame("v", 100);
        renderer.render();
        assert.equal(world.failures.length, 0);
        assert.equal(world.delivered.length, 1);
        assert.equal(world.delivered[0].name, "rendered.gif");
        assert.equal(world.delivered[0].type, "image/gif");
    });

    it("says it failed to encode when no frame was written, and delivers nothing", () => {
        const world = setup();
        new GifRenderer(world.deps, { frames: 1, width: 10, height: 10, transform: transform() }).render();
        assert.deepEqual(world.failures, ["Failed to encode GIF."]);
        assert.equal(world.delivered.length, 0);
    });

    it("says the GIF is too large when it is more than the limit, and delivers nothing", () => {
        const world = setup({}, 1);
        const renderer = new GifRenderer(world.deps, { frames: 1, width: 10, height: 10, transform: transform({ width: 10, height: 10, text: "a", size: 10 }) });
        renderer.addVideoFrame("v", 10);
        renderer.render();
        assert.deepEqual(world.failures, ["Rendered GIF is too large to upload."]);
        assert.equal(world.delivered.length, 0);
    });

    it("fails clearly when the page gives no drawing context", () => {
        const deps = setup({ makeCanvas: () => ({ width: 1, height: 1, getContext: () => null }) }).deps;
        assert.throws(() => new GifRenderer(deps, { frames: 1, width: 1, height: 1, transform: transform() }), /Failed to create canvas context/);
    });
});

/** A small GIF made with the same writer: `count` frames of 4 by 4 pixels. */
function makeGif(count: number, delay = 100, width = 4, height = 4) {
    const encoder = GIFEncoder();
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const palette = quantize(data, 4);
    for (let i = 0; i < count; i++) encoder.writeFrame(new Uint8Array(width * height), width, height, { palette, delay });
    encoder.finish();
    const view = encoder.bytesView();
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function frameWorld() {
    const failures: string[] = [];
    const frames: Array<{ kind: string; delay?: number; }> = [];
    const renders: string[] = [];
    const made: Array<{ frames: number; width: number; height: number; }> = [];
    const timers = new Map<number, () => void>();
    const delays: number[] = [];
    let next = 1;
    let pictureOpened = 0;
    let pictureClosed = 0;
    const deps: FrameDeps = {
        deps: { fail: message => { failures.push(message); } },
        sleep: async () => undefined,
        renderer: (count, width, height) => {
            made.push({ frames: count, width, height });
            return {
                addGifFrame: (source: FrameSource) => { frames.push({ kind: "gif", delay: source.delay }); },
                addVideoFrame: (_source: unknown, delay: number) => { frames.push({ kind: "video", delay }); },
                render: () => { renders.push("render"); }
            };
        },
        setTimer: (run, ms) => { const id = next++; timers.set(id, run); delays.push(ms); return id; },
        clearTimer: id => { timers.delete(id as number); },
        decodePicture: async () => { pictureOpened++; return { width: 4, height: 4, close: () => { pictureClosed++; } }; }
    };
    return { deps, failures, pictures: () => [pictureOpened, pictureClosed], frames, renders, made, timers, delays };
}

const media = (buffer: ArrayBuffer, contentType = "image/gif", isVideo = false): CaptionMedia => ({ buffer, contentType, height: 4, width: 4, isVideo, release: () => undefined, url: "blob:x" });

describe("GifCaptioner: reading a GIF", () => {
    it("gives every frame to the renderer, then finishes", async () => {
        const world = frameWorld();
        await captionGif(world.deps, media(makeGif(3, 100)), transform({ width: 4, height: 4 }));
        assert.deepEqual(world.frames.map(frame => frame.kind), ["gif", "gif", "gif"]);
        assert.deepEqual(world.made, [{ frames: 3, width: 4, height: 4 }]);
        assert.deepEqual(world.renders, ["render"]);
        assert.deepEqual(world.failures, []);
    });

    it("says the GIF is too large when its screen or the size asked for is more than four million pixels", async () => {
        const huge = frameWorld();
        await captionGif(huge.deps, media(makeGif(1, 100, 4001, 1000)), transform({ width: 4, height: 4 }));
        assert.deepEqual(huge.failures, ["GIF is too large to caption safely."]);
        const asked = frameWorld();
        await captionGif(asked.deps, media(makeGif(1)), transform({ width: 4001, height: 1000 }));
        assert.deepEqual(asked.failures, ["GIF is too large to caption safely."]);
        const exact = frameWorld();
        await captionGif(exact.deps, media(makeGif(1)), transform({ width: 2000, height: 2000 }));
        assert.deepEqual(exact.failures, [], "exactly four million is fine");
        assert.equal(huge.renders.length + asked.renders.length, 0);
    });

    it("accepts a GIF whose screen has exactly four million pixels, and refuses one pixel more", async () => {
        const exact = frameWorld();
        await captionGif(exact.deps, media(makeGif(1, 100, 2000, 2000)), transform({ width: 4, height: 4 }));
        assert.deepEqual(exact.failures, []);
        const more = frameWorld();
        await captionGif(more.deps, media(makeGif(1, 100, 2001, 2000)), transform({ width: 4, height: 4 }));
        assert.deepEqual(more.failures, ["GIF is too large to caption safely."]);
    });

    it("says the GIF is too long when it has more than 600 frames or lasts more than 30 seconds", async () => {
        const many = frameWorld();
        await captionGif(many.deps, media(makeGif(601, 10, 1, 1)), transform({ width: 1, height: 1 }));
        assert.deepEqual(many.failures, ["GIF is too long to caption safely."]);
        const edge = frameWorld();
        await captionGif(edge.deps, media(makeGif(600, 10, 1, 1)), transform({ width: 1, height: 1 }));
        assert.deepEqual(edge.failures, [], "exactly 600 frames is fine");
        const slow = frameWorld();
        await captionGif(slow.deps, media(makeGif(3, 15_000, 1, 1)), transform({ width: 1, height: 1 }));
        assert.deepEqual(slow.failures, ["GIF is too long to caption safely."]);
        const thirty = frameWorld();
        await captionGif(thirty.deps, media(makeGif(3, 10_000, 1, 1)), transform({ width: 1, height: 1 }));
        assert.deepEqual(thirty.failures, [], "exactly 30 seconds is fine");
    });

    it("yields to the page between frames", async () => {
        const world = frameWorld();
        const slept: number[] = [];
        world.deps.sleep = async ms => { slept.push(ms); };
        await captionGif(world.deps, media(makeGif(3)), transform({ width: 4, height: 4 }));
        assert.deepEqual(slept, [0, 0, 0]);
    });

    it("chooses by what the file is: a GIF frame by frame, anything else as a video", async () => {
        const gif = frameWorld();
        await captionMedia(gif.deps, media(makeGif(2)), transform({ width: 4, height: 4 }));
        assert.equal(gif.frames[0].kind, "gif");
        const video = frameWorld();
        await captionMedia(video.deps, media(new ArrayBuffer(4), "video/mp4", true), transform({ sourceVideo: null }));
        assert.deepEqual(video.failures, ["Failed to load video."], "no video element to play");
        const still = frameWorld();
        await captionMedia(still.deps, media(new ArrayBuffer(4), "image/png"), transform({ width: 4, height: 4 }));
        assert.deepEqual(still.failures, [], "a PNG is not a video");
        assert.deepEqual(still.frames, [{ kind: "video", delay: 100 }]);
        assert.deepEqual(still.renders, ["render"]);
        assert.deepEqual(still.pictures(), [1, 1], "the picture is opened and closed");
    });
});

function fakeVideo(options: { duration?: number; width?: number; height?: number; ready?: number; seekWorks?: boolean; loads?: boolean; } = {}) {
    const listeners = new Map<string, () => void>();
    const log: string[] = [];
    const listenerOptions: unknown[] = [];
    let time = 0;
    const video: VideoLike = {
        readyState: options.ready ?? 4,
        get currentTime() { return time; },
        set currentTime(value: number) {
            time = value;
            log.push(`seek ${value}`);
            if (options.seekWorks !== false) queueMicrotask(() => { listeners.get("seeked")?.(); });
        },
        duration: options.duration ?? 1,
        videoWidth: options.width ?? 8,
        videoHeight: options.height ?? 6,
        addEventListener: (type, listener, option) => { listeners.set(type, listener); listenerOptions.push(option); },
        removeEventListener: type => { listeners.delete(type); },
        pause: () => { log.push("pause"); }
    };
    return { video, listeners, log, options: listenerOptions };
}

describe("GifCaptioner: playing a video", () => {
    it("takes a frame at the start and then one at each step through the video, and pauses it", async () => {
        const world = frameWorld();
        const { video, log } = fakeVideo({ duration: 0.1 });
        await captionVideo(world.deps, transform({ sourceVideo: video as unknown as HTMLVideoElement, width: 8, height: 6 }));
        // 0.1 s at 50 frames a second: 5 frames, 20 ms apart.
        assert.deepEqual(world.made, [{ frames: 5, width: 8, height: 6 }]);
        assert.deepEqual(world.frames.map(frame => frame.delay), [100 / 5, 100 / 5, 100 / 5, 100 / 5, 100 / 5].map(value => Math.max(20, value)));
        assert.deepEqual(log.filter(entry => entry.startsWith("seek")), ["seek 0.02", "seek 0.04", "seek 0.06", "seek 0.08"].map(entry => entry), "the start needs no seek: it is already there");
        assert.equal(log.at(-1), "pause");
        assert.deepEqual(world.renders, ["render"]);
    });

    it("uses the size of the video when the window has none, and the window's when it has", async () => {
        const none = frameWorld();
        await captionVideo(none.deps, transform({ sourceVideo: fakeVideo({ duration: 0.02, width: 8, height: 6 }).video as unknown as HTMLVideoElement, width: 0, height: 0 }));
        assert.deepEqual([none.made[0].width, none.made[0].height], [8, 6]);
        const given = frameWorld();
        await captionVideo(given.deps, transform({ sourceVideo: fakeVideo({ duration: 0.02, width: 8, height: 6 }).video as unknown as HTMLVideoElement, width: 30, height: 20 }));
        assert.deepEqual([given.made[0].width, given.made[0].height], [30, 20]);
    });

    it("stops with a clear message when there is no video, it does not load, it has no size, or it is too big or too long", async () => {
        const cases: Array<[string, Parameters<typeof fakeVideo>[0], Partial<CaptionTransform>]> = [
            ["Failed to read video metadata.", { width: 0, height: 0 }, { width: 0, height: 0 }],
            ["Video is too large to caption safely.", {}, { width: 4001, height: 1000 }],
            ["Failed to read video metadata.", { duration: 0 }, {}],
            ["Failed to read video metadata.", { duration: Number.NaN }, {}],
            ["Failed to read video metadata.", { duration: Number.POSITIVE_INFINITY }, {}],
            ["Video is too long to caption safely.", { duration: 31 }, {}]
        ];
        for (const [message, video, extra] of cases) {
            const world = frameWorld();
            const fake = fakeVideo(video);
            await captionVideo(world.deps, transform({ sourceVideo: fake.video as unknown as HTMLVideoElement, ...extra }));
            assert.deepEqual(world.failures, [message], message);
            assert.equal(world.renders.length, 0);
            assert.equal(fake.log.at(-1), "pause", "the video is paused even when it stops");
        }
        const none = frameWorld();
        await captionVideo(none.deps, transform({ sourceVideo: null }));
        assert.deepEqual(none.failures, ["Failed to load video."]);
        const edge = frameWorld();
        await captionVideo(edge.deps, transform({ sourceVideo: fakeVideo({ duration: 30 }).video as unknown as HTMLVideoElement, width: 2000, height: 2000 }));
        assert.deepEqual(edge.failures, [], "30 seconds and four million pixels are fine");
        assert.equal(edge.made[0].frames, 600, "never more than 600 frames");
    });

    it("stops taking frames, but still finishes the GIF, when a seek fails", async () => {
        const world = frameWorld();
        const fake = fakeVideo({ duration: 0.1, seekWorks: false });
        const running = captionVideo(world.deps, transform({ sourceVideo: fake.video as unknown as HTMLVideoElement, width: 8, height: 6 }));
        for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
        for (const run of [...world.timers.values()]) run();
        await running;
        assert.equal(world.frames.length, 1, "only the first frame");
        assert.deepEqual(world.renders, ["render"]);
    });

    it("waits for the data of a video to load, fails on an error and on the time limit, and does not wait when it is there", async () => {
        const world = frameWorld();
        assert.equal(await waitForLoadedData(fakeVideo({ ready: 2 }).video, world.deps), true);
        const loading = fakeVideo({ ready: 0 });
        const ok = waitForLoadedData(loading.video, world.deps);
        assert.deepEqual(world.delays, [5000], "five seconds to load");
        assert.deepEqual(loading.options, [{ once: true }, { once: true }]);
        loading.listeners.get("loadeddata")!();
        assert.equal(await ok, true);
        assert.equal(loading.listeners.size, 0, "the listeners are taken away");
        assert.equal(world.timers.size, 0, "and the timer");
        const failing = fakeVideo({ ready: 0 });
        const bad = waitForLoadedData(failing.video, world.deps);
        failing.listeners.get("error")!();
        assert.equal(await bad, false);
        const slow = fakeVideo({ ready: 1 });
        const late = waitForLoadedData(slow.video, world.deps);
        [...world.timers.values()][0]();
        assert.equal(await late, false);
        assert.equal(slow.listeners.size, 0);
    });

    it("seeks only when the video is not already there", async () => {
        const world = frameWorld();
        const fake = fakeVideo();
        assert.equal(await seekTo(fake.video, 0, world.deps), true);
        assert.deepEqual(fake.log, []);
        assert.equal(await seekTo(fake.video, 0.0005, world.deps), true, "closer than a millisecond is there");
        assert.deepEqual(fake.log, []);
        const second = fakeVideo();
        second.video.currentTime = 2;
        second.log.length = 0;
        assert.equal(await seekTo(second.video, 2, world.deps), true);
        assert.deepEqual(second.log, [], "already at 2 seconds: no seek");
        const edge = fakeVideo();
        edge.video.currentTime = 0.001;
        edge.log.length = 0;
        assert.equal(await seekTo(edge.video, 0, world.deps), true);
        assert.deepEqual(edge.log, ["seek 0"], "a millisecond away is not there yet");
        assert.equal(await seekTo(fake.video, 2, world.deps), true);
        assert.deepEqual(fake.log, ["seek 2"]);
        assert.equal(await seekTo(fake.video, -5, world.deps), true);
        assert.deepEqual(fake.log, ["seek 2", "seek 0"], "never before the start");
        assert.equal(fake.listeners.size, 0);
    });

    it("gives up on a seek that never ends, and on one that errors", async () => {
        const world = frameWorld();
        const stuck = fakeVideo({ seekWorks: false });
        const waiting = seekTo(stuck.video, 1, world.deps);
        assert.deepEqual(world.delays, [4000], "four seconds to seek");
        [...world.timers.values()][0]();
        assert.equal(await waiting, false);
        const broken = fakeVideo({ seekWorks: false });
        const failing = seekTo(broken.video, 1, world.deps);
        broken.listeners.get("error")!();
        assert.equal(await failing, false);
    });
});

describe("GifCaptioner: a whole GIF through the real writer and reader", () => {
    it("reads a GIF, captions it and writes a GIF that has the same number of frames and room for the caption", async () => {
        const world = setup();
        const sizes: number[] = [];
        const frameWorld2: FrameDeps = {
            deps: { fail: world.deps.fail },
            sleep: async () => undefined,
            renderer: (frames, width, height, transformed) => {
                sizes.push(frames);
                return new GifRenderer(world.deps, { frames, width, height, transform: transformed });
            },
            setTimer: () => 0,
            clearTimer: () => undefined
        };
        await captionGif(frameWorld2, media(makeGif(3, 100)), transform({ width: 4, height: 4, text: "a", size: 4 }));
        assert.deepEqual(world.failures, []);
        assert.equal(world.delivered.length, 1);
        const written = parseGIF(await world.delivered[0].arrayBuffer());
        assert.equal(written.frames.filter(frame => "image" in frame).length, 3);
        assert.deepEqual([written.lsd.width, written.lsd.height], [4, 4 + 4 + 10], "the width of the GIF and the caption band above it");
    });
});
