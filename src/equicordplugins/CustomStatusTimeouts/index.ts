/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CustomStatusTimeouts (authors Kiri, thororen) as found in Equicord's copy of Vencord's plugins. Same patch and same lists. The original needs a restart after each change; here the list is built when Discord opens the menu, so a change shows at once. Weeks and months stay at the three weeks and two months the original found to work.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const MILLIS = { SECOND: 1e3, MINUTE: 6e4, HOUR: 36e5, DAY: 864e5, WEEK: 6048e5, DAYS_30: 2592e6 };

const settings = definePluginSettings({
    showForeverOnTop: { type: "boolean", default: true, description: "Show the Forever choice at the top of the list instead of the bottom" },
    extraSeconds: { type: "string", default: "15, 30, 45", description: "Seconds to add, separated by commas (for example 5, 10, 30)" },
    extraMinutes: { type: "string", default: "5, 10, 30", description: "Minutes to add, separated by commas" },
    extraHours: { type: "string", default: "2, 4, 6, 12", description: "Hours to add, separated by commas" },
    extraDays: { type: "string", default: "1, 2", description: "Days to add, separated by commas" }
});

interface Timeout { duration?: number; label: () => string; }

/** The numbers in a "5, 10, 30" list; anything that is not a number is dropped. */
export function parseNumbers(text: string): number[] {
    return text.split(",").map(part => Number(part.trim())).filter(Boolean);
}

const choices = (values: number[], unit: number, singular: string, plural: string): Timeout[] =>
    values.map(value => ({ duration: value * unit, label: () => `For ${value} ${value === 1 ? singular : plural}` }));

/** The choices Discord has plus the extra ones, shortest first, "forever" (no duration) at the top or the bottom. */
export function buildTimeouts(existing: Timeout[], store: { showForeverOnTop: boolean; extraSeconds: string; extraMinutes: string; extraHours: string; extraDays: string; }): Timeout[] {
    // Weeks and months other than these did not apply when the original was tested
    const extra = [
        ...choices(parseNumbers(store.extraSeconds), MILLIS.SECOND, "Second", "Seconds"),
        ...choices(parseNumbers(store.extraMinutes), MILLIS.MINUTE, "Minute", "Minutes"),
        ...choices(parseNumbers(store.extraHours), MILLIS.HOUR, "Hour", "Hours"),
        ...choices(parseNumbers(store.extraDays), MILLIS.DAY, "Day", "Days"),
        ...choices([1, 2, 3], MILLIS.WEEK, "Week", "Weeks"),
        ...choices([2, 4], MILLIS.DAYS_30, "Month", "Months")
    ];
    return [...existing, ...extra].sort((a, b) => {
        if (a.duration === undefined) return store.showForeverOnTop ? -1 : 1;
        if (b.duration === undefined) return store.showForeverOnTop ? 1 : -1;
        return a.duration - b.duration;
    });
}

const plugin: PluginCode & { buildTimeouts(existing: Timeout[]): Timeout[]; } = {
    settings,
    patches: [
        {
            find: "#{intl::DURATION_FOREVER}",
            lazy: true,
            required: false,
            replacements: [{ match: /\[\{duration.*?#{intl::DURATION_FOREVER}\)\}\]/, replace: "$self.buildTimeouts($&)" }]
        }
    ],

    buildTimeouts(existing) {
        return buildTimeouts(existing, settings.store);
    }
};

export default plugin;
