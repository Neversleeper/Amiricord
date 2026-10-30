/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MessageReminders (author sirphantom89) as found in TestCord. Same presets and the same check. The right-click items are four separate entries ("Remind me in 30 minutes" and so on) because the engine's menu has no sub-menus. The notice is the engine's own card inside Discord's window, so it shows only while Discord is open; reminders that came due while Discord was closed show when it opens again.

import { messageFromTarget } from "../../api/clickTargets";
import { addPanelTab } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface Reminder { id: string; messageId: string; channelId: string; author: string; content: string; remindAt: number; }

const KEY = "list";
const CHECK_MS = 15_000;
let reminders: Reminder[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const atHour = (now: number, hour: number, dayOffset = 0) => {
    const date = new Date(now);
    date.setHours(hour, 0, 0, 0);
    return date.getTime() + dayOffset * 86_400_000;
};

/** The times the right-click offers, from `now`. */
export function presets(now: number): Array<{ label: string; at: number; }> {
    return [
        { label: "in 30 minutes", at: now + 30 * 60_000 },
        { label: "in 1 hour", at: now + 60 * 60_000 },
        { label: "in 3 hours", at: now + 3 * 60 * 60_000 },
        { label: "this evening", at: atHour(now, 18) > now ? atHour(now, 18) : atHour(now, 18, 1) },
        { label: "tomorrow morning", at: atHour(now, 9, 1) }
    ];
}

/** The reminders that are due at `now` and the ones that are not. */
export function splitDue(list: Reminder[], now: number): { due: Reminder[]; rest: Reminder[]; } {
    return { due: list.filter(entry => entry.remindAt <= now), rest: list.filter(entry => entry.remindAt > now) };
}

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        reminders = Array.isArray(saved) ? saved as unknown as Reminder[] : [];
        const messages = ctx.common.MessageStore;
        const actions = ctx.finders.byProps<{ jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; }): void; }>("jumpToMessage");
        const save = async () => {
            await ctx.storage.set(KEY, reminders as never);
            for (const listener of listeners) listener();
        };
        const jump = (entry: Reminder) => { actions.get()?.jumpToMessage({ channelId: entry.channelId, messageId: entry.messageId, flash: true }); };
        const check = async () => {
            const { due, rest } = splitDue(reminders, Date.now());
            if (due.length === 0) return;
            reminders = rest;
            await save();
            for (const entry of due) ctx.notifications.show({ title: `Reminder: message from ${entry.author}`, body: entry.content || "Jump to the message you saved.", onClick: () => { jump(entry); }, timeoutMs: 30_000 });
        };
        timer = setInterval(() => { check().catch(error => { ctx.reportError("MessageReminders", error); }); }, CHECK_MS);
        ctx.onDispose(() => { if (timer) clearInterval(timer); timer = undefined; });
        check().catch(() => undefined);

        ctx.menuItems.add("remind-me", click => {
            const ref = messageFromTarget(click.target);
            if (!ref) return null;
            return presets(Date.now()).map(preset => ({
                label: `Remind me ${preset.label}`,
                action: () => {
                    const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { content?: string; author?: { username?: string; }; } | undefined; } | undefined)?.getMessage(ref.channelId, ref.messageId);
                    reminders = [...reminders, { id: `${ref.messageId}-${preset.at}`, messageId: ref.messageId, channelId: ref.channelId, author: message?.author?.username ?? "Unknown", content: (message?.content ?? "").slice(0, 140), remindAt: preset.at }];
                    ctx.toasts.show(`Reminder set for ${new Date(preset.at).toLocaleString()}.`, "success");
                    save().catch(error => { ctx.reportError("MessageReminders", error); });
                }
            }));
        });

        addPanelTab(ctx, {
            title: "Reminders",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const sorted = [...reminders].sort((a, b) => a.remindAt - b.remindAt);
                return kit.panel(sorted.length === 0
                    ? kit.card([kit.title("Reminders"), kit.note("No reminders yet. Right-click a message and choose Remind me.")])
                    : kit.card([kit.title(`Reminders (${sorted.length})`), ...sorted.map(entry => kit.item(entry.id, null, new Date(entry.remindAt).toLocaleString(), `${entry.author}: ${entry.content || "(no text)"}`, [
                        kit.button("Jump", () => { jump(entry); }),
                        kit.button("Cancel", () => { reminders = reminders.filter(other => other.id !== entry.id); save().catch(() => undefined); }, { variant: "danger" })
                    ]))]));
            }
        });
    },
    stop() {
        if (timer) clearInterval(timer);
        timer = undefined;
        listeners.clear();
        reminders = [];
    }
};

export default plugin;
