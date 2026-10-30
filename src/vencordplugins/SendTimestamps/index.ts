/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SendTimestamps (authors Ven, Tyler) as found in TestCord's copy of Vencord's plugins. Same conversion (the next time that clock time happens, shown as a short time). Only the message-text replacement is ported; the original's picker window is not. Text in code spans and inside links is left alone.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    replaceMessageContents: { type: "boolean", default: true, description: "Replace times between angle brackets in the messages you send" }
});

/** `<9:30pm>` as a Discord timestamp of the next time that clock time comes; anything that is not a time stays as it is. */
export function parseTime(time: string, now = new Date()): string {
    const clean = time.slice(1, -1).replace(/(\d)(AM|PM)$/i, "$1 $2");
    let seconds = new Date(`${now.toDateString()} ${clean}`).getTime() / 1000;
    if (Number.isNaN(seconds)) return time;
    if (now.getTime() / 1000 > seconds) seconds += 86400;
    return `<t:${Math.round(seconds)}:t>`;
}

/** A message with every `<hh:mm>` in it replaced, leaving code and links alone. */
export function replaceTimes(content: string, now = new Date()): string {
    return content.replace(/`[^`]+`|https?:\/\/\S+|(<\d{1,2}:\d{2}(?: ?[AP]M)?>)/gi, (match, time: string | undefined) => time ? parseTime(time, now) : match);
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        ctx.messageEvents.onBeforeSend(content => settings.store.replaceMessageContents ? replaceTimes(content) : undefined);
    }
};

export default plugin;
