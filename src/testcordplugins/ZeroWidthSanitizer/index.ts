/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ZeroWidthSanitizer (author Irritably) as found in TestCord. It takes the invisible characters out of the messages you send, so text pasted from somewhere cannot carry a hidden mark.
// Changes: the original also took out the joiner of emoji (a family or a flag with a skin colour broke), the joiner of Persian and Indic scripts, and the left-to-right and right-to-left marks (Arabic and Hebrew text broke). Here those are kept by default; the direction marks have a setting of their own. It works on the messages you send; edits are NOT covered (the engine has no hook for them).
// Not seen live: the toast and a real send were not tried.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showToast: { type: "boolean", default: true, description: "Tell you when invisible characters were taken out of a message" },
    removeDirectionMarks: { type: "boolean", default: false, description: "Also take out the left-to-right and right-to-left marks (they are needed to write Arabic and Hebrew with numbers or English words)" }
});

// Always taken out: zero-width space, word joiner and invisible operators, soft hyphen, byte order mark, Mongolian vowel separator.
const ALWAYS = /[​⁠-⁤⁪-⁯﻿­᠎]/gu;
const DIRECTION = /[‎‏‪-‮]/gu;
const JOINER = "‍";
const NON_JOINER = "‌";
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|️|⃣/u;
// Scripts that write with the non-joiner (Persian, Urdu and the Indic scripts).
const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}]/u;

export interface SanitizeOptions { removeDirectionMarks: boolean; }

/** The text without hidden characters, and how many were taken out. */
export function sanitize(text: string, options: SanitizeOptions): { result: string; removed: number; } {
    let removed = 0;
    const count = () => { removed++; return ""; };
    let result = text.replace(ALWAYS, count);
    if (options.removeDirectionMarks) result = result.replace(DIRECTION, count);
    if (result.includes(JOINER) || result.includes(NON_JOINER)) {
        const chars = [...result];
        const kept: string[] = [];
        for (const [index, char] of chars.entries()) {
            const before = chars[index - 1] ?? "";
            const after = chars[index + 1] ?? "";
            if (char === JOINER && (PICTOGRAPH.test(before) || PICTOGRAPH.test(after))) { kept.push(char); continue; }
            if (char === NON_JOINER && (JOINING_SCRIPT.test(before) || JOINING_SCRIPT.test(after))) { kept.push(char); continue; }
            if (char === JOINER || char === NON_JOINER) { removed++; continue; }
            kept.push(char);
        }
        result = kept.join("");
    }
    return { result, removed };
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        ctx.messageEvents.onBeforeSend(content => {
            const { result, removed } = sanitize(content, { removeDirectionMarks: settings.store.removeDirectionMarks });
            if (removed === 0) return undefined;
            if (settings.store.showToast) ctx.toasts.show(`Took ${removed} invisible ${removed === 1 ? "character" : "characters"} out of your message.`, "info");
            return result;
        });
    }
};

export default plugin;
