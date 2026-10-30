/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MessageLogger (authors rushii, Aria) as found in TestCord's copy of Vencord's plugins. A smaller version of the original (which keeps the deleted message drawn in the chat in red): messages seen on screen are remembered, and when one is deleted or edited its old text goes to a list (up to a limit you set). The list is only in memory and is gone when Discord closes; nothing is stored on disk or sent anywhere. Messages you never saw loaded (before the plugin started) cannot be listed. Not tried in a real Discord.

import { openPanelWindow } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    maxEntries: { type: "number", default: 200, min: 20, max: 2000, integer: true, description: "How many deleted or edited messages to keep" },
    ignoreBots: { type: "boolean", default: false, description: "Ignore messages of bots" },
    ignoreSelf: { type: "boolean", default: true, description: "Ignore your own messages" }
});

export interface Seen { id: string; channelId: string; authorId: string; author: string; content: string; bot: boolean; }
export interface LogEntry extends Seen { kind: "deleted" | "edited"; newContent?: string; at: number; }

/** A message as the page gives it, reduced to what is kept. */
export function toSeen(message: unknown): Seen | undefined {
    const m = message as { id?: string; channel_id?: string; content?: string; author?: { id?: string; username?: string; global_name?: string; globalName?: string; bot?: boolean; }; } | undefined;
    if (!m?.id || !m.channel_id || typeof m.content !== "string" || !m.author?.id) return undefined;
    return { id: m.id, channelId: m.channel_id, authorId: m.author.id, author: m.author.globalName ?? m.author.global_name ?? m.author.username ?? m.author.id, content: m.content, bot: !!m.author.bot };
}

/** The log with an entry added at the front and cut to `max`. */
export function addEntry(log: LogEntry[], entry: LogEntry, max: number): LogEntry[] {
    return [entry, ...log].slice(0, Math.max(1, max));
}

const CACHE_MAX = 3000;
const cache = new Map<string, Seen>();
let log: LogEntry[] = [];

const plugin: PluginCode & { onFlux?: (type: string, event: Record<string, unknown>) => void; } = {
    settings,
    start(ctx) {
        const me = () => ctx.common.UserStore.get()?.getCurrentUser()?.id;
        const remember = (message: unknown) => {
            const seen = toSeen(message);
            if (!seen) return;
            cache.delete(seen.id);
            cache.set(seen.id, seen);
            if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        };
        const skip = (seen: Seen) => (settings.store.ignoreBots && seen.bot) || (settings.store.ignoreSelf && seen.authorId === me());
        plugin.onFlux = (type, event) => {
            if (type === "MESSAGE_CREATE") remember(event.message);
            else if (type === "LOAD_MESSAGES_SUCCESS") for (const message of (event.messages as unknown[]) ?? []) remember(message);
            else if (type === "MESSAGE_DELETE") {
                const seen = cache.get(String(event.id));
                if (seen && !skip(seen)) log = addEntry(log, { ...seen, kind: "deleted", at: Date.now() }, settings.store.maxEntries);
                cache.delete(String(event.id));
            } else if (type === "MESSAGE_UPDATE") {
                const next = toSeen(event.message);
                const before = next ? cache.get(next.id) : undefined;
                if (next && before && before.content !== next.content && !skip(before)) log = addEntry(log, { ...before, kind: "edited", newContent: next.content, at: Date.now() }, settings.store.maxEntries);
                if (next) remember(event.message);
            }
        };
        ctx.commands.add({
            name: "deletedlog",
            description: "List the deleted and edited messages seen",
            execute() {
                openPanelWindow(ctx, `Deleted and edited (${log.length})`, kit => kit.panel(log.length === 0
                    ? kit.card([kit.note("Nothing has been deleted or edited while you watched.")])
                    : kit.card(log.map(entry => kit.item(`${entry.id}-${entry.at}`, null, `${entry.author} (${entry.kind})`, entry.kind === "edited" ? `${entry.content} → ${entry.newContent ?? ""}` : entry.content, [])))));
            }
        });
    },
    flux: {
        MESSAGE_CREATE(event: Record<string, unknown>) { plugin.onFlux?.("MESSAGE_CREATE", event); },
        LOAD_MESSAGES_SUCCESS(event: Record<string, unknown>) { plugin.onFlux?.("LOAD_MESSAGES_SUCCESS", event); },
        MESSAGE_DELETE(event: Record<string, unknown>) { plugin.onFlux?.("MESSAGE_DELETE", event); },
        MESSAGE_UPDATE(event: Record<string, unknown>) { plugin.onFlux?.("MESSAGE_UPDATE", event); }
    },
    stop() { plugin.onFlux = undefined; cache.clear(); log = []; }
};

export default plugin;
