/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ScheduledMessages (authors mmeta, prism) as found in Equicord's copy of Vencord's plugins. A smaller version of the original: no calendar window and no phantom message in the chat. The messages are sent by Discord's own request while Amiricord is running, checked every few seconds; messages that come due while Discord is closed are sent the next time it starts (the tab shows them first). Needs the permission to send messages.

import { addPanelTab } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface Scheduled { id: string; channelId: string; content: string; at: number; }

const KEY = "queue";
const CHECK_MS = 5000;
let queue: Scheduled[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
const listeners = new Set<() => void>();

/** Milliseconds from a delay like "90s", "10m", "2h30m", "1d" or "1d 2h"; undefined when it cannot be read or is zero. */
export function parseDelay(text: string): number | undefined {
    const clean = text.trim().toLowerCase();
    if (!/^(\d+\s*[dhms]\s*)+$/.test(clean)) return undefined;
    const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000 };
    let total = 0;
    for (const part of clean.matchAll(/(\d+)\s*([dhms])/g)) total += Number(part[1]) * units[part[2]];
    return total > 0 ? total : undefined;
}

/** The ones due at `now` and the others, soonest first. */
export function splitQueue(list: Scheduled[], now: number): { due: Scheduled[]; later: Scheduled[]; } {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    return { due: sorted.filter(entry => entry.at <= now), later: sorted.filter(entry => entry.at > now) };
}

interface Rest { post(request: { url: string; body: unknown; }): Promise<unknown>; }

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        queue = Array.isArray(saved) ? saved as unknown as Scheduled[] : [];
        const selected = ctx.common.SelectedChannelStore;
        const channels = ctx.common.ChannelStore;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const save = async () => {
            await ctx.storage.set(KEY, queue as never);
            for (const listener of listeners) listener();
        };
        const send = async (entry: Scheduled) => {
            await rest.get()?.post({ url: `/channels/${entry.channelId}/messages`, body: { content: entry.content, nonce: String(Date.now()), tts: false } });
        };
        const check = async () => {
            if (busy) return;
            busy = true;
            try {
                const { due, later } = splitQueue(queue, Date.now());
                if (due.length === 0) return;
                queue = later;
                await save();
                for (const entry of due) {
                    try {
                        await send(entry);
                        ctx.toasts.show("A scheduled message was sent.", "success");
                    } catch (error) {
                        ctx.reportError("ScheduledMessages", error);
                        ctx.toasts.show("A scheduled message could not be sent.", "failure");
                    }
                }
            } finally {
                busy = false;
            }
        };
        timer = setInterval(() => { check().catch(() => undefined); }, CHECK_MS);
        ctx.onDispose(() => { if (timer) clearInterval(timer); timer = undefined; });
        ctx.commands.add({
            name: "schedule",
            description: "Send a message later",
            options: [
                { name: "in", description: "After how long, for example 10m, 2h30m or 1d", required: true },
                { name: "message", description: "The message", required: true }
            ],
            async execute(args) {
                const value = (name: string) => String(args.find(arg => arg.name === name)?.value ?? "");
                const delay = parseDelay(value("in"));
                const channelId = selected.get()?.getChannelId();
                if (delay === undefined) { ctx.toasts.show("Write the delay like 10m, 2h30m or 1d.", "failure"); return; }
                if (!channelId || value("message").trim() === "") { ctx.toasts.show("Open a channel and write a message.", "failure"); return; }
                queue = [...queue, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, channelId, content: value("message"), at: Date.now() + delay }];
                await save();
                ctx.toasts.show(`Scheduled for ${new Date(Date.now() + delay).toLocaleString()}.`, "success");
            }
        });
        addPanelTab(ctx, {
            title: "Scheduled",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const sorted = [...queue].sort((a, b) => a.at - b.at);
                return kit.panel(sorted.length === 0
                    ? kit.card([kit.title("Scheduled messages"), kit.note("Nothing is waiting. Use /schedule in a channel.")])
                    : kit.card([kit.title(`Scheduled messages (${sorted.length})`), ...sorted.map(entry => kit.item(entry.id, null, new Date(entry.at).toLocaleString(), `#${channels.get()?.getChannel(entry.channelId)?.name ?? entry.channelId}: ${entry.content.slice(0, 120)}`, [
                        kit.button("Send now", () => { queue = queue.filter(other => other.id !== entry.id); save().then(() => send(entry)).catch(error => { ctx.reportError("ScheduledMessages", error); }); }),
                        kit.button("Cancel", () => { queue = queue.filter(other => other.id !== entry.id); save().catch(() => undefined); }, { variant: "danger" })
                    ]))]));
            }
        });
    },
    stop() {
        if (timer) clearInterval(timer);
        timer = undefined;
        listeners.clear();
        queue = [];
    }
};

export default plugin;
