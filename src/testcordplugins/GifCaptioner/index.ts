/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba of its public repository).
// A pencil button on every GIF of Discord's GIF picker opens a window to write a caption; the GIF is redrawn with the caption on a white band above it and sent as a
// message to the conversation that is open. The download and the fonts go through the main process (only the hosts listed in plugin.json).
// Differences from the original, NOT verified against a real Discord:
//   - no "CORS proxy" fallback (it sent every address to a third-party site), and no network at start: the list of fonts is asked for when the window opens;
//   - the size limit of the result is a setting (10 MB by default, the limit of an account without Nitro), the original always used 25 MB;
//   - the GIF picker is not closed after sending;
//   - the "speech bubble" files of the original were never used by it and are not carried over;
//   - Discord's uploader and send function are found by their code and properties (`trackUploadFinished`, `_sendMessage`), which are guesses until tried.

import { currentReact } from "../../api/jsxRuntime";
import { nativeOf } from "../../api/native";
import { definePluginSettings } from "../../api/pluginSettings";
import { makeErrorBoundary } from "../../plugins/Settings/ErrorBoundary";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { type Captioner, createCaptioner, DEFAULT_FONT } from "./captioner";
import { type CanvasLike, GifRenderer } from "./encode";
import { captionMedia, type FrameDeps } from "./frames";
import type { CaptionMedia } from "./media";
import type * as NativeModule from "./native";
import { resolveMedia } from "./resolve";
import { createStatus, type Status } from "./status";
import { CAPTIONER_CSS } from "./styles";
import { type MessageLike, type UploadDeps, uploadFile, type UploadLike } from "./upload";
import { addressesFor, type ItemProps } from "./urls";
import { type FontChoice, renderCaptionWindow, type WindowParts } from "./view";

export const settings = definePluginSettings({
    maxFileSizeMb: { type: "number", default: 10, min: 1, max: 500, integer: true, description: "The largest GIF to send, in MB. Discord refuses more than 10 MB without Nitro." }
});

/** The pencil of the button, as one path of a 24 by 24 drawing. */
export const PENCIL_PATH = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z";
/** Value of Discord's `CloudUploadPlatform.WEB`. */
export const UPLOAD_PLATFORM_WEB = 1;

type UploaderClass = new (options: { file: File; isThumbnail: boolean; platform: number; }, channelId: string) => UploadLike;
interface MessageActions { _sendMessage(channelId: string, message: Record<string, unknown>, extra: Record<string, unknown>): unknown; }
interface FluxLike { subscribe(type: string, listener: (data: { message?: MessageLike; }) => void): void; unsubscribe(type: string, listener: (data: { message?: MessageLike; }) => void): void; }

let context: EnginePluginContext | undefined;
let Boundary: ReturnType<typeof makeErrorBoundary> | undefined;
let currentFont = DEFAULT_FONT;
let fontList: FontChoice[] = [];
let fontsAsked = false;
const fontListeners = new Set<() => void>();
const loadedFonts = new Set<string>();
let status: Status | undefined;
let styleHandle: { remove(): void; } | undefined;

const fontStore = {
    get: () => fontList,
    subscribe(listener: () => void) {
        fontListeners.add(listener);
        return () => { fontListeners.delete(listener); };
    }
};

const native = (ctx: EnginePluginContext) => nativeOf<typeof NativeModule>(ctx.native);

/** Asks for the list of Google's fonts, once per run of Discord. */
export function loadFontList(ctx: EnginePluginContext): void {
    if (fontsAsked) return;
    fontsAsked = true;
    void native(ctx).fontList().then(list => {
        fontList = list;
        for (const listener of [...fontListeners]) listener();
    }).catch(() => { fontsAsked = false; });
}

export async function loadFont(ctx: EnginePluginContext, family: string): Promise<boolean> {
    currentFont = family;
    if (loadedFonts.has(family) || family === DEFAULT_FONT) return true;
    const data = await native(ctx).fontFile(family);
    if (!data) return false;
    const font = new FontFace(family, data);
    await font.load();
    document.fonts.add(font);
    loadedFonts.add(family);
    return true;
}

function statusOf(ctx: EnginePluginContext): Status {
    return status ??= createStatus({
        toast: (message, kind) => { ctx.toasts.show(message, kind); },
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); }
    });
}

export function uploadDeps(ctx: EnginePluginContext): UploadDeps {
    const Uploader = ctx.finders.byCode<UploaderClass>("trackUploadFinished");
    const Messages = ctx.finders.byProps<MessageActions>("_sendMessage", "sendMessage");
    const flux = () => ctx.common.FluxDispatcher.get() as unknown as FluxLike | undefined;
    return {
        selectedChannelId: () => ctx.common.SelectedChannelStore.get()?.getChannelId(),
        channel: id => ctx.common.ChannelStore.get()?.getChannel(id) as ReturnType<UploadDeps["channel"]>,
        pathname: () => window.location.pathname,
        currentUserId: () => ctx.common.UserStore.get()?.getCurrentUser()?.id,
        makeUpload(file, channelId) {
            const Class = Uploader.get();
            if (!Class) throw new Error("Discord's uploader was not found.");
            return new Class({ file, isThumbnail: false, platform: UPLOAD_PLATFORM_WEB }, channelId);
        },
        send(channelId, upload) {
            const actions = Messages.get();
            if (!actions) throw new Error("Discord's send function was not found.");
            return actions._sendMessage(channelId, { content: "", tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, { attachmentsToUpload: [upload] });
        },
        onMessageCreate(listener) {
            const dispatcher = flux();
            dispatcher?.subscribe("MESSAGE_CREATE", listener);
            return () => { dispatcher?.unsubscribe("MESSAGE_CREATE", listener); };
        },
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); },
        status: statusOf(ctx)
    };
}

/** The largest GIF to send, in bytes. */
export const maxFileBytes = () => settings.store.maxFileSizeMb * 1024 * 1024;

function frameDeps(ctx: EnginePluginContext): FrameDeps {
    const state = statusOf(ctx);
    const encode = {
        makeCanvas: (width: number, height: number) => new OffscreenCanvas(width, height) as unknown as CanvasLike,
        font: () => currentFont,
        maxFileSize: maxFileBytes,
        fail: (message: string) => { state.error(message); },
        deliver: (file: File) => {
            try {
                uploadFile(uploadDeps(ctx), file);
            } catch (error) {
                state.error(error instanceof Error ? error.message : "Failed to upload GIF.");
            }
        }
    };
    return {
        deps: { fail: encode.fail },
        sleep: ms => new Promise(resolve => { setTimeout(resolve, ms); }),
        renderer: (frames, width, height, transform) => new GifRenderer(encode, { frames, width, height, transform }),
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>); }
    };
}

function Window({ captioner, media, parts, onCancel, onApply }: { captioner: Captioner; media: CaptionMedia; parts: WindowParts; onCancel(): void; onApply(): void; }) {
    const react = currentReact();
    const state = react.useSyncExternalStore(captioner.subscribe, captioner.getState);
    const fonts = react.useSyncExternalStore(fontStore.subscribe, fontStore.get);
    return renderCaptionWindow(react.createElement as never, parts, media, state, fonts, {
        setText: text => { captioner.setText(text); },
        setSize: size => { captioner.setSize(size); },
        setFont: family => { captioner.setFont(family); },
        setVideo: element => { captioner.setVideo(element); },
        setMediaSize: (width, height) => { captioner.setMediaSize(width, height); },
        cancel: onCancel,
        apply: onApply
    }) as never;
}

/** Opens the caption window for a downloaded GIF. */
export function openCaptionWindow(ctx: EnginePluginContext, media: CaptionMedia): string | undefined {
    const parts: WindowParts = {
        Root: ctx.components.ModalRoot.get(),
        Header: ctx.components.ModalHeader.get(),
        Content: ctx.components.ModalContent.get(),
        Footer: ctx.components.ModalFooter.get(),
        CloseButton: ctx.components.ModalCloseButton.get()
    };
    loadFontList(ctx);
    const captioner = createCaptioner(media, { loadFont: family => loadFont(ctx, family) }, currentFont);
    const finish = () => { captioner.dispose(); media.release(); };
    return ctx.modals.open(props => {
        Boundary ??= makeErrorBoundary(currentReact(), (label, error) => { ctx.reportError(label, error); });
        const apply = () => {
            const transform = captioner.transform();
            finish();
            props.onClose();
            statusOf(ctx).creating();
            // The buffer of the GIF stays in `media` for the frames; the preview address is already released.
            void captionMedia(frameDeps(ctx), media, transform).catch((error: unknown) => {
                ctx.reportError("GifCaptioner", error);
                statusOf(ctx).error();
            });
        };
        return currentReact().createElement(Boundary as never, { label: "GifCaptioner" }, currentReact().createElement(Window as never, {
            captioner, media, parts, onCancel: () => { finish(); props.onClose(); }, onApply: apply
        }));
    }, { onCloseCallback: finish });
}

/** The pencil button the patch puts on every item of the GIF picker. */
function renderCaptionButton(instance: { props?: ItemProps; } | null | undefined) {
    const props = instance?.props;
    const ctx = context;
    if (!props || !ctx) return null;
    const h = currentReact().createElement;
    return h("button", {
        type: "button",
        className: "vc-gif-captioner-trigger vc-gif-captioner-trigger-icon",
        title: "Caption this GIF",
        onClick: async (event: { stopPropagation(): void; }) => {
            event.stopPropagation();
            try {
                const media = await resolveMedia({
                    fetchMedia: url => native(ctx).fetchMedia(url),
                    openPicture: blob => createImageBitmap(blob),
                    makeUrl: blob => URL.createObjectURL(blob),
                    revokeUrl: url => { URL.revokeObjectURL(url); }
                }, addressesFor(props));
                if (!media) {
                    statusOf(ctx).error("Failed to load GIF.");
                    return;
                }
                openCaptionWindow(ctx, media);
            } catch (error) {
                ctx.reportError("GifCaptioner", error);
                statusOf(ctx).error("Failed to load GIF.");
            }
        }
    }, h("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true }, h("path", { d: PENCIL_PATH })));
}

const plugin: PluginCode & { renderCaptionButton: typeof renderCaptionButton; } = {
    settings,
    patches: [
        {
            find: "renderGIF",
            replacements: [{ match: /children:\[(?=[\s\S]{0,100}this\.renderGIF\(\))/, replace: "children:[$self.renderCaptionButton(this)," }]
        }
    ],
    renderCaptionButton,

    start(ctx) {
        context = ctx;
        styleHandle = ctx.addStyle(CAPTIONER_CSS, "gif-captioner");
    },

    stop() {
        styleHandle?.remove();
        styleHandle = undefined;
        context?.modals.closeAll();
        context = undefined;
        status?.clear();
        status = undefined;
        fontsAsked = false;
    }
};

export default plugin;
