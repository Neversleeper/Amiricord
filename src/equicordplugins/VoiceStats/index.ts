/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin VoiceStats (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. A smaller version of the original: it counts the time each person is in the voice channel you are in, adds it up per person (kept on this computer, saved every 30 seconds), and lists the people with the most time. The original also draws the total inside the person's profile; that part is not ported.

import { addPanelTab } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

const KEY = "totals";
const SAVE_MS = 30_000;
export const MAX_PEOPLE = 500;
let totals: Record<string, number> = {};
const starts = new Map<string, number>();
let tracked: string | undefined;
let saver: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

/** "1h 5m 3s" for a number of seconds. */
export function formatSeconds(total: number): string {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours > 0 ? `${hours}h` : "", hours > 0 || minutes > 0 ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
}

/** The totals with the time since each start added, and the new starts (all moved to `now`). */
export function flushTotals(current: Record<string, number>, running: Map<string, number>, now: number): Record<string, number> {
    const next = { ...current };
    for (const [id, startedAt] of running) {
        next[id] = (next[id] ?? 0) + Math.max(0, Math.floor((now - startedAt) / 1000));
        running.set(id, now);
    }
    const ids = Object.keys(next);
    if (ids.length > MAX_PEOPLE) for (const id of ids.sort((a, b) => next[a] - next[b]).slice(0, ids.length - MAX_PEOPLE)) delete next[id];
    return next;
}

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        totals = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as unknown as Record<string, number> : {};
        const users = ctx.common.UserStore;
        const selected = ctx.common.SelectedChannelStore;
        const voice = ctx.common.VoiceStateStore;
        const nameOf = (id: string) => {
            const user = users.get()?.getUser(id) as { username?: string; globalName?: string; } | undefined;
            return user?.globalName ?? user?.username ?? id;
        };
        const flush = () => {
            totals = flushTotals(totals, starts, Date.now());
            for (const listener of listeners) listener();
            ctx.storage.set(KEY, totals as never).catch(() => undefined);
        };
        const begin = (channelId: string) => {
            tracked = channelId;
            const me = users.get()?.getCurrentUser()?.id;
            const states = (voice.get() as unknown as { getVoiceStatesForChannel(id: string): Record<string, { userId: string; }>; } | undefined)?.getVoiceStatesForChannel(channelId) ?? {};
            for (const state of Object.values(states)) if (state.userId !== me) starts.set(state.userId, Date.now());
            saver = setInterval(flush, SAVE_MS);
        };
        const end = () => {
            if (saver) clearInterval(saver);
            saver = undefined;
            if (tracked) flush();
            starts.clear();
            tracked = undefined;
        };
        (plugin as { onSelect?: (channelId: string | null) => void; onStates?: (states: Array<{ userId: string; channelId?: string | null; }>) => void; }).onSelect = channelId => {
            end();
            if (channelId) begin(channelId);
        };
        (plugin as { onStates?: unknown; }).onStates = (states: Array<{ userId: string; channelId?: string | null; }>) => {
            if (!tracked) return;
            const me = users.get()?.getCurrentUser()?.id;
            for (const state of states) {
                if (state.userId === me) continue;
                if (state.channelId === tracked && !starts.has(state.userId)) starts.set(state.userId, Date.now());
                else if (state.channelId !== tracked && starts.has(state.userId)) {
                    totals = flushTotals(totals, new Map([[state.userId, starts.get(state.userId) as number]]), Date.now());
                    starts.delete(state.userId);
                }
            }
        };
        const current = selected.get()?.getVoiceChannelId();
        if (current) begin(current);
        addPanelTab(ctx, {
            title: "Voice Stats",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const live = { ...totals };
                for (const [id, startedAt] of starts) live[id] = (live[id] ?? 0) + Math.floor((Date.now() - startedAt) / 1000);
                const ranked = Object.entries(live).sort((a, b) => b[1] - a[1]).slice(0, 50);
                return kit.panel(ranked.length === 0
                    ? kit.card([kit.title("Voice Stats"), kit.note("Nothing counted yet. Join a voice channel with other people.")])
                    : kit.card([kit.title("Time together in voice"), ...ranked.map(([id, seconds]) => kit.item(id, null, nameOf(id), formatSeconds(seconds), []))]));
            }
        });
    },
    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            (plugin as { onSelect?: (channelId: string | null) => void; }).onSelect?.(channelId);
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: Array<{ userId: string; channelId?: string | null; }>; }) {
            (plugin as { onStates?: (states: Array<{ userId: string; channelId?: string | null; }>) => void; }).onStates?.(voiceStates);
        }
    },
    stop() {
        if (saver) clearInterval(saver);
        saver = undefined;
        starts.clear();
        tracked = undefined;
        listeners.clear();
        (plugin as { onSelect?: unknown; onStates?: unknown; }).onSelect = undefined;
        (plugin as { onSelect?: unknown; onStates?: unknown; }).onStates = undefined;
    }
};

export default plugin;
