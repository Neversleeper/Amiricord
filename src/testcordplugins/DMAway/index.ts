/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin DMAway (author Sharp) as found in TestCord. A moon button in the channel header switches "away" on: a direct message from a person gets your away message back, once per person per cooldown. Changes: the cooldown cannot be under 5 minutes, only one-to-one direct messages are answered (never groups or servers), blocked people are never answered, at most 30 replies each time it is switched on, and it switches itself off when the plugin stops. The original's idle timer is not carried over (manual switch only). Not tried in a real Discord (a second account has to write to you).

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    message: { type: "string", default: "I'm away right now, I'll get back to you soon.", maxLength: 500, description: "The message sent to people who write to you while you are away" },
    cooldownMinutes: { type: "number", default: 30, min: 5, max: 1440, integer: true, description: "Do not answer the same person more than once in this many minutes" }
});

export const MAX_REPLIES = 30;

export interface AwayState { on: boolean; replied: Map<string, number>; sent: number; }

/** Whether to answer a message that arrived, and records it when yes. Pure apart from the state it is given. */
export function shouldReply(state: AwayState, message: { authorId?: string; guildId?: string | null; channelType?: number; blocked?: boolean; }, me: string | undefined, now: number, cooldownMinutes: number): boolean {
    if (!state.on || !me || !message.authorId || message.authorId === me) return false;
    if (message.guildId || message.channelType !== 1 || message.blocked) return false;
    if (state.sent >= MAX_REPLIES) return false;
    const last = state.replied.get(message.authorId);
    if (last !== undefined && now - last < Math.max(5, cooldownMinutes) * 60000) return false;
    state.replied.set(message.authorId, now);
    state.sent++;
    return true;
}

interface Actions { sendMessage(channelId: string, message: { content: string; }, waitForChannelReady?: boolean): Promise<unknown>; }
interface Relationships { isBlocked?(id: string): boolean; }
interface Incoming { message?: { author?: { id?: string; }; guild_id?: string | null; channel_id?: string; }; channelId?: string; }

const MOON = { viewBox: "0 0 24 24", path: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" };
const state: AwayState = { on: false, replied: new Map(), sent: 0 };

const plugin: PluginCode & { onMessage?(event: Incoming): void; } = {
    settings,
    start(ctx) {
        const actions = ctx.finders.byProps<Actions>("sendMessage", "editMessage", "deleteMessage");
        plugin.onMessage = event => {
            const message = event.message;
            const channelId = event.channelId ?? message?.channel_id;
            if (!message || !channelId) return;
            const me = ctx.common.UserStore.get()?.getCurrentUser()?.id;
            const type = (ctx.common.ChannelStore.get()?.getChannel(channelId) as { type?: number; } | undefined)?.type;
            const blocked = (ctx.common.RelationshipStore.get() as unknown as Relationships | undefined)?.isBlocked?.(message.author?.id ?? "") === true;
            if (!shouldReply(state, { authorId: message.author?.id, guildId: message.guild_id, channelType: type, blocked }, me, Date.now(), settings.store.cooldownMinutes)) return;
            void actions.get()?.sendMessage(channelId, { content: settings.store.message }, true)?.catch(error => { ctx.reportError("DMAway", error); });
        };
        ctx.headerBar.add({
            id: "away",
            label: () => (state.on ? "Away: on (click to turn off)" : "Away: off (click to answer direct messages while you are away)"),
            icon: MOON,
            active: () => state.on,
            onClick: () => {
                state.on = !state.on;
                state.replied.clear();
                state.sent = 0;
                ctx.headerBar.refresh();
                ctx.toasts.show(state.on ? "Away: answering direct messages." : "Away is off.", state.on ? "success" : "info");
            }
        });
    },
    flux: {
        MESSAGE_CREATE(event: Incoming) { plugin.onMessage?.(event); }
    },
    stop() {
        plugin.onMessage = undefined;
        state.on = false;
        state.replied.clear();
        state.sent = 0;
    }
};

export default plugin;
