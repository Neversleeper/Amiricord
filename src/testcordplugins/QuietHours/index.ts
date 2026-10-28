/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin QuietHours (author Sharp) as found in TestCord's plugins (commit af92dba). Same behaviour,
// written against Amiricord's engine. Differences, none of them tried in a real Discord yet:
//  - the hours are whole numbers from 0 to 23 (the settings say so; the original accepted any number);
//  - the plugin waits for Discord's sound module instead of looking once, and if it never shows up the start fails and is reported, instead of
//    the plugin looking switched on while doing nothing;
//  - on stop the original sound function is put back only if it is still ours, so a plugin that wrapped it after us is not undone;
//  - the description no longer has the broken characters of the original.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    start: { type: "number", default: 23, min: 0, max: 23, integer: true, description: "Quiet hours start (hour of the day, 0 to 23)" },
    end: { type: "number", default: 8, min: 0, max: 23, integer: true, description: "Quiet hours end (hour of the day, 0 to 23)" }
});

/** Whether `hour` is inside the window. The window may pass midnight (23 to 8); when start and end are the same hour it is empty. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

interface SoundModule {
    playSound(...args: unknown[]): unknown;
}

let hooked: { module: SoundModule; original: SoundModule["playSound"]; ours: SoundModule["playSound"]; } | undefined;

const plugin: PluginCode = {
    settings,

    async start(ctx) {
        const module = await ctx.finders.byProps<SoundModule>("playSound", "createSound").ready();
        const original = module.playSound;
        const ours = function (this: unknown, ...args: unknown[]) {
            if (inQuietHours(new Date().getHours(), settings.store.start, settings.store.end)) return undefined;
            return original.apply(module, args);
        };
        module.playSound = ours;
        hooked = { module, original, ours };
    },

    stop() {
        if (hooked && hooked.module.playSound === hooked.ours) hooked.module.playSound = hooked.original;
        hooked = undefined;
    }
};

export default plugin;
