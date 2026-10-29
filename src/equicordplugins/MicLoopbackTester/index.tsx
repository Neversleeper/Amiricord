/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin MicLoopbackTester (author benjii) of Equicord. Differences from the original:
//  - the button is added with Amiricord's `ctx.userArea` (the original used Vencord's UserArea API);
//  - Discord's panel button is found by its text (`tooltipPositionKey`, `positionKeyStemOverride`), and the two voice actions by their names (`setLoopback`, `toggleSelfDeaf`);
//    all of them were read in Discord's web build 653945 (the mic test screen calls the same two functions the same way: `setLoopback("mic_test", true)`, and deafens first
//    when you are in a call). Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import type { UserAreaButtonProps } from "../../api/userArea";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const LENGTH = 30;

let loopbackActive = false;
let selfDeafenedByPlugin = false;
// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
type Lazy = { get(): any; } | undefined;
let voiceActions: Lazy;
let mediaEngine: Lazy;
let voiceStates: Lazy;
let users: Lazy;
let panelButton: Lazy;
let redraw: (() => void) | undefined;

function isInVoiceChannel(): boolean {
    const id = users?.get()?.getCurrentUser?.()?.id;
    return Boolean(id && voiceStates?.get()?.getVoiceStateForUser?.(id)?.channelId);
}

async function enableLoopback(): Promise<boolean> {
    try {
        await voiceActions?.get()?.setLoopback("mic_test", true);
        loopbackActive = true;
        if (isInVoiceChannel() && !mediaEngine?.get()?.isSelfDeaf?.()) {
            await voiceActions?.get()?.toggleSelfDeaf();
            selfDeafenedByPlugin = true;
        } else {
            selfDeafenedByPlugin = false;
        }
        return true;
    } catch {
        return false;
    }
}

async function disableLoopback(): Promise<void> {
    try {
        await voiceActions?.get()?.setLoopback("mic_test", false);
        loopbackActive = false;
        if (selfDeafenedByPlugin && mediaEngine?.get()?.isSelfDeaf?.()) await voiceActions?.get()?.toggleSelfDeaf();
        selfDeafenedByPlugin = false;
    } catch { /* the call may be gone; there is nothing more to undo */ }
}

function MicLoopbackIcon({ active = false, className = "" }: { active?: boolean; className?: string; }) {
    const h = (currentReact() as any).createElement;
    const lineStyle = { strokeDasharray: LENGTH, strokeDashoffset: active ? LENGTH : 0, transition: "stroke-dashoffset 0.1s ease-in-out" };
    const fill = !active ? "var(--status-danger)" : "currentColor";
    return h("svg", { className, width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
        h("mask", { id: "amiricordMicLoopbackLine" },
            h("rect", { width: "100%", height: "100%", fill: "#ffffff" }),
            h("line", { x1: 22, y1: 2, x2: 2, y2: 22, stroke: "#000000", strokeWidth: 6, strokeLinecap: "round", style: lineStyle })),
        h("g", { mask: "url(#amiricordMicLoopbackLine)" },
            h("path", { fill, fillRule: "evenodd", clipRule: "evenodd", d: "M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z" }),
            h("path", { fill, fillRule: "evenodd", clipRule: "evenodd", d: "M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z" })),
        h("line", { x1: 22, y1: 2, x2: 2, y2: 22, stroke: "var(--status-danger, currentColor)", strokeWidth: 2, strokeLinecap: "round", style: lineStyle }));
}

function MicLoopbackButton({ nameplate, iconForeground }: UserAreaButtonProps) {
    const react = currentReact() as any;
    const [, forceUpdate] = react.useReducer((n: number) => n + 1, 0) as [number, () => void];
    react.useEffect(() => {
        redraw = forceUpdate;
        return () => { if (redraw === forceUpdate) redraw = undefined; };
    }, []);
    const toggle = react.useCallback(async () => {
        if (loopbackActive) await disableLoopback();
        else await enableLoopback();
        forceUpdate();
    }, []);
    const Button = panelButton?.get();
    if (!Button) return null;
    return react.createElement(Button, {
        tooltipText: "Mic Test Loopback",
        icon: react.createElement(MicLoopbackIcon, { active: loopbackActive, className: iconForeground }),
        role: "switch",
        "aria-checked": !loopbackActive,
        redGlow: !loopbackActive,
        plated: nameplate !== null && nameplate !== undefined,
        onClick: toggle
    });
}

const plugin: PluginCode = {
    start(ctx: EnginePluginContext) {
        voiceActions = ctx.finders.byProps("setLoopback", "toggleSelfDeaf");
        mediaEngine = ctx.finders.byStore("MediaEngineStore");
        voiceStates = ctx.common.VoiceStateStore;
        users = ctx.common.UserStore;
        panelButton = ctx.finders.componentByCode("tooltipPositionKey", "positionKeyStemOverride");
        ctx.userArea.add(MicLoopbackButton);
    },

    stop() {
        void disableLoopback();
        loopbackActive = false;
        selfDeafenedByPlugin = false;
        redraw = undefined;
        voiceActions = mediaEngine = voiceStates = users = panelButton = undefined;
    }
};

export default plugin;
