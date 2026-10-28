/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WaitForSlot (authors omaw and prism) as found in TestCord's copy of Equicord's plugins. Tried in a real Discord (Stable) and the owner reported that it works.
// Differences from the original:
//  - the "Join Queue" entry is added with `ctx.contextMenu.addNative("channel-context", ...)`. That menu's name is Vencord's; it was NOT possible to check it in Discord's code
//    (the module is not among the files readable without an account), so if the entry never shows, that is the first place to look;
//  - the notices are Amiricord's notification cards (the original used Discord's top notice bar), and the "full channel" question appears as a card with the button inside it;
//  - the sound is one of Discord's own (`message1`), played with `ctx.sounds`; the original downloaded an mp3 from GitHub, which this plugin does not do (no network);
//  - the patch is the original's. In Discord's web build 652418 it matches exactly once (`g||T||a.default.selectVoiceChannel(t.id)`); it was tried running in Stable and the owner reported that it works.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const GUILD_VOICE = 2;
/** Discord's MOVE_MEMBERS permission (1 << 24). */
const MOVE_MEMBERS = 1n << 24n;
const SOUND = "message1";

const settings = definePluginSettings({
    autoJoin: { type: "boolean", default: false, description: "Join the channel immediately instead of showing a notice." },
    notificationSound: { type: "boolean", default: true, description: "Play a sound when a slot becomes available." }
});

interface ChannelLike { id: string; name?: string; type?: number; userLimit?: number; }

interface Running {
    ctx: EnginePluginContext;
    channels: { getChannel(id: string): ChannelLike | undefined; };
    voice: { getVoiceStatesForChannel(id: string): Record<string, unknown>; };
    permissions: { can(permission: bigint, channel: ChannelLike): boolean; };
    actions: { selectVoiceChannel(id: string): void; };
}

let running: Running | undefined;
let waitingChannelId: string | null = null;
let generation = 0;

const usersIn = (state: Running, channel: ChannelLike) => Object.keys(state.voice.getVoiceStatesForChannel(channel.id) ?? {}).length;

/** Whether the channel is a voice channel with a user limit that is full, and the person cannot move people (who can join anyway). */
function isFullForMe(state: Running, channel: ChannelLike | null | undefined): channel is ChannelLike {
    if (!channel || channel.type !== GUILD_VOICE || !channel.userLimit) return false;
    if (state.permissions.can(MOVE_MEMBERS, channel)) return false;
    return usersIn(state, channel) >= channel.userLimit;
}

/** Called by the patched Discord code when the person tries to join a voice channel. True means "do not join now". */
function promptVoiceChannel(channel: ChannelLike | null | undefined): boolean {
    const state = running;
    if (!state || !isFullForMe(state, channel)) return false;
    if (waitingChannelId === channel.id) return true;
    state.ctx.notifications.show({
        title: `${channel.name ?? "The voice channel"} is full`,
        body: "Press here to wait for a free slot.",
        onClick: () => { waitingChannelId = channel.id; }
    });
    return true;
}

const plugin: PluginCode & { promptVoiceChannel(channel: ChannelLike | null | undefined): boolean; } = {
    settings,
    patches: [
        {
            find: "VoiceChannel, transitionTo: Channel does not have a guildId",
            replacements: [{ match: /(?=\|\|\i\.\i\.selectVoiceChannel\((\i)\.id\))/, replace: "||$self.promptVoiceChannel($1)" }]
        }
    ],

    promptVoiceChannel(channel) {
        try {
            return promptVoiceChannel(channel);
        } catch {
            return false;
        }
    },

    async start(ctx) {
        const mine = ++generation;
        const [channels, voice, permissions, actions] = await Promise.all([
            ctx.finders.byStore<Running["channels"]>("ChannelStore").ready(),
            ctx.finders.byStore<Running["voice"]>("VoiceStateStore").ready(),
            ctx.finders.byStore<Running["permissions"]>("PermissionStore").ready(),
            ctx.finders.byProps<Running["actions"]>("selectVoiceChannel", "selectChannel").ready()
        ]);
        if (mine !== generation) return;
        const state: Running = { ctx, channels, voice, permissions, actions };
        running = state;

        ctx.contextMenu.addNative("channel-context", (children, props) => {
            const channel = (props as { channel?: ChannelLike; } | undefined)?.channel;
            const parts = ctx.contextMenu.parts();
            if (!parts || !isFullForMe(state, channel)) return;
            const Item = parts.MenuItem as (props: Record<string, unknown>) => unknown;
            const waiting = waitingChannelId === channel.id;
            children.splice(-1, 0, ctx.components.react.get()?.createElement(Item, {
                id: "amiricord-wait-for-slot",
                key: "amiricord-wait-for-slot",
                label: waiting ? "Leave Queue" : "Join Queue",
                action: () => { waitingChannelId = waiting ? null : channel.id; }
            }));
        });
    },

    stop() {
        generation++;
        running = undefined;
        waitingChannelId = null;
    },

    flux: {
        VOICE_STATE_UPDATES() {
            const state = running;
            if (!state || !waitingChannelId) return;
            const channel = state.channels.getChannel(waitingChannelId);
            if (!channel?.userLimit) {
                waitingChannelId = null;
                return;
            }
            if (usersIn(state, channel) >= channel.userLimit) return;
            const channelId = waitingChannelId;
            waitingChannelId = null;
            if (settings.store.notificationSound) state.ctx.sounds.play(SOUND, 0.5);
            if (settings.store.autoJoin) {
                state.actions.selectVoiceChannel(channelId);
            } else {
                state.ctx.notifications.show({
                    title: `A spot opened in #${channel.name ?? "the channel"}`,
                    body: "Press here to join.",
                    onClick: () => { state.actions.selectVoiceChannel(channelId); }
                });
            }
        }
    }
};

export default plugin;
