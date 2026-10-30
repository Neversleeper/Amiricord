/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WebcamStartNotifier (author x2b) as found in TestCord. The original downloads two sound files from GitHub; here the sounds are made on the spot (a rising beep for on, a falling one for off), so nothing is downloaded. Like the original, it only reacts to changes seen while you are in the call, and it can be limited to direct-message calls or to server channels.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    playInPrivate: { type: "boolean", default: true, description: "Play the sound in calls of direct messages and group chats" },
    playInServer: { type: "boolean", default: true, description: "Play the sound in the voice channels of servers" }
});

interface VoiceStateUpdate { userId: string; channelId?: string | null; selfVideo?: boolean; }

/** The people whose camera changed: the camera state is remembered per person, and a change is reported only after a first sighting. Anyone no longer in `channelId` is forgotten. */
export function cameraChanges(seen: Map<string, boolean>, channelId: string, states: VoiceStateUpdate[]): boolean[] {
    const changes: boolean[] = [];
    for (const state of states) {
        if (state.channelId !== channelId) { seen.delete(state.userId); continue; }
        const before = seen.get(state.userId);
        if (state.selfVideo !== undefined && before !== undefined && before !== state.selfVideo) changes.push(state.selfVideo);
        seen.set(state.userId, state.selfVideo ?? false);
    }
    return changes;
}

const seen = new Map<string, boolean>();
let audio: AudioContext | undefined;

function beep(rising: boolean): void {
    try {
        audio ??= new AudioContext();
        const now = audio.currentTime;
        for (const [index, frequency] of (rising ? [660, 880] : [880, 660]).entries()) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0.08, now + index * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.11);
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(now + index * 0.12);
            oscillator.stop(now + index * 0.12 + 0.12);
        }
    } catch { /* no sound available */ }
}

const plugin: PluginCode & { onVoice?: (states: VoiceStateUpdate[]) => void; } = {
    settings,
    start(ctx) {
        const selected = ctx.common.SelectedChannelStore;
        const channels = ctx.common.ChannelStore;
        plugin.onVoice = states => {
            const current = (selected.get() as unknown as { getVoiceChannelId(): string | null; } | undefined)?.getVoiceChannelId();
            if (!current) return;
            const type = (channels.get()?.getChannel(current) as { type?: number; } | undefined)?.type;
            const isPrivate = type === 1 || type === 3;
            if (isPrivate ? !settings.store.playInPrivate : !settings.store.playInServer) return;
            for (const rising of cameraChanges(seen, current, states)) beep(rising);
        };
    },
    flux: {
        VOICE_STATE_UPDATES(event: { voiceStates?: VoiceStateUpdate[]; }) { plugin.onVoice?.(event.voiceStates ?? []); }
    },
    stop() {
        plugin.onVoice = undefined;
        seen.clear();
        void audio?.close().catch(() => undefined);
        audio = undefined;
    }
};

export default plugin;
