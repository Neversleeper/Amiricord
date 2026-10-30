/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FollowVoiceUser (author TheArmagan) as found in Equicord's copy of Vencord's plugins. Same rules and options. The original adds a checkbox to Discord's own user menu; here the entry is in Amiricord's right-click menu and reads "Follow User" or "Stop following" (it toggles). The original sets the starting channel to your own id by mistake; here the person's current channel is taken when they move.

import { userIdFromTarget } from "../../api/clickTargets";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    onlyWhenInVoice: { type: "boolean", default: true, description: "Only follow when you are in a voice channel" },
    leaveWhenUserLeaves: { type: "boolean", default: false, description: "Leave the voice channel when the person leaves (this can make you join and leave in a loop)" }
});

interface VoiceState { userId: string; channelId: string | null; }
interface Voice { selectVoiceChannel(channelId: string | null): void; }

let followed: { userId: string; lastChannelId: string | null; } | null = null;
let onUpdate: ((states: VoiceState[]) => void) | undefined;

/** What to do for a voice update about the followed person: the channel to join, null to leave, or undefined to do nothing. */
export function followAction(state: VoiceState, followedId: string, lastChannelId: string | null, leaveWhenUserLeaves: boolean): string | null | undefined {
    if (state.userId !== followedId) return undefined;
    if (state.channelId && state.channelId !== lastChannelId) return state.channelId;
    if (!state.channelId && leaveWhenUserLeaves) return null;
    return undefined;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const voice = ctx.finders.byProps<Voice>("selectVoiceChannel");
        const users = ctx.common.UserStore;
        const friends = ctx.common.RelationshipStore;
        const voiceStates = ctx.common.VoiceStateStore;
        const isFriend = (id: string) => ((friends.get() as unknown as { getFriendIDs(): string[]; } | undefined)?.getFriendIDs() ?? []).includes(id);
        ctx.menuItems.add("follow-voice-user", click => {
            const id = userIdFromTarget(click.target);
            if (!id || id === users.get()?.getCurrentUser()?.id || !isFriend(id)) return null;
            const checked = followed?.userId === id;
            return {
                label: checked ? "Stop following" : "Follow User",
                action: () => { followed = checked ? null : { userId: id, lastChannelId: null }; }
            };
        });
        onUpdate = states => {
            if (!followed || !isFriend(followed.userId)) return;
            const me = users.get()?.getCurrentUser()?.id;
            if (settings.store.onlyWhenInVoice && (!me || !(voiceStates.get() as unknown as { getVoiceStateForUser(id: string): unknown; } | undefined)?.getVoiceStateForUser(me))) return;
            for (const state of states) {
                const action = followAction(state, followed.userId, followed.lastChannelId, settings.store.leaveWhenUserLeaves);
                if (action === undefined) continue;
                followed.lastChannelId = action;
                voice.get()?.selectVoiceChannel(action);
            }
        };
    },
    stop() {
        followed = null;
        onUpdate = undefined;
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            onUpdate?.(voiceStates);
        }
    }
};

export default plugin;
