/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FakeMuteDeafen (authors x2b, dot, sirphantom89 and hyyven) as found in TestCord. Same idea: the function that sends Discord's voice state to its server (gateway opcode 4) is wrapped so that, while a fake is on, the others are told you are muted, deafened or on camera; your real microphone and speakers are not touched. The voice state is sent again at once when you toggle, and the wrap is taken off when the plugin stops. The user panel button follows AntiMoveDeco's. Differences from the original: the slash commands answer with a toast instead of a bot message and the "FakeVoicePremium" check is gone (that plugin is not here). Not tried in a real Discord.

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */
import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { UserAreaButtonProps } from "../../api/userArea";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    userAreaButton: { type: "boolean", default: true, description: "Show a button in the user panel (next to the microphone and headphones)" },
    contextMenu: { type: "boolean", default: true, description: "Show the options in the right click menu of the microphone, headphones and camera" },
    slashCommands: { type: "boolean", default: false, description: "Let the slash commands /fakemute, /fakedeafen and /fakedeafen_mute work" },
    combinedContextItem: { type: "boolean", default: false, description: "Also show one Fake Mute & Deafen entry in the audio device menu" },
    autoMute: { type: "boolean", default: true, description: "Fake deafen also fakes mute" },
    showOnMyScreen: { type: "boolean", default: true, description: "Also show the fake on your own screen (the microphone and headphones in the user panel and your row in the voice list go red). Only what Discord shows you changes; your real microphone and speakers are not touched" },
    muteKeybind: { type: "string", default: "ctrl+j", description: "Key shortcut for fake mute only (modifier+key, for example ctrl+j)" },
    deafenKeybind: { type: "string", default: "ctrl+l", description: "Key shortcut for fake deafen and fake mute (modifier+key, for example ctrl+l)" }
});

const REFRESH_DELAY_MS = 500;
// A little longer than the line across the icon (about 38), so that when it is hidden no stub of it is left.
const LENGTH = 40;

const fake = { mute: false, deaf: false, video: false };

type Lazy = { get(): any; } | undefined;
let gateway: Lazy;
let selectedChannel: Lazy;
let channels: Lazy;
let mediaEngine: Lazy;
let panelButton: Lazy;
let toast: ((message: string, kind?: "info" | "success" | "failure") => void) | undefined;
let redraw: (() => void) | undefined;
const wrappedSockets: Array<{ socket: any; original: (...args: any[]) => unknown; }> = [];
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let removeKeys: (() => void) | undefined;

/** Whether mute is shown as on: with "autoMute", a fake deafen also fakes mute. */
export function shownMute(state: { mute: boolean; deaf: boolean; }, autoMute: boolean): boolean {
    return autoMute ? state.deaf || state.mute : state.mute;
}

/** The voice state the others are told: a fake wins over the real value, never the other way. */
export function forcedVoiceState(data: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean; }, state: { mute: boolean; deaf: boolean; video: boolean; }, autoMute: boolean): void {
    if (shownMute(state, autoMute)) data.self_mute = true;
    if (state.deaf) data.self_deaf = true;
    if (state.video) data.self_video = true;
}

/** "ctrl+j" into its parts. */
export function parseKeybind(text: string): { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string; } {
    const out = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
    for (const part of text.toLowerCase().split("+")) {
        if (part === "ctrl") out.ctrl = true;
        else if (part === "alt") out.alt = true;
        else if (part === "shift") out.shift = true;
        else if (part === "meta" || part === "cmd") out.meta = true;
        else out.key = part;
    }
    return out;
}

export function matchesKeybind(event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; key: string; }, text: string): boolean {
    const wanted = parseKeybind(text);
    return wanted.key !== "" && event.ctrlKey === wanted.ctrl && event.altKey === wanted.alt && event.shiftKey === wanted.shift && event.metaKey === wanted.meta && event.key.toLowerCase() === wanted.key;
}

const UI_MUTE = ["isSelfMute", "isMute"];
const UI_DEAF = ["isSelfDeaf", "isDeaf"];
const originals = new Map<string, { own: boolean; fn: (...args: any[]) => unknown; }>();
let patchedEngine: any;

/** What Discord's audio store says for real (the plugin's own reads go through here, never through the answers it changes for the screen). */
function readReal(engine: any, name: string): unknown {
    const original = originals.get(name);
    return original ? original.fn.call(engine) : engine?.[name]?.();
}

/** Your own panel and rows are drawn from the audio store's answers, so while a fake is on those answers say yes. The audio itself is set when you press a button, not by these answers. */
function ensureLocalView(): void {
    if (!settings.store.showOnMyScreen) { removeLocalView(); return; }
    if (patchedEngine) return;
    const engine = mediaEngine?.get();
    if (!engine) return;
    for (const name of [...UI_MUTE, ...UI_DEAF]) {
        const original = engine[name];
        if (typeof original !== "function") continue;
        originals.set(name, { own: Object.prototype.hasOwnProperty.call(engine, name), fn: original });
        const isMute = UI_MUTE.includes(name);
        engine[name] = function (this: unknown, ...args: unknown[]) {
            const real = Boolean(original.apply(this, args));
            return isMute ? shownMute(fake, settings.store.autoMute) || real : fake.deaf || real;
        };
    }
    patchedEngine = engine;
}

function removeLocalView(): void {
    const engine = patchedEngine;
    if (!engine) return;
    for (const [name, original] of originals) {
        if (original.own) engine[name] = original.fn;
        else delete engine[name];
    }
    originals.clear();
    patchedEngine = undefined;
    engine.emitChange?.();
}

/** Tell the server the voice state now, so the others see the change without waiting for Discord to send it. */
/** Wrap the send of the gateway socket that is live now, if it is not wrapped yet. Discord makes a new socket when it reconnects, so this runs again at every join and every new connection. */
function ensureSocketWrap(): void {
    try {
        const socket = gateway?.get()?.getSocket?.();
        if (!socket || typeof socket.send !== "function" || socket.send.amiricordFake) return;
        const original = socket.send as (...args: any[]) => unknown;
        const wrapper = function (this: unknown, op: number, data: any, ...rest: unknown[]) {
            if (op === 4 && data) forcedVoiceState(data, fake, settings.store.autoMute);
            return original.call(this, op, data, ...rest);
        };
        (wrapper as unknown as { amiricordFake: boolean; }).amiricordFake = true;
        socket.send = wrapper;
        wrappedSockets.push({ socket, original });
        if (wrappedSockets.length > 5) wrappedSockets.shift();
    } catch { /* the gateway is not up yet; the next join or connection tries again */ }
}

function restoreSockets(): void {
    for (const { socket, original } of wrappedSockets) {
        if (socket.send?.amiricordFake) socket.send = original;
    }
    wrappedSockets.length = 0;
}

function refreshVoiceState(): void {
    ensureSocketWrap();
    ensureLocalView();
    redraw?.();
    (patchedEngine as { emitChange?(): void; } | undefined)?.emitChange?.();
    try {
        const socket = gateway?.get()?.getSocket?.();
        const channelId = selectedChannel?.get()?.getVoiceChannelId?.();
        if (!socket || !channelId) return;
        const channel = channels?.get()?.getChannel?.(channelId);
        const engine = mediaEngine?.get();
        socket.send(4, {
            guild_id: channel?.guild_id ?? null,
            channel_id: channelId,
            self_mute: shownMute(fake, settings.store.autoMute) || Boolean(readReal(engine, "isMute")),
            self_deaf: fake.deaf || Boolean(readReal(engine, "isDeaf")),
            self_video: fake.video,
            flags: 0
        });
    } catch { /* not in a voice channel, or the gateway is not ready */ }
}

// The fakes are kept on this computer, so they stay on when Discord restarts (for example with Voice Rejoin) until you turn them off.
const STATE_KEY = "fake-state";
let saveState: ((state: { mute: boolean; deaf: boolean; video: boolean; }) => void) | undefined;

function changed(): void {
    saveState?.({ ...fake });
    refreshVoiceState();
}

function toggleMute(): void {
    fake.mute = !fake.mute;
    changed();
}

function toggleDeafen(): void {
    fake.deaf = !fake.deaf;
    if (settings.store.autoMute) fake.mute = fake.deaf;
    changed();
}

function toggleBoth(): void {
    const next = !(fake.mute && fake.deaf);
    fake.mute = next;
    fake.deaf = next;
    changed();
}

function toggleVideo(): void {
    fake.video = !fake.video;
    changed();
}

function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.contentEditable === "true")) return;
    if (matchesKeybind(event, settings.store.muteKeybind)) {
        event.preventDefault();
        toggleMute();
        toast?.(`Fake mute is now ${fake.mute ? "on" : "off"}`, fake.mute ? "success" : "info");
    } else if (matchesKeybind(event, settings.store.deafenKeybind)) {
        event.preventDefault();
        toggleDeafen();
        toast?.(`Fake deafen is now ${fake.deaf ? "on" : "off"}${fake.deaf && settings.store.autoMute ? " (and fake mute)" : ""}`, fake.deaf ? "success" : "info");
    }
}

function FakeDeafenIcon({ className = "" }: { className?: string; }) {
    const h = (currentReact() as any).createElement;
    const enabled = fake.deaf;
    // Red with a line across when the fake is on (like Discord's own deafen button), plain when it is off. The original draws it the other way round.
    const lineStyle = { strokeDasharray: LENGTH, strokeDashoffset: enabled ? 0 : LENGTH, transition: "stroke-dashoffset 0.1s ease-in-out" };
    const paint = enabled ? "var(--status-danger)" : "currentColor";
    return h("svg", { className, width: 28, height: 28, viewBox: "0 0 32 32", fill: "none" },
        h("mask", { id: "amiricordFakeMuteDeafenLine" },
            h("rect", { width: "100%", height: "100%", fill: "#ffffff" }),
            h("line", { x1: 29, y1: 2, x2: 2, y2: 29, stroke: "#000000", strokeWidth: 8, strokeLinecap: "round", style: lineStyle })),
        h("g", { mask: "url(#amiricordFakeMuteDeafenLine)" },
            h("rect", { x: 6, y: 8, width: 20, height: 4, rx: 2, fill: paint }),
            h("rect", { x: 11, y: 3, width: 10, height: 8, rx: 3, fill: paint }),
            h("circle", { cx: 10, cy: 21, r: 4, stroke: paint, strokeWidth: 2, fill: "none" }),
            h("circle", { cx: 22, cy: 21, r: 4, stroke: paint, strokeWidth: 2, fill: "none" }),
            h("path", { d: "M14 21c1 1 3 1 4 0", stroke: paint, strokeWidth: 2, strokeLinecap: "round" })),
        h("line", { x1: 29, y1: 2, x2: 2, y2: 29, stroke: "var(--status-danger, currentColor)", strokeWidth: 2, strokeLinecap: "round", style: lineStyle }));
}

function FakeMuteDeafenButton({ nameplate, iconForeground }: UserAreaButtonProps) {
    const react = currentReact() as any;
    const [, forceUpdate] = react.useReducer((n: number) => n + 1, 0) as [number, () => void];
    react.useEffect(() => {
        redraw = forceUpdate;
        return () => { if (redraw === forceUpdate) redraw = undefined; };
    }, []);
    const Button = panelButton?.get();
    if (!Button || !settings.store.userAreaButton) return null;
    return react.createElement(Button, {
        tooltipText: fake.deaf ? "Disable Fake Mute & Deafen" : "Enable Fake Mute & Deafen",
        icon: react.createElement(FakeDeafenIcon, { className: iconForeground }),
        role: "switch",
        "aria-checked": fake.deaf,
        redGlow: fake.deaf,
        plated: nameplate !== null && nameplate !== undefined,
        onClick: toggleDeafen
    });
}

function menuEntry(ctx: EnginePluginContext, id: string, label: string, checked: boolean, action: () => void): unknown {
    const parts = ctx.contextMenu.parts();
    const react = ctx.components.react.get() as any;
    if (!parts || !react) return null;
    return react.createElement(parts.MenuGroup as never, { id: `${id}-group`, key: `${id}-group` },
        react.createElement(parts.MenuCheckboxItem as never, { id, label, checked, action }));
}

function addCommand(ctx: EnginePluginContext, name: string, description: string, run: () => string): void {
    ctx.commands.add({
        name,
        description,
        execute() {
            if (!settings.store.slashCommands) { toast?.("Slash commands are off. Turn them on in the settings of Fake Mute Deafen.", "failure"); return undefined; }
            toast?.(run(), "info");
            return undefined;
        }
    });
}

const plugin: PluginCode = {
    settings,
    start(ctx: EnginePluginContext) {
        gateway = ctx.finders.byProps("getSocket");
        selectedChannel = ctx.common.SelectedChannelStore;
        channels = ctx.common.ChannelStore;
        mediaEngine = ctx.finders.byProps("isDeaf", "isMute");
        panelButton = ctx.finders.componentByCode("tooltipPositionKey", "positionKeyStemOverride");
        toast = (message, kind) => ctx.toasts.show(message, kind);

        ensureSocketWrap();
        saveState = state => { ctx.storage.set(STATE_KEY, state as never).catch(error => { ctx.reportError("FakeMuteDeafen", error); }); };
        void ctx.storage.get(STATE_KEY).then(saved => {
            const state = saved as { mute?: unknown; deaf?: unknown; video?: unknown; } | undefined;
            if (!state || typeof state !== "object") return;
            fake.mute = state.mute === true;
            fake.deaf = state.deaf === true;
            fake.video = state.video === true;
            if (fake.mute || fake.deaf || fake.video) refreshVoiceState();
        }).catch(() => undefined);

        ctx.userArea.add(FakeMuteDeafenButton);
        document.addEventListener("keydown", onKeyDown);
        removeKeys = () => document.removeEventListener("keydown", onKeyDown);

        ctx.contextMenu.addNative("audio-device-context", (children, props) => {
            if (!settings.store.contextMenu) return;
            const wanted = props as { renderInputDevices?: boolean; renderOutputDevices?: boolean; } | undefined;
            const add = (entry: unknown) => { if (entry) children.push(entry as never); };
            if (settings.store.combinedContextItem) add(menuEntry(ctx, "fake-mute-deafen-both", "Fake Mute & Deafen", fake.mute && fake.deaf, toggleBoth));
            if (wanted?.renderInputDevices) add(menuEntry(ctx, "fake-mute", "Fake Mute", fake.mute, toggleMute));
            if (wanted?.renderOutputDevices) add(menuEntry(ctx, "fake-deafen", "Fake Deafen", fake.deaf, toggleDeafen));
        });
        ctx.contextMenu.addNative("video-device-context", children => {
            if (!settings.store.contextMenu) return;
            const entry = menuEntry(ctx, "fake-video", "Fake Camera", fake.video, toggleVideo);
            if (entry) children.push(entry as never);
        });

        addCommand(ctx, "fakemute", "Toggle fake mute", () => { toggleMute(); return `Fake mute is now ${fake.mute ? "on" : "off"}`; });
        addCommand(ctx, "fakedeafen", "Toggle fake deafen", () => { toggleDeafen(); return `Fake deafen is now ${fake.deaf ? "on" : "off"}`; });
        addCommand(ctx, "fakedeafen_mute", "Toggle fake deafen and fake mute together", () => { toggleBoth(); return `Fake mute and deafen are now ${fake.mute && fake.deaf ? "on" : "off"}`; });
    },
    stop() {
        saveState = undefined;
        restoreSockets();
        removeKeys?.();
        removeKeys = undefined;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = undefined;
        fake.mute = fake.deaf = fake.video = false;
        removeLocalView();
        gateway = selectedChannel = channels = mediaEngine = panelButton = undefined;
        toast = undefined;
        redraw = undefined;
    },

    flux: {
        // Joining a channel (also when Discord joins it again by itself): Discord sends its own state first, so make sure the new socket is wrapped and send the fake one again a moment later.
        VOICE_CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            ensureSocketWrap();
            ensureLocalView();
            if (!channelId || !(fake.mute || fake.deaf || fake.video)) return;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => { refreshTimer = undefined; refreshVoiceState(); }, REFRESH_DELAY_MS);
        },
        // A new connection to Discord's gateway means a new socket: wrap it, and tell the others about the fake once it is up.
        CONNECTION_OPEN() {
            ensureSocketWrap();
            ensureLocalView();
            if (!(fake.mute || fake.deaf || fake.video)) return;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => { refreshTimer = undefined; refreshVoiceState(); }, REFRESH_DELAY_MS * 2);
        }
    }
};

export default plugin;
