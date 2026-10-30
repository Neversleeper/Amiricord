/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ReactionTracker (author x2b) as found in TestCord. Same rule as the original: only reactions on your own messages whose emoji name has the word you set, and removing the reaction takes it off the count again. Counts are kept on this computer (this plugin's storage). The tab lists names instead of Discord mentions.

import { addPanelTab } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    emojiToTrack: { type: "string", default: "reaction", description: "Only count reactions whose emoji name contains this (no colons)" },
    label: { type: "string", default: "reaction", description: "What to call one tracked reaction" }
});

export interface Counts { users: Record<string, number>; channels: Record<string, number>; }

const KEY = "counts";
let counts: Counts = { users: {}, channels: {} };
const listeners = new Set<() => void>();

/** Counts from a saved value; anything that is not a pair of number tables is an empty count. */
export function cleanCounts(value: unknown): Counts {
    const table = (list: unknown): Record<string, number> => {
        const out: Record<string, number> = {};
        if (list && typeof list === "object" && !Array.isArray(list)) for (const [key, number] of Object.entries(list)) if (typeof number === "number" && number > 0) out[key] = number;
        return out;
    };
    const object = value && typeof value === "object" ? value as { users?: unknown; channels?: unknown; } : {};
    return { users: table(object.users), channels: table(object.channels) };
}

/** The counts with one more reaction by a person in a channel. */
export function addReaction(all: Counts, userId: string, channelId: string): Counts {
    return { users: { ...all.users, [userId]: (all.users[userId] ?? 0) + 1 }, channels: { ...all.channels, [channelId]: (all.channels[channelId] ?? 0) + 1 } };
}

/** The counts with one reaction less (a count that reaches zero is removed). */
export function removeReaction(all: Counts, userId: string, channelId: string): Counts {
    const lower = (table: Record<string, number>, id: string) => {
        const next = { ...table };
        const value = (next[id] ?? 0) - 1;
        if (value > 0) next[id] = value;
        else delete next[id];
        return next;
    };
    return { users: lower(all.users, userId), channels: lower(all.channels, channelId) };
}

/** The table as a list, highest first. */
export function ranked(table: Record<string, number>): Array<{ id: string; count: number; }> {
    return Object.entries(table).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

interface ReactionEvent { channelId: string; messageId: string; userId: string; emoji: { name?: string | null; }; }

const plugin: PluginCode = {
    async start(ctx) {
        counts = cleanCounts(await ctx.storage.get(KEY));
        const messages = ctx.common.MessageStore;
        const users = ctx.common.UserStore;
        const channels = ctx.common.ChannelStore;
        const nameOf = (id: string) => (users.get()?.getUser(id) as { globalName?: string; username?: string; } | undefined)?.globalName ?? users.get()?.getUser(id)?.username ?? id;
        const channelName = (id: string) => channels.get()?.getChannel(id)?.name ?? id;
        const save = () => {
            ctx.storage.set(KEY, counts as never).catch(() => undefined);
            for (const listener of listeners) listener();
        };
        (plugin as { onReaction?: (event: ReactionEvent, add: boolean) => void; }).onReaction = (event, add) => {
            const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { author?: { id: string; }; } | undefined; } | undefined)?.getMessage(event.channelId, event.messageId);
            if (!message?.author || message.author.id !== users.get()?.getCurrentUser()?.id) return;
            if (!(event.emoji.name ?? "").includes(settings.store.emojiToTrack)) return;
            counts = add ? addReaction(counts, event.userId, event.channelId) : removeReaction(counts, event.userId, event.channelId);
            save();
        };
        addPanelTab(ctx, {
            title: "Reaction Tracker",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const label = settings.store.label || "reaction";
                const section = (title: string, table: Record<string, number>, name: (id: string) => string) => ranked(table).length === 0 ? null : kit.card([
                    kit.title(title), ...ranked(table).slice(0, 10).map(entry => kit.item(entry.id, null, name(entry.id), `${entry.count} ${label}${entry.count === 1 ? "" : "s"}`, []))
                ]);
                return kit.panel(
                    Object.keys(counts.users).length === 0 ? kit.card([kit.title("Reaction Tracker"), kit.note("Nothing tracked yet.")]) : null,
                    section("Top reactors", counts.users, nameOf),
                    section("Top channels", counts.channels, id => `#${channelName(id)}`),
                    kit.card([kit.row(kit.button("Clear all data", () => { counts = { users: {}, channels: {} }; save(); }, { variant: "danger" }))])
                );
            }
        });
    },
    flux: {
        MESSAGE_REACTION_ADD(event: ReactionEvent) { (plugin as { onReaction?: (event: ReactionEvent, add: boolean) => void; }).onReaction?.(event, true); },
        MESSAGE_REACTION_REMOVE(event: ReactionEvent) { (plugin as { onReaction?: (event: ReactionEvent, add: boolean) => void; }).onReaction?.(event, false); }
    },
    stop() {
        (plugin as { onReaction?: unknown; }).onReaction = undefined;
        listeners.clear();
        counts = { users: {}, channels: {} };
    }
};

export default plugin;
