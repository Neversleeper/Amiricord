/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AskMeToMute (author x2b) as found in TestCord. When a moderator server-mutes you in the voice channel you are in, you mute yourself (so you are still muted for others) and, if your role may mute members, the server mute is taken off you, so only your own mute stays. The same rule as the original; the decision is one function that the tests check. Not tried in a real Discord (it needs a moderator to server-mute you).

import type { PluginCode } from "../../renderer/engine";

/** Mute members, bit 22 of Discord's permission number. */
const MUTE_MEMBERS = 1n << 22n;

export interface VoiceUpdate { userId: string; channelId?: string | null; guildId?: string | null; mute?: boolean; selfMute?: boolean; }

/** Whether this voice update is "a moderator server-muted me, in the channel I am in, in a server". */
export function isServerMutedHere(update: VoiceUpdate, me: string | undefined, currentChannel: string | null | undefined): boolean {
    return !!me && update.userId === me && !!update.guildId && !!update.channelId && update.channelId === currentChannel && update.mute === true && update.selfMute !== true;
}

interface VoiceActions { toggleSelfMute(options: { playSoundEffect: boolean; }): void; }
interface ServerMuteActions { setServerMute(guildId: string, userId: string, mute: boolean): unknown; }
interface Permissions { canWithPartialContext(permission: bigint, context: { channelId: string; }): boolean; }

const plugin: PluginCode & { onVoice?(states: VoiceUpdate[]): void; } = {
    start(ctx) {
        const voice = ctx.finders.byProps<VoiceActions>("toggleSelfMute");
        const moderation = ctx.finders.byProps<ServerMuteActions>("setServerMute");
        plugin.onVoice = states => {
            const me = ctx.common.UserStore.get()?.getCurrentUser()?.id;
            const current = ctx.common.SelectedChannelStore.get()?.getVoiceChannelId();
            const permissions = ctx.common.PermissionStore.get() as unknown as Permissions | undefined;
            for (const state of states) {
                if (!isServerMutedHere(state, me, current)) continue;
                if (!permissions?.canWithPartialContext(MUTE_MEMBERS, { channelId: state.channelId! })) continue;
                voice.get()?.toggleSelfMute({ playSoundEffect: true });
                void Promise.resolve(moderation.get()?.setServerMute(state.guildId!, state.userId, false)).catch(error => { ctx.reportError("AskMeToMute", error); });
            }
        };
    },
    flux: {
        VOICE_STATE_UPDATES(event: { voiceStates?: VoiceUpdate[]; }) { plugin.onVoice?.(event.voiceStates ?? []); }
    },
    stop() { plugin.onVoice = undefined; }
};

export default plugin;
