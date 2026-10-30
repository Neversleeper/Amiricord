/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceChannelLog (authors Sqaaakoi, thororen, nyx, Moxxie, Fres, amy) as found in Equicord's copy of Vencord's plugins. A smaller version of the original: joins, leaves and moves, camera and screen share, per channel, kept on this computer (up to 500 entries per channel). The soundboard, mute, activity and per-sound playback parts are not ported. The log only records while you are in the channel.

import { channelIdFromTarget } from "../../api/clickTargets";
import { addPanelTab, openPanelWindow } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    logJoinLeave: { type: "boolean", default: true, description: "Log when people join, leave or move between voice channels" },
    logVideo: { type: "boolean", default: true, description: "Log when people turn their camera on or off" },
    logStream: { type: "boolean", default: true, description: "Log when people start or stop sharing their screen" },
    ignoreBlockedUsers: { type: "boolean", default: false, description: "Do not log blocked people" }
});

export interface LogEntry { type: "join" | "leave" | "move-in" | "move-out" | "video-on" | "video-off" | "stream-on" | "stream-off"; userId: string; channelId: string; time: number; }
export interface Seen { channelId: string | null; video: boolean; stream: boolean; }
export interface VoiceUpdate { userId: string; channelId?: string | null; selfVideo?: boolean; selfStream?: boolean; }

export const MAX_ENTRIES = 500;

/** The log entries a voice update makes, given what was seen for that person before. `watching` is the channel the log is kept for. */
export function entriesFor(update: VoiceUpdate, before: Seen | undefined, watching: string | undefined, now: number, options = { join: true, video: true, stream: true }): { entries: LogEntry[]; seen: Seen; } {
    const seen: Seen = { channelId: update.channelId ?? null, video: update.selfVideo === true, stream: update.selfStream === true };
    const entries: LogEntry[] = [];
    if (!watching) return { entries, seen };
    const add = (type: LogEntry["type"], channelId: string) => entries.push({ type, userId: update.userId, channelId, time: now });
    const was = before?.channelId ?? null;
    if (options.join && was !== seen.channelId) {
        if (was === watching && seen.channelId === null) add("leave", watching);
        else if (was === watching && seen.channelId) add("move-out", watching);
        else if (seen.channelId === watching && was === null) add("join", watching);
        else if (seen.channelId === watching && was) add("move-in", watching);
    }
    if (seen.channelId === watching && was === watching) {
        if (options.video && before && before.video !== seen.video) add(seen.video ? "video-on" : "video-off", watching);
        if (options.stream && before && before.stream !== seen.stream) add(seen.stream ? "stream-on" : "stream-off", watching);
    }
    return { entries, seen };
}

export const LABELS: Record<LogEntry["type"], string> = {
    join: "joined", leave: "left", "move-in": "moved in", "move-out": "moved out",
    "video-on": "turned the camera on", "video-off": "turned the camera off", "stream-on": "started sharing the screen", "stream-off": "stopped sharing the screen"
};

const KEY = "logs";
let logs: Record<string, LogEntry[]> = {};
const seenBy = new Map<string, Seen>();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const plugin: PluginCode = {
    settings,
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        logs = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as unknown as Record<string, LogEntry[]> : {};
        const users = ctx.common.UserStore;
        const relationships = ctx.common.RelationshipStore;
        const selected = ctx.common.SelectedChannelStore;
        const channels = ctx.common.ChannelStore;
        const nameOf = (id: string) => {
            const user = users.get()?.getUser(id) as { username?: string; globalName?: string; } | undefined;
            return user?.globalName ?? user?.username ?? id;
        };
        const changed = () => {
            for (const listener of listeners) listener();
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => { ctx.storage.set(KEY, logs as never).catch(() => undefined); }, 500);
        };
        ctx.onDispose(() => { if (saveTimer) clearTimeout(saveTimer); saveTimer = undefined; });
        (plugin as { onVoiceStates?: (states: VoiceUpdate[]) => void; }).onVoiceStates = states => {
            const watching = selected.get()?.getVoiceChannelId() ?? undefined;
            for (const update of states) {
                if (settings.store.ignoreBlockedUsers && (relationships.get() as unknown as { isBlocked(id: string): boolean; } | undefined)?.isBlocked(update.userId)) continue;
                const result = entriesFor(update, seenBy.get(update.userId), watching, Date.now(), { join: settings.store.logJoinLeave, video: settings.store.logVideo, stream: settings.store.logStream });
                seenBy.set(update.userId, result.seen);
                if (result.entries.length === 0) continue;
                for (const entry of result.entries) logs[entry.channelId] = [...(logs[entry.channelId] ?? []), entry].slice(-MAX_ENTRIES);
                changed();
            }
        };
        const show = (channelId: string) => openPanelWindow(ctx, `Voice log: ${channels.get()?.getChannel(channelId)?.name ?? channelId}`, (kit, react, refresh) => {
            react.useEffect(() => { listeners.add(refresh); return () => { listeners.delete(refresh); }; }, []);
            const entries = [...(logs[channelId] ?? [])].reverse();
            return kit.panel(entries.length === 0
                ? kit.card([kit.note("Nothing was logged in this channel yet. The log records while you are in the channel.")])
                : kit.card([...entries.slice(0, 200).map((entry, index) => kit.item(`${entry.time}-${index}`, null, `${nameOf(entry.userId)} ${LABELS[entry.type]}`, new Date(entry.time).toLocaleString(), [])),
                    kit.row(kit.button("Clear this log", () => { logs[channelId] = []; changed(); }, { variant: "danger" }))]));
        });
        ctx.menuItems.add("voice-log", click => {
            const id = channelIdFromTarget(click.target);
            return id ? { label: "View Voice Channel Logs", action: () => { show(id); } } : null;
        });
        ctx.commands.add({
            name: "voicelog", description: "Show the log of the voice channel you are in",
            execute() {
                const id = selected.get()?.getVoiceChannelId();
                if (!id) { ctx.toasts.show("You are not in a voice channel.", "failure"); return; }
                show(id);
            }
        });
        addPanelTab(ctx, {
            title: "Voice Log",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const ids = Object.keys(logs).filter(id => logs[id].length > 0);
                return kit.panel(ids.length === 0
                    ? kit.card([kit.title("Voice Log"), kit.note("Nothing logged yet. Join a voice channel and the log fills in.")])
                    : kit.card([kit.title("Voice Log"), ...ids.map(id => kit.item(id, null, channels.get()?.getChannel(id)?.name ?? id, `${logs[id].length} entries`, [kit.button("Open", () => { show(id); })]))]));
            }
        });
    },
    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceUpdate[]; }) {
            (plugin as { onVoiceStates?: (states: VoiceUpdate[]) => void; }).onVoiceStates?.(voiceStates);
        }
    },
    stop() {
        (plugin as { onVoiceStates?: unknown; }).onVoiceStates = undefined;
        listeners.clear();
        seenBy.clear();
        logs = {};
    }
};

export default plugin;
