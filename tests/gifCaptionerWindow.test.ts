/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { setReactSource } from "../src/api/jsxRuntime";
import { SettingsClient } from "../src/api/settingsClient";
import type { EnginePluginContext } from "../src/renderer/engine";
import { createCaptioner, drawPreview, PLACEHOLDER } from "../src/testcordplugins/GifCaptioner/captioner";
import type { Context2D } from "../src/testcordplugins/GifCaptioner/encode";
import plugin, { loadFont, loadFontList, maxFileBytes, openCaptionWindow, PENCIL_PATH, settings, UPLOAD_PLATFORM_WEB, uploadDeps } from "../src/testcordplugins/GifCaptioner/index";
import type { CaptionMedia } from "../src/testcordplugins/GifCaptioner/media";
import { MAX_MEDIA_PIXELS, type ResolveDeps, resolveMedia } from "../src/testcordplugins/GifCaptioner/resolve";
import { createStatus, FAILURE_TIMEOUT_MS, type StatusDeps } from "../src/testcordplugins/GifCaptioner/status";
import { CAPTIONER_CSS } from "../src/testcordplugins/GifCaptioner/styles";
import { hasMatchingAttachment, resolveUploadChannelId, type UploadDeps, uploadFile, type UploadLike, WAIT_FOR_MESSAGE_MS } from "../src/testcordplugins/GifCaptioner/upload";
import { renderCaptionWindow, type WindowActions, type WindowParts } from "../src/testcordplugins/GifCaptioner/view";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function statusWorld() {
    const toasts: Array<[string, string | undefined]> = [];
    const timers = new Map<number, { run: () => void; ms: number; }>();
    let next = 1;
    const deps: StatusDeps = {
        toast: (message, kind) => { toasts.push([message, kind]); },
        setTimer: (run, ms) => { const id = next++; timers.set(id, { run, ms }); return id; },
        clearTimer: id => { timers.delete(id as number); }
    };
    return { toasts, timers, deps, status: createStatus(deps) };
}

describe("GifCaptioner: the messages of the steps", () => {
    it("says creating and uploading, with a timer that says it timed out if nothing ends", () => {
        const world = statusWorld();
        world.status.creating();
        assert.deepEqual(world.toasts, [["Creating GIF...", undefined]]);
        assert.deepEqual([...world.timers.values()].map(timer => timer.ms), [FAILURE_TIMEOUT_MS]);
        world.status.uploading();
        assert.equal(world.timers.size, 1, "a new step replaces the timer");
        assert.deepEqual(world.toasts.at(-1), ["Uploading GIF...", undefined]);
        [...world.timers.values()][0].run();
        assert.deepEqual(world.toasts.at(-1), ["GIF processing timed out.", "failure"]);
        assert.equal(world.timers.size, 1, "the timer that fired is not cleared again");
    });

    it("stops the timer when the GIF was sent or when it failed, and says so", () => {
        const sent = statusWorld();
        sent.status.uploading();
        sent.status.sent();
        assert.equal(sent.timers.size, 0);
        assert.deepEqual(sent.toasts.at(-1), ["GIF sent.", "success"]);
        const failed = statusWorld();
        failed.status.creating();
        failed.status.error("Nope.");
        failed.status.error();
        failed.status.error("");
        assert.equal(failed.timers.size, 0);
        assert.deepEqual(failed.toasts.slice(-3), [["Nope.", "failure"], ["Failed to create GIF.", "failure"], ["Failed to create GIF.", "failure"]]);
    });

    it("clears the timer on demand, and again without harm", () => {
        const world = statusWorld();
        world.status.creating();
        world.status.clear();
        world.status.clear();
        assert.equal(world.timers.size, 0);
        assert.equal(FAILURE_TIMEOUT_MS, 60_000);
    });
});

function uploadWorld(options: { selected?: string | undefined; channels?: Record<string, object>; path?: string; me?: string | undefined; sendResult?: unknown; } = {}) {
    const events = new Map<string, () => void>();
    const log: string[] = [];
    const listeners = new Set<(data: { message?: object; }) => void>();
    const timers = new Map<number, { run: () => void; ms: number; }>();
    let next = 1;
    const statusLog: string[] = [];
    const upload: UploadLike = { on: (event, listener) => { events.set(event, listener); }, upload: () => { log.push("upload"); } };
    const deps: UploadDeps = {
        selectedChannelId: () => ("selected" in options ? options.selected : "C1"),
        channel: id => (options.channels ?? { C1: {} })[id],
        pathname: () => options.path ?? "/channels/1/C1",
        currentUserId: () => ("me" in options ? options.me : "me"),
        makeUpload: (file, channelId) => { log.push(`make ${file.name} ${channelId}`); return upload; },
        send: (channelId, given) => { log.push(`send ${channelId} ${given === upload}`); return options.sendResult; },
        onMessageCreate: listener => { listeners.add(listener as never); return () => { listeners.delete(listener as never); }; },
        setTimer: (run, ms) => { const id = next++; timers.set(id, { run, ms }); return id; },
        clearTimer: id => { timers.delete(id as number); },
        status: { creating: () => undefined, uploading: () => { statusLog.push("uploading"); }, sent: () => { statusLog.push("sent"); }, error: message => { statusLog.push(`error ${message}`); }, clear: () => undefined }
    };
    return { deps, events, log, listeners, timers, statusLog };
}

const file = (name = "rendered.gif", size = 5) => new File([new Uint8Array(size)], name, { type: "image/gif" });
const forum = (extra: object = {}) => ({ isForumChannel: () => true, ...extra });

describe("GifCaptioner: sending", () => {
    it("sends to the open conversation: uploads the file, then sends the message, and says sent when the message shows up", () => {
        const world = uploadWorld();
        uploadFile(world.deps, file());
        assert.deepEqual(world.log, ["make rendered.gif C1", "upload"]);
        assert.deepEqual(world.statusLog, ["uploading"]);
        world.events.get("complete")!();
        assert.deepEqual(world.log.slice(2), ["send C1 true"]);
        assert.equal(world.listeners.size, 1);
        assert.deepEqual([...world.timers.values()].map(timer => timer.ms), [WAIT_FOR_MESSAGE_MS]);
        [...world.listeners][0]({ message: { channel_id: "C1", author: { id: "me" }, attachments: [{ filename: "rendered.gif" }] } });
        assert.deepEqual(world.statusLog, ["uploading", "sent"]);
        assert.equal(world.listeners.size, 0, "it stops listening");
        assert.equal(world.timers.size, 0, "and stops the timer");
    });

    it("ignores messages that are not this one: another conversation, another person, another file, none at all", () => {
        const world = uploadWorld();
        uploadFile(world.deps, file("a.gif", 5));
        world.events.get("complete")!();
        const listener = [...world.listeners][0];
        listener({});
        listener({ message: { channel_id: "OTHER", author: { id: "me" }, attachments: [{ filename: "a.gif" }] } });
        listener({ message: { channel_id: "C1", author: { id: "someone" }, attachments: [{ filename: "a.gif" }] } });
        listener({ message: { channel_id: "C1", author: { id: "me" }, attachments: [{ filename: "b.gif", size: 99 }] } });
        listener({ message: { channel_id: "C1", author: { id: "me" } } });
        assert.deepEqual(world.statusLog, ["uploading"]);
        listener({ message: { channel_id: "C1", author: { id: "me" }, attachments: [{ filename: "b.gif", size: 5 }] } });
        assert.deepEqual(world.statusLog, ["uploading", "sent"], "the same size counts as the same file");
    });

    it("does not look at who wrote the message when it does not know who the person is", () => {
        const world = uploadWorld({ me: undefined });
        uploadFile(world.deps, file());
        world.events.get("complete")!();
        [...world.listeners][0]({ message: { channel_id: "C1", author: { id: "anyone" }, attachments: [{ filename: "rendered.gif" }] } });
        assert.deepEqual(world.statusLog, ["uploading", "sent"]);
    });

    it("stops waiting for the message after fifteen seconds", () => {
        const world = uploadWorld();
        uploadFile(world.deps, file());
        world.events.get("complete")!();
        [...world.timers.values()][0].run();
        assert.equal(world.listeners.size, 0);
        assert.equal(world.timers.size, 0);
        assert.equal(WAIT_FOR_MESSAGE_MS, 15_000);
    });

    it("says it failed when the upload fails, or when sending the message fails (even later)", async () => {
        const upload = uploadWorld();
        uploadFile(upload.deps, file());
        upload.events.get("error")!();
        assert.deepEqual(upload.statusLog, ["uploading", "error Failed to upload GIF."]);
        const rejected = uploadWorld({ sendResult: Promise.reject(new Error("no")) });
        uploadFile(rejected.deps, file());
        rejected.events.get("complete")!();
        await flush();
        assert.deepEqual(rejected.statusLog, ["uploading", "error Failed to send message."]);
        const plain = uploadWorld({ sendResult: "not a promise" });
        uploadFile(plain.deps, file());
        plain.events.get("complete")!();
        await flush();
        assert.deepEqual(plain.statusLog, ["uploading"]);
    });

    it("says there is no conversation, or that a forum needs an open post, and sends nothing", () => {
        const none = uploadWorld({ selected: undefined });
        uploadFile(none.deps, file());
        assert.deepEqual(none.statusLog, ["error No channel selected."]);
        assert.deepEqual(none.log, []);
        const forumOnly = uploadWorld({ channels: { C1: forum() } });
        uploadFile(forumOnly.deps, file());
        assert.deepEqual(forumOnly.statusLog, ["error Open a forum post to send a message."]);
        const unknown = uploadWorld({ selected: "X", channels: {} });
        uploadFile(unknown.deps, file());
        assert.deepEqual(unknown.log.slice(0, 1), ["make rendered.gif X"], "a conversation Discord does not know is used as it is");
    });

    it("sends to the thread of an open forum post, found in the address of the page", () => {
        const channels = { C1: forum(), 109: { id: "109", parent_id: "C1", isThread: () => true }, P8: { id: "P8", parent_id: "C1", isForumPost: () => true }, N7: { id: "N7", parent_id: "C1" }, W5: { id: "W5", parent_id: "ELSE", isThread: () => true } };
        const pick = (path: string) => resolveUploadChannelId({ selectedChannelId: () => "C1", channel: id => (channels as Record<string, object>)[id] as never, pathname: () => path });
        assert.equal(pick("/channels/1/C1/threads/109"), "109");
        assert.equal(pick("/channels/1/P8"), "P8");
        assert.equal(pick("/channels/1/N7"), undefined, "a channel that is neither a thread nor a post");
        assert.equal(pick("/channels/1/W5"), undefined, "a thread of another forum");
        assert.equal(pick("/channels/1/nothing"), undefined);
        assert.equal(pick("/somewhere/else"), undefined);
    });

    it("matches the attachment of a message with the file by name or by size", () => {
        assert.equal(hasMatchingAttachment({ attachments: [{ filename: "a.gif", size: 1 }] }, { name: "a.gif", size: 9 }), true);
        assert.equal(hasMatchingAttachment({ attachments: [{ filename: "b.gif", size: 9 }] }, { name: "a.gif", size: 9 }), true);
        assert.equal(hasMatchingAttachment({ attachments: [{ filename: "b.gif", size: 1 }] }, { name: "a.gif", size: 9 }), false);
        assert.equal(hasMatchingAttachment({ attachments: [] }, { name: "a.gif", size: 9 }), false);
        assert.equal(hasMatchingAttachment({}, { name: "a.gif", size: 9 }), false);
    });
});

describe("GifCaptioner: opening the picture", () => {
    const deps = (answers: Record<string, { data: ArrayBuffer; contentType: string; } | null | "throw">, opened: Array<{ width: number; height: number; }> = []): ResolveDeps & { revoked: string[]; asked: string[]; made: Blob[]; } => {
        const world = {
            revoked: [] as string[], asked: [] as string[], made: [] as Blob[],
            fetchMedia: async (url: string) => { world.asked.push(url); const answer = answers[url]; if (answer === "throw") throw new Error("down"); return answer ?? null; },
            openPicture: async () => { const next = opened.shift(); if (!next) throw new Error("cannot open"); return { ...next, close: () => undefined }; },
            makeUrl: (blob: Blob) => { world.made.push(blob); return `blob:${world.made.length}`; },
            revokeUrl: (url: string) => { world.revoked.push(url); }
        };
        return world;
    };
    const png = { data: new Uint8Array([1, 2, 3]).buffer, contentType: "image/png" };

    it("takes the first address that gives a usable picture and keeps its size and a preview address", async () => {
        const world = deps({ a: null, b: "throw", c: png }, [{ width: 30, height: 20 }]);
        const media = await resolveMedia(world, ["a", "b", "c", "d"]);
        assert.deepEqual(world.asked, ["a", "b", "c"], "it stops at the first one that works");
        assert.deepEqual([media?.width, media?.height, media?.isVideo, media?.url, media?.contentType], [30, 20, false, "blob:1", "image/png"]);
        assert.equal(world.made[0].type, "image/png");
    });

    it("gives nothing when no address works, none is given, or a file cannot be used", async () => {
        assert.equal(await resolveMedia(deps({}), ["a", "b"]), null);
        assert.equal(await resolveMedia(deps({}), []), null);
        assert.equal(await resolveMedia(deps({ a: png }, []), ["a"]), null, "a picture that cannot be opened and is no GIF");
    });

    it("skips a picture that is too big and goes on to the next", async () => {
        const world = deps({ a: png, b: png }, [{ width: 2001, height: 2000 }, { width: 2000, height: 2000 }]);
        const media = await resolveMedia(world, ["a", "b"]);
        assert.deepEqual(world.asked, ["a", "b"]);
        assert.equal(media?.width, 2000);
        assert.equal(MAX_MEDIA_PIXELS, 4_000_000);
    });

    it("recognises a video without opening it, and lets go of the preview address once", async () => {
        const world = deps({ v: { data: new ArrayBuffer(4), contentType: "video/mp4" } });
        const media = await resolveMedia(world, ["v"]);
        assert.deepEqual([media?.isVideo, media?.width, media?.height], [true, 0, 0]);
        media?.release();
        media?.release();
        assert.deepEqual(world.revoked, ["blob:1"]);
    });
});

function fakeText(): Context2D & { lines: string[]; rects: string[]; } {
    const ctx = {
        lines: [] as string[], rects: [] as string[], font: "", fillStyle: "", textAlign: "", textBaseline: "",
        measureText: (text: string) => ({ width: text.length * 5 }),
        fillRect: (x: number, y: number, w: number, h: number) => { ctx.rects.push(`${x} ${y} ${w} ${h}`); }, fillText: (text: string) => { ctx.lines.push(text); }, clearRect: () => undefined, drawImage: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(0) }), createImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }), putImageData: () => undefined
    };
    return ctx as never;
}

describe("GifCaptioner: the caption window's state", () => {
    const media = { width: 640, height: 360 };
    const fonts = () => { const loaded: string[] = []; return { loaded, deps: { loadFont: async (family: string) => { loaded.push(family); return family !== "Broken"; } } }; };

    it("starts with a size that fits the media, the media's own size and the font it was given, and loads that font", async () => {
        const world = fonts();
        const captioner = createCaptioner(media, world.deps, "Roboto");
        assert.deepEqual(captioner.getState(), { text: "", size: 64, font: "Roboto", fontRevision: 0, width: 640, height: 360 });
        await flush();
        assert.deepEqual(world.loaded, ["Roboto"]);
        assert.equal(captioner.getState().fontRevision, 1, "the preview is drawn again with the font");
    });

    it("uses 480 by 270 and a size of at least 16 when the media has no size", () => {
        const captioner = createCaptioner({ width: 0, height: 0 }, fonts().deps);
        assert.deepEqual([captioner.getState().width, captioner.getState().height, captioner.getState().size, captioner.getState().font], [480, 270, 48, "Arial"]);
        assert.equal(createCaptioner({ width: 50, height: 50 }, fonts().deps).getState().size, 16);
    });

    it("never starts with a width or a height under one pixel, and takes a size of one pixel from the video", () => {
        const odd = createCaptioner({ width: -5, height: -9 }, fonts().deps);
        assert.deepEqual([odd.getState().width, odd.getState().height], [1, 1]);
        const captioner = createCaptioner(media, fonts().deps);
        captioner.setMediaSize(1, 1);
        assert.deepEqual([captioner.getState().width, captioner.getState().height], [1, 1]);
    });

    it("keeps the text, the size and the media size inside sensible limits", () => {
        const captioner = createCaptioner(media, fonts().deps);
        captioner.setText("x".repeat(300 + 20));
        assert.equal(captioner.getState().text.length, 300);
        captioner.setSize(1);
        assert.equal(captioner.getState().size, 5);
        captioner.setSize(999);
        assert.equal(captioner.getState().size, 200);
        captioner.setSize(50.5);
        assert.equal(captioner.getState().size, 50.5);
        for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "x" as unknown as number]) { captioner.setSize(bad); assert.equal(captioner.getState().size, 50.5); }
        captioner.setMediaSize(0, 0);
        captioner.setMediaSize(-1, 100);
        assert.deepEqual([captioner.getState().width, captioner.getState().height], [640, 100]);
        captioner.setMediaSize(320, 0);
        assert.deepEqual([captioner.getState().width, captioner.getState().height], [320, 100]);
    });

    it("changes the font, loads it once per choice, and does not redraw for a font that did not load", async () => {
        const world = fonts();
        const captioner = createCaptioner(media, world.deps);
        await flush();
        captioner.setFont("Lobster");
        captioner.setFont("Lobster");
        await flush();
        assert.deepEqual(world.loaded, ["Arial", "Lobster"]);
        assert.deepEqual([captioner.getState().font, captioner.getState().fontRevision], ["Lobster", 2]);
        captioner.setFont("Broken");
        await flush();
        assert.deepEqual([captioner.getState().font, captioner.getState().fontRevision], ["Broken", 2]);
        const throwing = createCaptioner(media, { loadFont: async () => { throw new Error("no"); } });
        await flush();
        assert.equal(throwing.getState().fontRevision, 0);
    });

    it("gives what to draw on the media, with the video once the window has it", () => {
        const captioner = createCaptioner(media, fonts().deps, "Roboto");
        captioner.setText("hi");
        const video = { name: "video" };
        captioner.setVideo(video);
        assert.deepEqual(captioner.transform(), { height: 360, sourceVideo: video as never, text: "hi", size: 64, type: "caption", width: 640 });
    });

    it("tells whoever listens, and nobody once it is closed", () => {
        const captioner = createCaptioner(media, fonts().deps);
        let heard = 0;
        const leave = captioner.subscribe(() => { heard++; });
        captioner.setText("a");
        assert.equal(heard, 1);
        leave();
        captioner.setText("b");
        assert.equal(heard, 1);
        captioner.subscribe(() => { heard++; });
        captioner.dispose();
        captioner.setText("c");
        assert.deepEqual([heard, captioner.getState().text], [1, "b"]);
    });

    it("draws the caption band as a preview, with a placeholder when there is no text", () => {
        const ctx = fakeText();
        const canvas = { width: 0, height: 0, getContext: () => ctx };
        drawPreview(canvas, { text: "", size: 20, font: "Roboto", width: 640 });
        assert.deepEqual([canvas.width, canvas.height], [640, 30]);
        assert.deepEqual(ctx.lines, [PLACEHOLDER]);
        assert.deepEqual(ctx.rects, ["0 0 640 30"], "the white band starts at the corner");
        assert.equal(ctx.font, "20px Roboto");
        drawPreview(canvas, { text: "a b c d e f g h i j k l m n o p q r s t u v w x y z a b c d e f g h", size: 20, font: "Roboto", width: 100 });
        assert.equal(canvas.height > 30, true, "a long caption makes the band taller");
        assert.equal(canvas.width, 100);
        drawPreview({ width: 5, height: 5, getContext: () => null }, { text: "x", size: 1, font: "A", width: 1 });
        drawPreview(canvas, { text: "x", size: 20, font: "Roboto", width: 0 });
        assert.equal(canvas.width, 1, "never narrower than a pixel");
    });
});

interface Element { type: unknown; props: Record<string, unknown>; children: unknown[]; }
const make = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children });
const parts: WindowParts = { Root: "Root", Header: "Header", Content: "Content", Footer: "Footer", CloseButton: "Close" };
function find(node: unknown, test: (element: Element) => boolean, found: Element[] = []): Element[] {
    if (node && typeof node === "object" && "type" in node) {
        const element = node as Element;
        if (test(element)) found.push(element);
        for (const child of element.children) find(child, test, found);
    }
    return found;
}
const byClass = (node: unknown, name: string) => find(node, element => String(element.props.className ?? "").split(" ").includes(name));
const text = (node: unknown): string => (typeof node === "string" ? node : node && typeof node === "object" && "children" in node ? (node as Element).children.map(text).join("") : "");

function actionsFor() {
    const calls: string[] = [];
    const actions: WindowActions = {
        setText: value => { calls.push(`text:${value}`); }, setSize: value => { calls.push(`size:${value}`); }, setFont: value => { calls.push(`font:${value}`); },
        setVideo: () => { calls.push("video"); }, setMediaSize: (w, h) => { calls.push(`media:${w}x${h}`); }, cancel: () => { calls.push("cancel"); }, apply: () => { calls.push("apply"); }
    };
    return { calls, actions };
}

describe("GifCaptioner: how the window looks", () => {
    const state = { text: "hello", size: 40, font: "Lobster", fontRevision: 0, width: 640, height: 360 };
    const fonts = [{ family: "Lobster", displayName: "Lobster" }, { family: "Roboto", displayName: "Roboto Regular" }];
    const picture = { url: "blob:1", isVideo: false };

    it("has the caption box, the font list, the size slider, the preview and the two buttons, wired to their actions", () => {
        const { calls, actions } = actionsFor();
        const tree = renderCaptionWindow(make as never, parts, picture, state, fonts, actions) as Element;
        assert.equal(tree.type, "Root");
        assert.equal(tree.props.label, "Edit GIF");
        (tree.props.onClose as () => void)();
        const input = byClass(tree, "vc-gif-captioner-caption")[0];
        assert.deepEqual([input.props.value, input.props.placeholder, input.props.maxLength, input.props.autoFocus], ["hello", "Enter caption...", 300, true]);
        (input.props.onChange as (event: unknown) => void)({ target: { value: "new" } });
        const select = byClass(tree, "vc-gif-captioner-select")[0];
        assert.equal(select.props.value, "Lobster");
        assert.deepEqual(select.children.map(option => [(option as Element).props.value, text(option)]), [["Lobster", "Lobster"], ["Roboto", "Roboto Regular"]]);
        (select.props.onChange as (event: unknown) => void)({ target: { value: "Roboto" } });
        const range = find(tree, element => element.props.type === "range")[0];
        assert.deepEqual([range.props.min, range.props.max, range.props.value], [5, 200, 40]);
        (range.props.onChange as (event: unknown) => void)({ target: { value: "55.5" } });
        const [cancel, apply] = find(tree, element => element.type === "button");
        assert.deepEqual([text(cancel), text(apply)], ["Cancel", "Apply"]);
        (cancel.props.onClick as () => void)();
        (apply.props.onClick as () => void)();
        (find(tree, element => element.type === "Close")[0].props.onClick as () => void)();
        assert.deepEqual(calls, ["cancel", "text:new", "font:Roboto", "size:55.5", "cancel", "apply", "cancel"]);
    });

    it("says the fonts are loading while the list is empty", () => {
        const tree = renderCaptionWindow(make as never, parts, picture, state, [], actionsFor().actions);
        assert.equal(byClass(tree, "vc-gif-captioner-select").length, 0);
        assert.equal(find(tree, element => text(element) === "Loading fonts...").length > 0, true);
    });

    it("shows a picture for a GIF and a playing video for a video, and passes on what the video learns", () => {
        const { calls, actions } = actionsFor();
        const gif = renderCaptionWindow(make as never, parts, picture, state, fonts, actions);
        const image = find(gif, element => element.type === "img")[0];
        assert.deepEqual([image.props.src, image.props.alt], ["blob:1", "GIF preview"]);
        assert.equal(find(gif, element => element.type === "video").length, 0);
        const clip = renderCaptionWindow(make as never, parts, { url: "blob:2", isVideo: true }, state, fonts, actions);
        const video = find(clip, element => element.type === "video")[0];
        assert.deepEqual([video.props.src, video.props.autoPlay, video.props.loop, video.props.muted, video.props.playsInline], ["blob:2", true, true, true, true]);
        (video.props.ref as (element: unknown) => void)({});
        (video.props.onLoadedMetadata as (event: unknown) => void)({ currentTarget: { videoWidth: 320, videoHeight: 240 } });
        assert.deepEqual(calls, ["video", "media:320x240"]);
        assert.equal(find(clip, element => element.type === "img").length, 0);
    });

    it("draws the preview into its canvas whenever the window is drawn, and not when there is no canvas", () => {
        const tree = renderCaptionWindow(make as never, parts, picture, state, fonts, actionsFor().actions);
        const canvas = byClass(tree, "vc-gif-captioner-preview-canvas")[0];
        const ctx = fakeText();
        const element = { width: 0, height: 0, getContext: () => ctx };
        (canvas.props.ref as (value: unknown) => void)(element);
        assert.deepEqual(ctx.lines, ["hello"]);
        assert.equal(ctx.font, "40px Lobster");
        assert.doesNotThrow(() => (canvas.props.ref as (value: unknown) => void)(null));
    });
});

describe("GifCaptioner: the plugin", () => {
    const names = ["window", "setTimeout", "clearTimeout"];
    const saved = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    afterEach(() => {
        plugin.stop?.(undefined as never);
        settings.unbind();
        setReactSource(undefined);
        for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
    });

    function context(nativeAnswers: Record<string, unknown> = {}) {
        const toasts: Array<[string, string | undefined]> = [];
        const styles: Array<{ css: string; name?: string; removed: boolean; }> = [];
        const opened: Array<{ render: unknown; options: { onCloseCallback?(): void; } | undefined; }> = [];
        const closed: string[] = [];
        const called: Array<[string, unknown[]]> = [];
        const errors: string[] = [];
        const ctx = {
            toasts: { show: (message: string, kind?: string) => { toasts.push([message, kind]); } },
            addStyle: (css: string, name?: string) => { const entry = { css, name, removed: false }; styles.push(entry); return { remove: () => { entry.removed = true; } }; },
            modals: { open: (render: unknown, options?: { onCloseCallback?(): void; }) => { opened.push({ render, options }); return "key"; }, closeAll: () => { closed.push("all"); } },
            native: { call: async (fn: string, ...args: unknown[]) => { called.push([fn, args]); const answer = nativeAnswers[fn]; if (answer instanceof Error) throw answer; return answer; } },
            components: Object.fromEntries(["ModalRoot", "ModalHeader", "ModalContent", "ModalFooter", "ModalCloseButton"].map(name => [name, { get: () => name }])),
            reportError: (source: string) => { errors.push(source); },
            finders: { byCode: () => ({ get: () => undefined }), byProps: () => ({ get: () => undefined }) },
            common: { FluxDispatcher: { get: () => undefined }, SelectedChannelStore: { get: () => undefined }, ChannelStore: { get: () => undefined }, UserStore: { get: () => undefined } }
        };
        return { ctx: ctx as unknown as EnginePluginContext, toasts, styles, opened, closed, called, errors };
    }

    it("adds its style when it starts, takes it away and closes its windows when it stops", () => {
        const world = context();
        plugin.start!(world.ctx);
        assert.deepEqual(world.styles.map(style => [style.css, style.name]), [[CAPTIONER_CSS, "gif-captioner"]]);
        plugin.stop!(world.ctx);
        assert.equal(world.styles[0].removed, true);
        assert.deepEqual(world.closed, ["all"]);
        assert.doesNotThrow(() => plugin.stop!(world.ctx));
    });

    it("puts the pencil button in the GIF picker's items, where the item draws its GIF", () => {
        const patch: RegisteredPatch = { ...plugin.patches![0], plugin: "GifCaptioner" };
        const source = "function(e,t,n){class A{render(){return h({className:c,children:[x,this.renderGIF()]})}}}";
        const result = compileModule("3", source, [patch]);
        assert.match(result.code, /children:\[.*renderCaptionButton\(this\),x,this\.renderGIF\(\)\]/);
        assert.equal(compileModule("3", "function(e,t,n){return 1}", [patch]).outcomes.length, 0);
        const far = "function(e,t,n){class A{render(){return h({children:[" + "x,".repeat(60) + "this.renderGIF()]})}}}";
        assert.equal(compileModule("3", far, [patch]).outcomes[0].replacements[0].status !== "applied", true, "the button goes only when the GIF is drawn right there");
    });

    function reactOf() {
        setReactSource(() => ({ createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }), Fragment: Symbol("f") }) as never);
    }

    it("gives no button without props or before it started, and a pencil button otherwise", () => {
        reactOf();
        const button = (instance: unknown) => plugin.renderCaptionButton(instance as never) as unknown as Element | null;
        assert.equal(button(undefined), null);
        assert.equal(button({}), null);
        assert.equal(button({ props: { src: "x" } }), null, "not started yet");
        plugin.start!(context().ctx);
        const element = button({ props: { src: "x" } })!;
        assert.deepEqual([element.type, element.props.type, element.props.className, element.props.title], ["button", "button", "vc-gif-captioner-trigger vc-gif-captioner-trigger-icon", "Caption this GIF"]);
        const svg = element.children[0] as Element;
        assert.equal(svg.type, "svg");
        assert.equal((svg.children[0] as Element).props.d, PENCIL_PATH);
        assert.deepEqual([svg.props.width, svg.props.height, svg.props.viewBox], [16, 16, "0 0 24 24"]);
    });

    it("downloads the item through the main process, opens the caption window with it, and says when it cannot", async () => {
        reactOf();
        const png = new Uint8Array([1, 2, 3]).buffer;
        const world = context({ fetchMedia: { data: png, contentType: "image/png" } });
        plugin.start!(world.ctx);
        const originals = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, bitmap: (globalThis as Record<string, unknown>).createImageBitmap };
        (URL as unknown as Record<string, unknown>).createObjectURL = () => "blob:preview";
        (URL as unknown as Record<string, unknown>).revokeObjectURL = () => undefined;
        (globalThis as Record<string, unknown>).createImageBitmap = async () => ({ width: 30, height: 20, close: () => undefined });
        try {
            const element = plugin.renderCaptionButton({ props: { src: "https://media.tenor.com/abcdeAAA/x", format: 1 } }) as unknown as Element;
            const stopped: string[] = [];
            await (element.props.onClick as (event: unknown) => Promise<void>)({ stopPropagation: () => { stopped.push("stop"); } });
            assert.deepEqual(stopped, ["stop"]);
            assert.deepEqual(world.called, [["fetchMedia", ["https://media.tenor.com/abcdeAAA/x"]], ["fontList", []]], "then the list of fonts, for the window");
            assert.equal(world.opened.length, 1, "the window opened");
            assert.deepEqual(world.toasts, []);
            // nothing to download: said so, no window
            const empty = context({ fetchMedia: null });
            plugin.stop!(world.ctx);
            plugin.start!(empty.ctx);
            const again = plugin.renderCaptionButton({ props: { src: "https://media.tenor.com/abcdeAAA/x", format: 1 } }) as unknown as Element;
            await (again.props.onClick as (event: unknown) => Promise<void>)({ stopPropagation: () => undefined });
            assert.deepEqual(empty.toasts, [["Failed to load GIF.", "failure"]]);
            assert.equal(empty.opened.length, 0);
            // the main process failing: reported and said
            const broken = context({ fetchMedia: new Error("offline") });
            plugin.stop!(empty.ctx);
            plugin.start!(broken.ctx);
            const third = plugin.renderCaptionButton({ props: { src: "https://media.tenor.com/abcdeAAA/x", format: 1 } }) as unknown as Element;
            await (third.props.onClick as (event: unknown) => Promise<void>)({ stopPropagation: () => undefined });
            assert.deepEqual(broken.toasts, [["Failed to load GIF.", "failure"]]);
        } finally {
            URL.createObjectURL = originals.create;
            URL.revokeObjectURL = originals.revoke;
            (globalThis as Record<string, unknown>).createImageBitmap = originals.bitmap;
        }
    });

    it("opens the window with Discord's pieces, asks for the list of fonts once, and lets go of the picture when it closes", async () => {
        const world = context({ fontList: [{ family: "Roboto", displayName: "Roboto" }], fontFile: null });
        plugin.start!(world.ctx);
        let released = 0;
        const media: CaptionMedia = { buffer: new ArrayBuffer(1), contentType: "image/gif", height: 20, width: 30, isVideo: false, release: () => { released++; }, url: "blob:1" };
        assert.equal(openCaptionWindow(world.ctx, media), "key");
        openCaptionWindow(world.ctx, media);
        await flush();
        assert.equal(world.called.filter(([fn]) => fn === "fontList").length, 1, "the list is asked for once");
        world.opened[0].options!.onCloseCallback!();
        assert.equal(released, 1);
        assert.equal(typeof world.opened[0].render, "function");
    });

    it("sends the file through Discord's uploader and its own send function, with the arguments Discord's attach button uses", () => {
        const sent: unknown[][] = [];
        const made: unknown[][] = [];
        class Uploader { constructor(...args: unknown[]) { made.push(args); } on() { return this; } upload() { return undefined; } }
        const world = context();
        const finders = world.ctx.finders as unknown as { byCode(...snippets: string[]): unknown; byProps(...names: string[]): unknown; };
        const asked: string[][] = [];
        (world.ctx as unknown as { finders: unknown; }).finders = {
            byCode: (...snippets: string[]) => { asked.push(snippets); return { get: () => Uploader }; },
            byProps: (...names: string[]) => { asked.push(names); return { get: () => ({ _sendMessage: (...args: unknown[]) => { sent.push(args); return "done"; } }) }; }
        };
        void finders;
        const deps = uploadDeps(world.ctx);
        const upload = deps.makeUpload(new File([new Uint8Array(1)], "a.gif"), "C9");
        assert.ok(upload instanceof Uploader);
        assert.deepEqual(made[0].slice(1), ["C9"]);
        assert.deepEqual({ ...(made[0][0] as object), file: undefined }, { file: undefined, isThumbnail: false, platform: 1 });
        assert.equal(deps.send("C9", upload), "done");
        assert.deepEqual(sent[0], ["C9", { content: "", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, { attachmentsToUpload: [upload] }]);
        assert.deepEqual(asked, [["trackUploadFinished"], ["_sendMessage", "sendMessage"]]);
    });

    it("says what is missing when Discord's uploader or send function was not found", () => {
        const world = context();
        const deps = uploadDeps(world.ctx);
        assert.throws(() => deps.makeUpload(new File([], "a.gif"), "C"), /uploader was not found/);
        assert.throws(() => deps.send("C", {} as never), /send function was not found/);
    });

    it("hands Discord's stores and events to the upload: the open conversation, the account, the thread address, and the message events", () => {
        const world = context();
        const events: string[] = [];
        const listener = () => undefined;
        const common = world.ctx.common as unknown as Record<string, { get(): unknown; }>;
        common.SelectedChannelStore = { get: () => ({ getChannelId: () => "C7" }) };
        common.UserStore = { get: () => ({ getCurrentUser: () => ({ id: "U1" }) }) };
        common.ChannelStore = { get: () => ({ getChannel: (id: string) => ({ id }) }) };
        common.FluxDispatcher = { get: () => ({ subscribe: (type: string) => { events.push(`on ${type}`); }, unsubscribe: (type: string) => { events.push(`off ${type}`); } }) };
        Object.defineProperty(globalThis, "window", { value: { location: { pathname: "/channels/1/C7" } }, configurable: true, writable: true });
        const deps = uploadDeps(world.ctx);
        assert.deepEqual([deps.selectedChannelId(), deps.currentUserId(), deps.channel("X"), deps.pathname()], ["C7", "U1", { id: "X" }, "/channels/1/C7"]);
        deps.onMessageCreate(listener)();
        assert.deepEqual(events, ["on MESSAGE_CREATE", "off MESSAGE_CREATE"]);
        common.FluxDispatcher = { get: () => undefined };
        assert.doesNotThrow(() => uploadDeps(world.ctx).onMessageCreate(listener)());
    });

    it("loads a font from the main process, once, and tells whether it is ready", async () => {
        const added: unknown[] = [];
        const created: Array<[string, unknown]> = [];
        class FakeFont { constructor(family: string, data: unknown) { created.push([family, data]); } async load() { return this; } }
        Object.defineProperty(globalThis, "FontFace", { value: FakeFont, configurable: true, writable: true });
        Object.defineProperty(globalThis, "document", { value: { fonts: { add: (font: unknown) => { added.push(font); } } }, configurable: true, writable: true });
        const file = new ArrayBuffer(3);
        const world = context({ fontFile: file });
        try {
            assert.equal(await loadFont(world.ctx, "Lobster"), true);
            assert.equal(await loadFont(world.ctx, "Lobster"), true);
            assert.deepEqual(created, [["Lobster", file]]);
            assert.equal(added.length, 1);
            assert.deepEqual(world.called, [["fontFile", ["Lobster"]]], "the second time it is not asked for again");
            assert.equal(await loadFont(world.ctx, "Arial"), true, "Arial is the page's own");
            assert.deepEqual(world.called.length, 1);
            const none = context({ fontFile: null });
            assert.equal(await loadFont(none.ctx, "Missing"), false);
            assert.equal(added.length, 1);
        } finally {
            delete (globalThis as Record<string, unknown>).FontFace;
        }
    });

    it("asks for the list of fonts again after a failure, but not after an answer", async () => {
        const failing = context({ fontList: new Error("offline") });
        plugin.start!(failing.ctx);
        loadFontList(failing.ctx);
        await flush();
        loadFontList(failing.ctx);
        await flush();
        assert.equal(failing.called.filter(([fn]) => fn === "fontList").length, 2);
        plugin.stop!(failing.ctx);
        const fine = context({ fontList: [] });
        plugin.start!(fine.ctx);
        loadFontList(fine.ctx);
        await flush();
        loadFontList(fine.ctx);
        assert.equal(fine.called.filter(([fn]) => fn === "fontList").length, 1);
    });

    it("works out the largest GIF in bytes from the setting", () => {
        settings.bind(new SettingsClient({ schema: 1, plugins: { GifCaptioner: { values: { maxFileSizeMb: 3 } } } }, () => undefined), "GifCaptioner");
        assert.equal(maxFileBytes(), 3 * 1024 * 1024);
        settings.unbind();
        settings.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "GifCaptioner");
        assert.equal(maxFileBytes(), 10 * 1024 * 1024);
    });

    it("keeps its setting for the size of the GIF inside its limits", () => {
        settings.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "GifCaptioner");
        const store = settings.store as unknown as Record<string, unknown>;
        assert.equal(settings.store.maxFileSizeMb, 10);
        for (const bad of [0, 501, 1.5]) assert.throws(() => { store.maxFileSizeMb = bad; }, TypeError, String(bad));
        for (const good of [1, 500]) assert.doesNotThrow(() => { try { store.maxFileSizeMb = good; } catch (error) { if (error instanceof TypeError) throw error; } }, String(good));
        assert.equal(UPLOAD_PLATFORM_WEB, 1);
    });
});
