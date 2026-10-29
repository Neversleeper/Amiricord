/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores, uploader and components have no types */

// Adapted for Amiricord (2026) from the plugin VoiceMessages (authors Ven, Vap and Nickyux) as found in TestCord's copy of Vencord's plugins. Right click the upload button (the "+"
// of the chat bar) and choose "Send Voice Message", or type the command /voice-message. A window records from the microphone (or takes an audio file you choose), shows it, and
// sends it as a voice message with Discord's own uploader. The sending part is the original's. Differences:
//  - only the browser's recorder is used (`MediaRecorder` with the input device chosen in Discord's voice settings); the original's desktop recorder needs Discord's native
//    module and a main-process file read, which Amiricord does not give;
//  - the preview is the browser's own `audio` player instead of Discord's voice message player (the patch that took that component is not carried over);
//  - the menu entry is added to `channel-attach` (NOT checked) and the command is the sure way in; the "send silently" flag of the original's other plugin is not used;
//  - the waveform reads each sample once (the original added the offset twice);
//  - "Send" and the answers are Amiricord's short messages.
// The recording stays in the page until you press Send; nothing is sent before that, and the microphone is released when you stop. NOT tried in a real Discord.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

const VOICE_MESSAGE_FLAG = 1 << 13;
const DEFAULT_WAVEFORM = "AAAAAAAAAAAA";
const DEFAULT_DURATION = 1;
const WAVEFORM_MIN_BINS = 32;
const WAVEFORM_MAX_BINS = 256;
const WAVEFORM_BINS_PER_SECOND = 10;
const WAVEFORM_MAX_VALUE = 0xFF;
const WEB_PLATFORM = 1;

interface AudioMetadata { waveform: string; duration: number; }
const EMPTY_META: AudioMetadata = { waveform: DEFAULT_WAVEFORM, duration: DEFAULT_DURATION };

const settings = definePluginSettings({
    noiseSuppression: { type: "boolean", default: true, description: "Noise Suppression" },
    echoCancellation: { type: "boolean", default: true, description: "Echo Cancellation" }
} as const);

const CSS = `
.ac-vmsg-buttons { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.ac-vmsg-buttons button, .ac-vmsg-actions button { padding: 8px 14px; border: none; border-radius: 4px; background: var(--brand-500, #5865f2); color: #fff; cursor: pointer; font-size: 14px; }
.ac-vmsg-buttons button:disabled, .ac-vmsg-actions button:disabled { opacity: 0.5; cursor: default; }
.ac-vmsg-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.ac-vmsg-preview { display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: 4px; background: var(--background-secondary, #2b2d31); color: var(--text-default, #dbdee1); }
.ac-vmsg-indicator { width: 10px; height: 10px; border-radius: 50%; background: var(--status-danger, #f23f43); }
.ac-vmsg-error { color: var(--status-danger, #f23f43); }
`;

let context: EnginePluginContext | undefined;
let styled = false;
let selectedChannel: Lazy;
let pendingReplies: Lazy;
let messageActions: Lazy;
let permissions: Lazy;
let mediaEngine: Lazy;
let rest: Lazy;
let snowflakes: Lazy;
let uploader: Lazy;
let dispatcher: Lazy;

function generateWaveform(buffer: AudioBuffer): string {
    const data = buffer.getChannelData(0);
    const count = Math.max(Math.min(WAVEFORM_MIN_BINS, data.length), Math.min(WAVEFORM_MAX_BINS, Math.floor(buffer.duration * WAVEFORM_BINS_PER_SECOND)));
    const bins = new Uint8Array(count);
    const perBin = Math.max(1, Math.floor(data.length / count));
    for (let bin = 0; bin < count; bin++) {
        let sum = 0;
        for (let sample = 0; sample < perBin; sample++) sum += data[bin * perBin + sample] ** 2;
        bins[bin] = Math.floor(Math.sqrt(sum / perBin) * WAVEFORM_MAX_VALUE);
    }
    const max = Math.max(...bins);
    if (max) {
        const easing = Math.min(1, 100 * (max / WAVEFORM_MAX_VALUE) ** 3);
        const ratio = 1 + (WAVEFORM_MAX_VALUE / max - 1) * easing;
        for (let i = 0; i < count; i++) bins[i] = Math.min(WAVEFORM_MAX_VALUE, Math.floor(bins[i] * ratio));
    }
    return window.btoa(String.fromCharCode(...bins));
}

function sendAudio(blob: Blob, meta: AudioMetadata): void {
    const channelId = selectedChannel?.get()?.getChannelId?.();
    const Uploader = uploader?.get();
    if (!channelId || !Uploader) {
        context?.toasts.show("Voice message: the channel or Discord's uploader was not found.", "failure");
        return;
    }
    const reply = pendingReplies?.get()?.getPendingReply?.(channelId);
    if (reply) dispatcher?.get()?.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

    const upload = new Uploader({
        file: new File([blob], "voice-message.ogg", { type: "audio/ogg; codecs=opus" }),
        isThumbnail: false,
        platform: WEB_PLATFORM
    }, channelId);

    upload.on("complete", () => {
        const posted: Promise<unknown> | undefined = rest?.get()?.post({
            url: `/channels/${channelId}/messages`,
            body: {
                flags: VOICE_MESSAGE_FLAG,
                channel_id: channelId,
                content: "",
                nonce: snowflakes?.get()?.fromTimestamp?.(Date.now()),
                sticker_ids: [],
                type: 0,
                attachments: [{ id: "0", filename: upload.filename, uploaded_filename: upload.uploadedFilename, waveform: meta.waveform, duration_secs: meta.duration }],
                message_reference: reply ? messageActions?.get()?.getSendMessageOptionsForReply?.(reply)?.messageReference : null
            }
        });
        posted?.catch(() => context?.toasts.show("The voice message was uploaded but Discord did not accept the message.", "failure"));
    });
    upload.on("error", () => context?.toasts.show("Failed to upload voice message", "failure"));
    upload.upload();
}

function openWindow(ctx: EnginePluginContext): void {
    const react = currentReact() as any;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) {
        ctx.toasts.show("The window could not be opened.", "failure");
        return;
    }
    const h = react.createElement;

    function Body({ onClose }: { onClose(): void; }) {
        const [recording, setRecording] = react.useState(false) as [boolean, (value: boolean) => void];
        const [paused, setPaused] = react.useState(false) as [boolean, (value: boolean) => void];
        const [recorder, setRecorder] = react.useState(undefined) as [MediaRecorder | undefined, (value: MediaRecorder | undefined) => void];
        const [blob, setBlob] = react.useState(undefined) as [Blob | undefined, (value: Blob | undefined) => void];
        const [url, setUrl] = react.useState(undefined) as [string | undefined, (value: string | undefined) => void];
        const [meta, setMeta] = react.useState(EMPTY_META) as [AudioMetadata, (value: AudioMetadata) => void];
        const [problem, setProblem] = react.useState("") as [string, (value: string) => void];

        // The sound and the microphone are let go when the window closes.
        react.useEffect(() => () => {
            recorder?.stream.getTracks().forEach(track => track.stop());
            if (url) URL.revokeObjectURL(url);
        }, [recorder, url]);

        const take = (file: Blob) => {
            if (url) URL.revokeObjectURL(url);
            setBlob(file);
            setUrl(URL.createObjectURL(file));
            setProblem("");
            // The audio context is closed after the decoding: the page only allows a few open at once.
            const audio = new AudioContext();
            file.arrayBuffer()
                .then(bytes => audio.decodeAudioData(bytes))
                .then(buffer => setMeta({ waveform: generateWaveform(buffer), duration: buffer.duration }))
                .catch((error: unknown) => { setMeta(EMPTY_META); setProblem(`Failed to parse the audio: ${error instanceof Error ? error.message : String(error)}`); })
                .finally(() => { void audio.close().catch(() => undefined); });
        };

        const toggle = () => {
            if (recording) {
                recorder?.stop();
                return;
            }
            navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: settings.store.echoCancellation,
                    noiseSuppression: settings.store.noiseSuppression,
                    deviceId: mediaEngine?.get()?.getInputDeviceId?.()
                }
            }).then(stream => {
                const chunks: Blob[] = [];
                const made = new MediaRecorder(stream);
                made.addEventListener("dataavailable", (event: BlobEvent) => { chunks.push(event.data); });
                made.addEventListener("stop", () => {
                    take(new Blob(chunks, { type: "audio/ogg; codecs=opus" }));
                    setRecording(false);
                    setPaused(false);
                    stream.getTracks().forEach(track => track.stop());
                }, { once: true });
                made.start();
                setRecorder(made);
                setRecording(true);
            }, (error: unknown) => setProblem(`The microphone could not be used: ${error instanceof Error ? error.message : String(error)}`));
        };

        const pick = () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "audio/*";
            input.addEventListener("change", () => { const file = input.files?.[0]; if (file) take(file); });
            input.click();
        };

        const unsupported = blob && (!blob.type.startsWith("audio/ogg") || (blob.type.includes("codecs") && !blob.type.includes("opus")));

        return h("div", { style: { padding: "16px", color: "var(--text-default, #dbdee1)" } },
            h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: "0 0 12px" } }, "Record Voice Message"),
            h("div", { className: "ac-vmsg-buttons" },
                h("button", { type: "button", onClick: toggle }, `${recording ? "Stop" : "Start"} recording`),
                h("button", {
                    type: "button", disabled: !recording,
                    onClick: () => { if (paused) recorder?.resume(); else recorder?.pause(); setPaused(!paused); }
                }, `${paused ? "Resume" : "Pause"} recording`),
                h("button", { type: "button", onClick: pick }, "Upload File")),
            problem ? h("div", { className: "ac-vmsg-error" }, problem) : null,
            h("div", null, "Preview"),
            recording
                ? h("div", { className: "ac-vmsg-preview" }, h("div", { className: "ac-vmsg-indicator" }), paused ? "PAUSED" : "RECORDING")
                : url ? h("audio", { key: url, src: url, controls: true, style: { width: "100%" } }) : h("div", { className: "ac-vmsg-preview" }, "----"),
            unsupported ? h("div", { style: { marginTop: "12px" } }, `Voice Messages have to be OggOpus to be playable on iOS. This file is ${blob.type} so it will not be playable on iOS.`) : null,
            h("div", { className: "ac-vmsg-actions" },
                h("button", { type: "button", onClick: onClose }, "Cancel"),
                h("button", {
                    type: "button", disabled: !blob || recording,
                    onClick: () => {
                        sendAudio(blob!, meta);
                        onClose();
                        ctx.toasts.show("Now sending voice message... Please be patient", "info");
                    }
                }, "Send")));
    }
    ctx.modals.open(props => h(Root, { size: "small", onClose: props.onClose, label: "Record Voice Message" }, h(Content, null, h(Body, { onClose: props.onClose })), Close ? h(Close, { onClick: props.onClose }) : null));
}

const plugin: PluginCode = {
    settings,

    start(ctx) {
        context = ctx;
        if (!styled) {
            styled = true;
            ctx.addStyle(CSS, "voice-messages");
        }
        selectedChannel = ctx.common.SelectedChannelStore;
        permissions = ctx.common.PermissionStore;
        dispatcher = ctx.common.FluxDispatcher;
        pendingReplies = ctx.finders.byStore("PendingReplyStore");
        mediaEngine = ctx.finders.byStore("MediaEngineStore");
        messageActions = ctx.finders.byProps("getSendMessageOptionsForReply", "sendMessage");
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        snowflakes = ctx.finders.byProps("fromTimestamp", "extractTimestamp");
        uploader = ctx.finders.byCode("uploadFileToCloud");

        const added = ctx.commands.add({
            name: "voice-message",
            description: "Record and send a voice message.",
            input: "builtin",
            execute: () => { openWindow(ctx); }
        });
        if (!added) throw new Error("the command /voice-message could not be added (the name is taken or the commands API refused it)");

        ctx.contextMenu.addNative("channel-attach", (children, props: any) => {
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!parts || !react) return;
            // In a server the person needs the permissions to send voice messages and messages (bits 46 and 11).
            if (props?.channel?.guild_id) {
                const can = (bit: number) => permissions?.get()?.can?.(BigInt(1) << BigInt(bit), props.channel);
                if (!(can(46) && can(11))) return;
            }
            children.push(react.createElement(parts.MenuItem as never, { id: "ac-send-vmsg", key: "ac-send-vmsg", label: "Send Voice Message", action: () => { openWindow(ctx); } }));
        });
    },

    stop() {
        context = selectedChannel = pendingReplies = messageActions = permissions = mediaEngine = rest = snowflakes = uploader = dispatcher = undefined;
        styled = false;
    }
};

export default plugin;
