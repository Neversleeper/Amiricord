/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UniversalVolume (author SirPhantom89) as found in TestCord's plugins (commit af92dba). Same
// behaviour, written against Amiricord's engine: Discord's voice objects come from the plugin's own finders and the voice events go through
// the engine's `flux`. Differences, none tried in a real Discord yet:
//  - the volume is a whole number from 0 to 200 (the original had a slider with markers from 0 to 200, which Amiricord's settings do not have yet);
//  - the plugin waits for Discord's objects instead of assuming they are loaded, and if they never show up the start fails and is reported;
//  - the list of people already set is cleared when the plugin stops, and a late event after a stop does nothing;
//  - an error from Discord's volume function is reported against the plugin instead of written to the console.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    targetVolume: { type: "number", default: 100, min: 0, max: 200, integer: true, description: "The volume everyone in your voice channel is set to (0 to 200)." }
});

interface VoiceVolume {
    setLocalVolume(userId: string, volume: number): void;
}

interface VoiceStates {
    getVoiceStatesForChannel(channelId: string): Record<string, { userId: string; }> | null | undefined;
}

interface Tools {
    ctx: EnginePluginContext;
    volume: VoiceVolume;
    voiceStates: VoiceStates;
    selectedChannel: { getVoiceChannelId(): string | null | undefined; };
    users: { getCurrentUser(): { id: string; } | null | undefined; };
}

let tools: Tools | undefined;
/** Changes at every stop, so a start that was still waiting for Discord knows it must not apply anything. */
let generation = 0;
let currentChannel: string | null = null;
const leveled = new Set<string>();

/** Set one person's local volume. Never throws: a failure is reported and the plugin goes on with the next person. */
function applyToUser(t: Tools, userId: string): void {
    try {
        t.volume.setLocalVolume(userId, settings.store.targetVolume);
    } catch (error) {
        t.ctx.reportError("setLocalVolume", error);
    }
}

/** Put everyone in the voice channel you are in at the chosen volume, once each. Leaving or changing channel starts the list again. */
export function levelChannel(): void {
    const t = tools;
    if (!t) return;
    const channelId = t.selectedChannel.getVoiceChannelId() ?? null;
    if (channelId !== currentChannel) {
        leveled.clear();
        currentChannel = channelId;
    }
    if (!channelId) return;

    const states = t.voiceStates.getVoiceStatesForChannel(channelId);
    if (!states) return;

    const meId = t.users.getCurrentUser()?.id;
    for (const userId of Object.keys(states)) {
        if (userId === meId || leveled.has(userId)) continue;
        applyToUser(t, userId);
        leveled.add(userId);
    }
}

function relevelAll(): void {
    leveled.clear();
    levelChannel();
}

const plugin: PluginCode = {
    settings,

    flux: {
        VOICE_STATE_UPDATES() {
            levelChannel();
        }
    },

    async start(ctx) {
        const mine = ++generation;
        const [volume, voiceStates, selectedChannel, users] = await Promise.all([
            ctx.finders.byProps<VoiceVolume>("setLocalVolume", "toggleLocalMute").ready(),
            ctx.common.VoiceStateStore.ready() as Promise<unknown> as Promise<VoiceStates>,
            ctx.common.SelectedChannelStore.ready(),
            ctx.common.UserStore.ready()
        ]);
        if (mine !== generation) return;
        tools = { ctx, volume, voiceStates, selectedChannel, users };
        ctx.onDispose(settings.onChange("targetVolume", relevelAll));
        levelChannel();
    },

    stop() {
        generation++;
        tools = undefined;
        leveled.clear();
        currentChannel = null;
    }
};

export default plugin;
