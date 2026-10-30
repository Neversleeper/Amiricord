/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CharacterCounter (authors thororen, creations) as found in TestCord's copy of Vencord's plugins. The original patches Discord's message box; this one is a small label added by hand above the right end of the box and updated a few times a second while you type. The limit is read from your account (4000 with Nitro, 2000 otherwise). The count of selected characters is not ported. Not checked against this Discord build beyond the class names.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    colorEffects: { type: "boolean", default: true, description: "Colour the counter yellow and red as you get closer to the limit" }
});

const CSS = `
[data-amiricord-counter] { position: absolute; right: 12px; top: -20px; font-size: 12px; font-weight: 600; pointer-events: none; z-index: 2; }
`;

/** The colour of the counter for how full the message is (0 to 100 or more). */
export function counterColor(percentage: number, colored: boolean): string {
    if (!colored) return "var(--text-muted)";
    if (percentage < 50) return "var(--text-muted)";
    if (percentage < 75) return "var(--yellow-330, #f0b232)";
    if (percentage < 90) return "var(--orange-330, #f57731)";
    return "var(--red-360, #f23f42)";
}

/** The length of what is written in the box: the browser adds a line break at the end of an empty box, which does not count. */
export function textLength(text: string): number {
    return [...text.replace(/\n$/, "")].length;
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.addStyle(CSS, "character-counter");
        const users = ctx.common.UserStore;
        const counter = document.createElement("div");
        counter.setAttribute("data-amiricord-counter", "");
        const timer = setInterval(() => {
            const box = document.querySelector("[role=\"textbox\"][data-slate-editor]") as HTMLElement | null;
            const holder = box?.closest("[class*=\"channelTextArea\"]") as HTMLElement | null;
            if (!box || !holder) { counter.remove(); return; }
            const length = textLength(box.innerText);
            if (length === 0) { counter.remove(); return; }
            const premium = (users.get()?.getCurrentUser() as { premiumType?: number; } | undefined)?.premiumType === 2;
            const max = premium ? 4000 : 2000;
            if (counter.parentElement !== holder) holder.append(counter);
            if (!holder.style.position) holder.style.position = "relative";
            const text = String(length);
            if (counter.textContent !== text) counter.textContent = text;
            counter.style.color = counterColor(length / max * 100, settings.store.colorEffects);
            counter.title = `${length} of ${max} characters`;
        }, 250);
        ctx.onDispose(() => { clearInterval(timer); counter.remove(); });
    }
};

export default plugin;
