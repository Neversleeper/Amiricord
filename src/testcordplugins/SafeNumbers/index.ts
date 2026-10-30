/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SafeNumbers (author x2b) as found in TestCord. Same table of digits and same rule (links and Discord's own `<...>` markup are left alone). The original also changed edits and has its switch in an icon; here the switch is a button next to the message box, and only sent messages change (the engine has no hook for edits yet).

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const DIGITS: Record<string, string> = { 0: "𝟶", 1: "𝟷", 2: "𝟸", 3: "𝟹", 4: "𝟺", 5: "𝟻", 6: "𝟼", 7: "𝟽", 8: "𝟾", 9: "𝟿" };

/** The text with every digit replaced by its look-alike, except inside links and Discord's `<...>` markup. */
export function replaceDigits(content: string): string {
    const parts: string[] = [];
    let last = 0;
    const protectedText = /<[^>]+>|https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    let found: RegExpExecArray | null;
    while ((found = protectedText.exec(content)) !== null) {
        if (found.index > last) parts.push(content.slice(last, found.index).replace(/\d/g, digit => DIGITS[digit] ?? digit));
        parts.push(found[0]);
        last = found.index + found[0].length;
    }
    if (last < content.length) parts.push(content.slice(last).replace(/\d/g, digit => DIGITS[digit] ?? digit));
    return parts.join("");
}

const settings = definePluginSettings({
    isActive: { type: "boolean", default: true, description: "Write digits as look-alike digits in the messages you send" }
});

const plugin: PluginCode = {
    settings,
    start(ctx) {
        ctx.messageEvents.onBeforeSend(content => settings.store.isActive ? replaceDigits(content) : content);
        ctx.chatBar.add({
            id: "safe-numbers",
            label: () => settings.store.isActive ? "Safe Numbers: on" : "Safe Numbers: off",
            icon: { viewBox: "0 0 24 24", path: "M5 3h4v2H7v14h2v2H5V3zm14 0v18h-4v-2h2V5h-2V3h4zM9 8h6v2H9V8zm0 6h6v2H9v-2z" },
            active: () => settings.store.isActive,
            onClick: () => { settings.store.isActive = !settings.store.isActive; ctx.chatBar.refresh(); }
        });
    }
};

export default plugin;
