/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceRejoin (authors omaw and keircn) as found in TestCord's copy of Equicord's plugins.
// Written against Amiricord's engine; Tried in a real Discord (Stable): it rejoined after Discord was closed and reopened. With the default settings it does not rejoin when nobody else is in the channel or when more than 30 seconds passed (the original's behaviour). Differences from the original:
//  - the last channel and the "was in a call" flag are kept with the plugin's own storage (`ctx.storage`) instead of Vencord's DataStore;
//  - the two sliders are plain whole-number settings (the delay 1 to 10 seconds, the timeout 5 to 120 seconds; the original stepped by 1 and 5);
//  - the stores are found through the plugin's own finders and the plugin waits for them, so a missing one is reported instead of skipped;
//  - a rejoin that was still waiting when the plugin stops is cancelled.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const LAST_KEY = "lastVoiceChannel";
const SESSION_KEY = "inCall";
/** How many times, 250 ms apart, the plugin looks for the channel after Discord connects (its data may arrive a moment later). */
const CHANNEL_LOOKS = 20;

const settings = definePluginSettings({
    rejoinDelay: { type: "number", default: 2, min: 1, max: 10, integer: true, description: "Seconds to wait before rejoining the voice channel." },
    rejoinTimeout: { type: "number", default: 30, min: 5, max: 120, integer: true, description: "Do not try to rejoin when more than this many seconds have passed since you left." },
    preventReconnectIfCallEnded: {
        type: "select", default: "both", description: "Do not reconnect if the call has ended or the voice channel is empty or does not exist.",
        options: [
            { label: "None", value: "none" },
            { label: "DMs only", value: "dms" },
            { label: "DMs and Servers", value: "both" },
            { label: "Servers only", value: "servers" }
        ]
    },
    applyOnlyToDms: { type: "boolean", default: false, description: "Only apply to DMs." }
});

interface VoiceState { userId: string; channelId?: string | null; guildId?: string | null; }

interface ChannelLike {
    id: string;
    isDM(): boolean;
    isGroupDM(): boolean;
    isMultiUserDM(): boolean;
}

interface Saved { guildId: string | null; channelId: string; timestamp: number; }

interface Running {
    ctx: EnginePluginContext;
    userStore: { getCurrentUser(): { id: string; } | undefined; };
    channelStore: { getChannel(id: string): ChannelLike | undefined; };
    voiceStore: { getVoiceStateForUser(id: string): VoiceState | undefined; getVoiceStatesForChannel(id: string): Record<string, VoiceState>; };
    dispatcher: { dispatch(event: { type: string; [key: string]: unknown; }): void; };
    timer?: ReturnType<typeof setTimeout>;
}

let running: Running | undefined;
let generation = 0;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const isSaved = (value: unknown): value is Saved => typeof value === "object" && value !== null && typeof (value as Saved).channelId === "string";

async function rejoin(state: Running, mine: number): Promise<void> {
    const { ctx } = state;
    const alive = () => mine === generation && running === state;
    const stopHere = () => ctx.storage.set(SESSION_KEY, false);
    const saved = await ctx.storage.get(LAST_KEY);
    if (!isSaved(saved) || !alive()) return;

    let channel = state.channelStore.getChannel(saved.channelId);
    for (let i = 0; i < CHANNEL_LOOKS && !channel; i++) {
        await sleep(250);
        if (!alive()) return;
        channel = state.channelStore.getChannel(saved.channelId);
    }
    if (!channel) return stopHere();

    const me = state.userStore.getCurrentUser();
    if (!me) return;
    const isDM = channel.isDM() || channel.isGroupDM() || channel.isMultiUserDM();
    const mode = settings.store.preventReconnectIfCallEnded;

    if (saved.timestamp && Date.now() - saved.timestamp > settings.store.rejoinTimeout * 1000) return stopHere();
    if (settings.store.applyOnlyToDms && !isDM) return stopHere();
    if (mode === "both" || (mode === "dms" && isDM) || (mode === "servers" && !isDM)) {
        const others = Object.values(state.voiceStore.getVoiceStatesForChannel(saved.channelId) ?? {}).filter(voice => voice.userId !== me.id);
        if (others.length === 0) return stopHere();
    }
    if (state.voiceStore.getVoiceStateForUser(me.id)?.channelId) return stopHere();

    state.dispatcher.dispatch({ type: "VOICE_CHANNEL_SELECT", guildId: saved.guildId, channelId: saved.channelId });
    await ctx.storage.set(SESSION_KEY, true);
}

const plugin: PluginCode = {
    settings,

    async start(ctx) {
        const mine = ++generation;
        const [userStore, channelStore, voiceStore, dispatcher] = await Promise.all([
            ctx.finders.byStore<Running["userStore"]>("UserStore").ready(),
            ctx.finders.byStore<Running["channelStore"]>("ChannelStore").ready(),
            ctx.finders.byStore<Running["voiceStore"]>("VoiceStateStore").ready(),
            ctx.finders.byProps<Running["dispatcher"]>("dispatch", "subscribe").ready()
        ]);
        if (mine !== generation) return;
        running = { ctx, userStore, channelStore, voiceStore, dispatcher };
    },

    stop() {
        generation++;
        if (running?.timer !== undefined) clearTimeout(running.timer);
        running = undefined;
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const state = running;
            const me = state?.userStore.getCurrentUser();
            if (!state || !me) return;
            const mine = voiceStates.find(voice => voice.userId === me.id);
            if (!mine) return;
            if (mine.channelId) {
                const saved: Saved = { guildId: mine.guildId ?? null, channelId: mine.channelId, timestamp: Date.now() };
                void Promise.all([state.ctx.storage.set(LAST_KEY, { ...saved }), state.ctx.storage.set(SESSION_KEY, true)])
                    .catch(error => state.ctx.reportError("VoiceRejoin", error));
            } else {
                void state.ctx.storage.set(SESSION_KEY, false).catch(error => state.ctx.reportError("VoiceRejoin", error));
            }
        },

        async CONNECTION_OPEN() {
            const state = running;
            if (!state) return;
            const mine = generation;
            if ((await state.ctx.storage.get(SESSION_KEY)) === false) {
                await state.ctx.storage.delete(LAST_KEY);
                return;
            }
            if (state.timer !== undefined) clearTimeout(state.timer);
            state.timer = setTimeout(() => {
                rejoin(state, mine).catch(error => state.ctx.reportError("VoiceRejoin", error));
            }, settings.store.rejoinDelay * 1000);
        }
    }
};

export default plugin;
