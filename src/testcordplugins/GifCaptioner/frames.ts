/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// Reads the frames of a GIF or of a playing video and gives them, one by one, to the renderer. It stops with a clear message when the file is too big or too long
// to caption without freezing Discord. The page's timer, the renderer and the messages are handed in.

import { decompressFrames, parseGIF } from "gifuct-js";

import type { EncodeDeps, FrameSource, GifRenderer, GifScreen } from "./encode";
import { type CaptionMedia, type CaptionTransform, looksLikeGif } from "./media";

export const MAX_GIF_FRAMES = 600;
export const MAX_GIF_DURATION_MS = 30_000;
export const MAX_PIXELS = 4_000_000;
export const MIN_FRAME_LENGTH = 1000 / 50;
export const MAX_VIDEO_DURATION_SECONDS = 30;
export const MAX_VIDEO_FRAMES = 600;
export const LOAD_TIMEOUT_MS = 5000;
export const SEEK_TIMEOUT_MS = 4000;

export interface FrameDeps {
    deps: Pick<EncodeDeps, "fail">;
    sleep(ms: number): Promise<void>;
    /** A renderer for `frames` frames of the given size. */
    renderer(frames: number, width: number, height: number, transform: CaptionTransform): Pick<GifRenderer, "addGifFrame" | "addVideoFrame" | "render">;
    setTimer(run: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}

/** What the video code needs from a `<video>`. */
export interface VideoLike {
    readyState: number;
    currentTime: number;
    duration: number;
    videoWidth: number;
    videoHeight: number;
    addEventListener(type: string, listener: () => void, options?: { once: boolean; }): void;
    removeEventListener(type: string, listener: () => void): void;
    pause(): void;
}

export async function captionGif(frameDeps: FrameDeps, media: Pick<CaptionMedia, "buffer" | "contentType">, transform: CaptionTransform): Promise<void> {
    const parsed = parseGIF(media.buffer);
    if (parsed.lsd.width * parsed.lsd.height > MAX_PIXELS || transform.width * transform.height > MAX_PIXELS) {
        frameDeps.deps.fail("GIF is too large to caption safely.");
        return;
    }
    const frames = decompressFrames(parsed, true);
    const duration = frames.reduce((total, frame) => total + frame.delay, 0);
    if (frames.length > MAX_GIF_FRAMES || duration > MAX_GIF_DURATION_MS) {
        frameDeps.deps.fail("GIF is too long to caption safely.");
        return;
    }
    const renderer = frameDeps.renderer(frames.length, transform.width, transform.height, transform);
    for (const frame of frames) {
        renderer.addGifFrame(frame as unknown as FrameSource, parsed as unknown as GifScreen);
        await frameDeps.sleep(0);
    }
    renderer.render();
}

function waitFor(video: VideoLike, doneEvents: string[], timeoutMs: number, deps: Pick<FrameDeps, "setTimer" | "clearTimer">, isDone: () => boolean): Promise<boolean> {
    if (isDone()) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
        const listeners = new Map<string, () => void>();
        const finish = (ok: boolean) => {
            for (const [type, listener] of listeners) video.removeEventListener(type, listener);
            deps.clearTimer(timer);
            resolve(ok);
        };
        const timer = deps.setTimer(() => { finish(false); }, timeoutMs);
        for (const type of doneEvents) {
            const listener = () => { finish(type !== "error"); };
            listeners.set(type, listener);
            video.addEventListener(type, listener, { once: true });
        }
    });
}

export const waitForLoadedData = (video: VideoLike, deps: Pick<FrameDeps, "setTimer" | "clearTimer">) =>
    waitFor(video, ["loadeddata", "error"], LOAD_TIMEOUT_MS, deps, () => video.readyState >= 2);

/** Moves the video to `time` seconds and waits until it is there. */
export function seekTo(video: VideoLike, time: number, deps: Pick<FrameDeps, "setTimer" | "clearTimer">): Promise<boolean> {
    const target = Math.max(0, time);
    if (Math.abs(video.currentTime - target) < 0.001) return Promise.resolve(true);
    const waiting = waitFor(video, ["seeked", "error"], SEEK_TIMEOUT_MS, deps, () => false);
    video.currentTime = target;
    return waiting;
}

export async function captionVideo(frameDeps: FrameDeps, transform: CaptionTransform): Promise<void> {
    const fail = (message: string) => { frameDeps.deps.fail(message); };
    const video = transform.sourceVideo as unknown as VideoLike | null | undefined;
    if (!video) {
        fail("Failed to load video.");
        return;
    }
    try {
        if (!await waitForLoadedData(video, frameDeps)) { fail("Failed to load video."); return; }
        if (!await seekTo(video, 0, frameDeps)) { fail("Failed to read video metadata."); return; }
        const width = transform.width || video.videoWidth;
        const height = transform.height || video.videoHeight;
        if (!width || !height) { fail("Failed to read video metadata."); return; }
        if (width * height > MAX_PIXELS) { fail("Video is too large to caption safely."); return; }
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (!duration) { fail("Failed to read video metadata."); return; }
        if (duration > MAX_VIDEO_DURATION_SECONDS) { fail("Video is too long to caption safely."); return; }

        const frames = Math.min(MAX_VIDEO_FRAMES, Math.max(1, Math.ceil(duration * 1000 / MIN_FRAME_LENGTH)));
        const renderer = frameDeps.renderer(frames, width, height, transform);
        const step = duration / frames;
        const delay = Math.max(MIN_FRAME_LENGTH, step * 1000);
        renderer.addVideoFrame(video, delay);
        let time = step;
        for (let frame = 1; frame < frames; frame++) {
            if (!await seekTo(video, time, frameDeps)) break;
            renderer.addVideoFrame(video, delay);
            time += step;
        }
        renderer.render();
    } finally {
        video.pause();
    }
}

/** A GIF is read frame by frame; anything else is played as a video. */
export async function captionMedia(frameDeps: FrameDeps, media: CaptionMedia, transform: CaptionTransform): Promise<void> {
    if (looksLikeGif(media)) await captionGif(frameDeps, media, transform);
    else await captionVideo(frameDeps, transform);
}
