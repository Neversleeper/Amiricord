/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MessageStatistics (author MallCord) as found in TestCord. A smaller version of the original: the count goes up each time you send a message from the message box (kept per day for one year on this computer). The /stats command and the original's chart are not ported.

import { addPanelTab } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    dailyGoal: { type: "number", default: 10, min: 1, max: 10000, integer: true, description: "Messages a day that count towards your streak" }
});

const DAY = 24 * 60 * 60 * 1000;
const KEY = "days";
let days: Record<string, number> = {};
const listeners = new Set<() => void>();

export const startOfDay = (time: number): number => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

/** The days with one more message on the day of `time`; days older than a year are dropped. */
export function addMessage(all: Record<string, number>, time: number): Record<string, number> {
    const next: Record<string, number> = {};
    const cutoff = time - 365 * DAY;
    for (const [key, count] of Object.entries(all)) if (Number(key) >= cutoff && count > 0) next[key] = count;
    const today = String(startOfDay(time));
    next[today] = (next[today] ?? 0) + 1;
    return next;
}

/** Messages in the last `span` days, today included. */
export function sumLast(all: Record<string, number>, now: number, span: number): number {
    const from = startOfDay(now) - (span - 1) * DAY;
    return Object.entries(all).reduce((sum, [key, count]) => sum + (Number(key) >= from ? count : 0), 0);
}

/** How many days in a row (ending today, or yesterday when today has not reached the goal yet) had at least `goal` messages. */
export function streak(all: Record<string, number>, now: number, goal: number): number {
    let day = startOfDay(now);
    if ((all[String(day)] ?? 0) < goal) day -= DAY;
    let count = 0;
    while ((all[String(day)] ?? 0) >= goal && count < 400) { count++; day -= DAY; }
    return count;
}

const plugin: PluginCode = {
    settings,
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        days = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as unknown as Record<string, number> : {};
        ctx.messageEvents.onBeforeSend(() => {
            days = addMessage(days, Date.now());
            ctx.storage.set(KEY, days as never).catch(() => undefined);
            for (const listener of listeners) listener();
            return undefined;
        });
        addPanelTab(ctx, {
            title: "Message Stats",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: kit => {
                const now = Date.now();
                const total = Object.values(days).reduce((sum, count) => sum + count, 0);
                const goal = settings.store.dailyGoal;
                const line = (name: string, value: string) => kit.item(name, null, name, value, []);
                return kit.panel(kit.card([
                    kit.title("Messages you sent"),
                    line("Today", String(sumLast(days, now, 1))), line("Last 7 days", String(sumLast(days, now, 7))), line("Last 30 days", String(sumLast(days, now, 30))),
                    line("Total (last year)", String(total)), line(`Streak (goal ${goal} a day)`, `${streak(days, now, goal)} days`)
                ]));
            }
        });
    },
    stop() {
        listeners.clear();
        days = {};
    }
};

export default plugin;
