/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AntiMoveDeco (author Nightcord) as found in TestCord. Same rule (when you turn it on, the channel you are in is the one protected; a move or a disconnect brings you back after half a second). The button is added with `ctx.userArea`, drawn like the original's (a phone with a line across when off), in the same way as MicLoopbackTester's. Not tried in a real Discord.

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */
import { currentReact } from "../../api/jsxRuntime";
import type { UserAreaButtonProps } from "../../api/userArea";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const LENGTH = 30;
const RETURN_DELAY_MS = 500;

let enabled = false;
let targetChannelId: string | null = null;
let redraw: (() => void) | undefined;
type Lazy = { get(): any; } | undefined;
let voiceActions: Lazy;
let selectedChannel: Lazy;
let users: Lazy;
let panelButton: Lazy;

/** Whether an update of voice states means this person was moved or disconnected from the protected channel. */
export function wasMoved(voiceStates: Array<{ userId: string; channelId: string | null; }>, myId: string, target: string): boolean {
    const mine = voiceStates.find(state => state.userId === myId);
    return mine !== undefined && mine.channelId !== target;
}

function AntiMoveDecoIcon({ active, className = "" }: { active: boolean; className?: string; }) {
    const h = (currentReact() as any).createElement;
    const lineStyle = { strokeDasharray: LENGTH, strokeDashoffset: active ? LENGTH : 0, transition: "stroke-dashoffset 0.1s ease-in-out" };
    const fill = !active ? "var(--status-danger)" : "currentColor";
    return h("svg", { className, width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
        h("mask", { id: "amiricordAntiMoveDecoLine" },
            h("rect", { width: "100%", height: "100%", fill: "#ffffff" }),
            h("line", { x1: 22, y1: 2, x2: 2, y2: 22, stroke: "#000000", strokeWidth: 6, strokeLinecap: "round", style: lineStyle })),
        h("g", { mask: "url(#amiricordAntiMoveDecoLine)" },
            h("path", { fill, d: "M2 7.4A5.4 5.4 0 0 1 7.4 2c.36 0 .7.22.83.55l1.93 4.64a1 1 0 0 1-.43 1.25L7 10a8.52 8.52 0 0 0 7 7l1.12-2.24a1 1 0 0 1 1.19-.51l5.06 1.56c.38.11.63.46.63.85C22 19.6 19.6 22 16.66 22h-.37C8.39 22 2 15.6 2 7.71V7.4ZM13 3a1 1 0 0 1 1-1 8 8 0 0 1 8 8 1 1 0 1 1-2 0 6 6 0 0 0-6-6 1 1 0 0 1-1-1Z" }),
            h("path", { fill, d: "M13 7a1 1 0 0 1 1-1 4 4 0 0 1 4 4 1 1 0 1 1-2 0 2 2 0 0 0-2-2 1 1 0 0 1-1-1Z" })),
        h("line", { x1: 22, y1: 2, x2: 2, y2: 22, stroke: "var(--status-danger, currentColor)", strokeWidth: 2, strokeLinecap: "round", style: lineStyle }));
}

function AntiMoveDecoButton({ nameplate, iconForeground }: UserAreaButtonProps) {
    const react = currentReact() as any;
    const [, forceUpdate] = react.useReducer((n: number) => n + 1, 0) as [number, () => void];
    react.useEffect(() => {
        redraw = forceUpdate;
        return () => { if (redraw === forceUpdate) redraw = undefined; };
    }, []);
    const Button = panelButton?.get();
    if (!Button) return null;
    return react.createElement(Button, {
        tooltipText: enabled ? "Anti Move/Disconnect: on" : "Anti Move/Disconnect: off",
        icon: react.createElement(AntiMoveDecoIcon, { active: enabled, className: iconForeground }),
        role: "switch",
        "aria-checked": enabled,
        redGlow: !enabled,
        plated: nameplate !== null && nameplate !== undefined,
        onClick: () => {
            if (enabled) {
                enabled = false;
                targetChannelId = null;
            } else {
                const current = selectedChannel?.get()?.getVoiceChannelId?.();
                if (!current) return;
                enabled = true;
                targetChannelId = current;
            }
            redraw?.();
        }
    });
}

const plugin: PluginCode = {
    start(ctx: EnginePluginContext) {
        voiceActions = ctx.finders.byProps("selectVoiceChannel", "disconnect");
        selectedChannel = ctx.common.SelectedChannelStore;
        users = ctx.common.UserStore;
        panelButton = ctx.finders.componentByCode("tooltipPositionKey", "positionKeyStemOverride");
        ctx.userArea.add(AntiMoveDecoButton);
    },
    stop() {
        enabled = false;
        targetChannelId = null;
        voiceActions = selectedChannel = users = panelButton = undefined;
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: Array<{ userId: string; channelId: string | null; }>; }) {
            const me = users?.get()?.getCurrentUser?.()?.id;
            if (!enabled || !targetChannelId || !me || !wasMoved(voiceStates, me, targetChannelId)) return;
            // A short wait lets Discord finish its own disconnect before joining again
            setTimeout(() => {
                if (enabled && targetChannelId) {
                    try { voiceActions?.get()?.selectVoiceChannel?.(targetChannelId); } catch { /* the channel may be gone */ }
                }
            }, RETURN_DELAY_MS);
        }
    }
};

export default plugin;
