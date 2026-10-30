/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin LastOnline (author x2b) as found in TestCord. The original keeps the times in a local database and shows them in the friends list and the member list; here the times are kept in this plugin's storage (people seen in the last seven days) and shown next to the name in messages. A person is known only after Amiricord saw them online and then offline, so the first minutes after the plugin starts show nothing.

import type { PluginCode } from "../../renderer/engine";

const KEY = "lastOffline";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_MS = 30_000;
export const MAX_PEOPLE = 5000;

/** "5m", "2h", "3d" for a number of milliseconds. */
export function shortAgo(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** The list without people last seen more than a week ago, and cut to the newest `MAX_PEOPLE`. */
export function prune(list: Record<string, number>, now: number): Record<string, number> {
    const kept = Object.entries(list).filter(([, time]) => now - time <= MAX_AGE_MS).sort((a, b) => b[1] - a[1]).slice(0, MAX_PEOPLE);
    return Object.fromEntries(kept);
}

let lastOffline: Record<string, number> = {};
let saver: ReturnType<typeof setInterval> | undefined;
let dirty = false;

interface Update { user?: { id: string; }; status?: string; }
interface Messages { getMessage(channel: string, id: string): { author?: { id: string; bot?: boolean; }; } | undefined; }
interface Presence { getStatus?(id: string): string | undefined; }

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        lastOffline = saved && typeof saved === "object" && !Array.isArray(saved) ? prune(saved as unknown as Record<string, number>, Date.now()) : {};
        saver = setInterval(() => {
            if (!dirty) return;
            dirty = false;
            lastOffline = prune(lastOffline, Date.now());
            ctx.storage.set(KEY, lastOffline as never).catch(() => undefined);
            ctx.messageDecor.refresh();
        }, SAVE_MS);
        ctx.onDispose(() => { if (saver) clearInterval(saver); saver = undefined; });
        const messages = ctx.common.MessageStore;
        const presence = ctx.common.PresenceStore;
        const infoOf = (channelId: string, messageId: string) => {
            const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
            if (!author || author.bot) return undefined;
            const status = (presence.get() as unknown as Presence | undefined)?.getStatus?.(author.id);
            const time = lastOffline[author.id];
            if (status !== "offline" || time === undefined) return undefined;
            return { text: `seen ${shortAgo(Date.now() - time)} ago`, title: `Last seen online ${new Date(time).toLocaleString()}` };
        };
        ctx.messageDecor.add({ id: "last-online", text: ({ channelId, messageId }) => infoOf(channelId, messageId)?.text, title: ({ channelId, messageId }) => infoOf(channelId, messageId)?.title });
        (plugin as { onPresence?: (updates: Update[]) => void; }).onPresence = updates => {
            for (const update of updates) {
                if (!update.user?.id || update.status === undefined) continue;
                if (update.status === "offline") {
                    lastOffline[update.user.id] = Date.now();
                    dirty = true;
                } else if (update.user.id in lastOffline) {
                    delete lastOffline[update.user.id];
                    dirty = true;
                }
            }
        };
    },
    flux: {
        PRESENCE_UPDATES({ updates }: { updates?: Update[]; }) {
            if (updates) (plugin as { onPresence?: (updates: Update[]) => void; }).onPresence?.(updates);
        }
    },
    stop() {
        if (saver) clearInterval(saver);
        saver = undefined;
        (plugin as { onPresence?: unknown; }).onPresence = undefined;
        lastOffline = {};
    }
};

export default plugin;
