/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BetterUserTools (authors Benjii, x2b and nnenaza, as listed in TestCord). The original had two buttons in the user panel: a mic
// test (already in Amiricord as MicLoopbackTester, so not repeated here) and "Off The Radar", which is this. `/offtheradar` switches it on or off: while it is on your status is
// Idle and Discord does not show the game you are playing; switching it off puts both back to what they were. Differences, NOT verified in a real Discord:
//  - a command instead of a button in the user panel;
//  - the two settings are saved the way Discord's own save does it (a `PATCH /users/@me/settings-proto/1` with the field numbers read in build 653945: status 1 and show current
//    game 3 inside the status settings, field 11), and the page is told as well; the original used Discord's settings helper, which Amiricord does not have. The old
//    `PATCH /users/@me/settings` is not used: it answers OK and changes nothing;
//  - what was set before is kept in this plugin's storage, so it also comes back after a restart. If Discord was closed while it was on, it stays on until you switch it off.

import type { PluginCode } from "../../renderer/engine";

const KEY = "state";
const STATUSES = ["online", "idle", "dnd", "invisible"];

export interface RadarState { enabled: boolean; prevStatus?: string; prevShow?: boolean; }

const utf8 = (text: string) => new TextEncoder().encode(text);

function varint(value: number): number[] {
    const out: number[] = [];
    let rest = value;
    while (rest >= 0x80) { out.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
    out.push(rest);
    return out;
}

const field = (number: number, bytes: ArrayLike<number>) => [(number << 3) | 2, ...varint(bytes.length), ...Array.from(bytes)];

/** The bytes of the settings message with the status (field 1 of the status settings, a string wrapper) and "show current game" (field 3, a bool wrapper), inside field 11. */
export function statusSettingsBytes(status: string, showCurrentGame: boolean): number[] {
    return field(11, [...field(1, field(1, utf8(status))), ...field(3, [0x08, showCurrentGame ? 1 : 0])]);
}

/** The same bytes as base64, what the request carries. */
export const statusSettings = (status: string, showCurrentGame: boolean): string => btoa(String.fromCharCode(...statusSettingsBytes(status, showCurrentGame)));

/** The state read back from storage; anything that is not plain is "off". */
export function readState(value: unknown): RadarState {
    if (typeof value !== "object" || value === null) return { enabled: false };
    const raw = value as Partial<RadarState>;
    return {
        enabled: raw.enabled === true,
        prevStatus: typeof raw.prevStatus === "string" && STATUSES.includes(raw.prevStatus) ? raw.prevStatus : undefined,
        prevShow: typeof raw.prevShow === "boolean" ? raw.prevShow : undefined
    };
}

interface Rest { patch(request: { url: string; body: unknown; rejectWithError?: boolean; }): Promise<unknown>; }
interface Dispatcher { dispatch(action: unknown): void; }
interface ProtoStore { settings?: { status?: { status?: { value?: string; }; showCurrentGame?: { value?: boolean; }; }; }; }

let generation = 0;

const plugin: PluginCode = {
    start(ctx) {
        const mine = ++generation;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const store = ctx.finders.byStore<ProtoStore>("UserSettingsProtoStore");
        const dispatcher = ctx.finders.byProps<Dispatcher>("dispatch", "subscribe");
        let busy = false;

        const set = async (status: string, show: boolean) => {
            const api = rest.get();
            const flux = await dispatcher.ready();
            if (!api) throw new Error("Discord's request function was not found.");
            flux.dispatch({ type: "USER_SETTINGS_PROTO_UPDATE", settings: { type: 1, proto: { status: { status: { value: status }, showCurrentGame: { value: show } } } }, partial: true, local: true });
            await api.patch({ url: "/users/@me/settings-proto/1", body: { settings: statusSettings(status, show) }, rejectWithError: true });
        };

        const toggle = async () => {
            if (busy) return;
            busy = true;
            try {
                const state = readState(await ctx.storage.get(KEY));
                if (state.enabled) {
                    await set(state.prevStatus ?? "online", state.prevShow ?? true);
                    await ctx.storage.set(KEY, { enabled: false });
                    if (mine === generation) ctx.toasts.show("Off the radar: off. Your status and activity are back.", "success");
                } else {
                    const current = store.get()?.settings?.status;
                    const prevStatus = current?.status?.value;
                    const next: RadarState = { enabled: true, prevStatus: prevStatus && STATUSES.includes(prevStatus) ? prevStatus : "online", prevShow: current?.showCurrentGame?.value ?? true };
                    // Saved first: if Discord refuses, the next switch still knows what to put back.
                    await ctx.storage.set(KEY, next as never);
                    await set("idle", false);
                    if (mine === generation) ctx.toasts.show("Off the radar: on. You are Idle and your game is hidden.", "success");
                }
            } catch (error) {
                ctx.reportError("BetterUserTools", error);
                ctx.toasts.show("Off the radar could not change your settings.", "failure");
            } finally {
                busy = false;
            }
        };

        ctx.commands.add({
            name: "offtheradar",
            description: "Switch Off The Radar on or off: Idle status and no game shown, then back to what you had",
            execute() { void toggle(); }
        });
    },

    stop() {
        generation++;
    }
};

export default plugin;
