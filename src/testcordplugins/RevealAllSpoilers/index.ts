/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RevealAllSpoilers (authors whqwert, x2b) as found in TestCord. The original patches the function that removes the blur; this one listens for the click on the page and then clicks each hidden spoiler it finds (found by words in Discord's class names: spoilerContent, hiddenSpoiler, obscured, spoilerContainer). If Discord renames those, nothing is revealed (nothing breaks). Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    autoReveal: { type: "boolean", default: false, description: "Reveal every spoiler without holding Ctrl (you will not see spoilers at all)" }
});

export const HIDDEN_SELECTORS = [
    "[class*=\"spoilerContent\"][class*=\"hidden\"]",
    "[class*=\"hiddenSpoiler\"][class*=\"hidden\"]",
    "[class*=\"obscured\"][class*=\"hidden\"]",
    "[class*=\"spoilerContainer\"][class*=\"hidden\"]"
];
const SPOILER_WORDS = "[class*=\"spoilerContent\"], [class*=\"obscured\"], [class*=\"hiddenSpoiler\"], [class*=\"spoilerContainer\"]";

/** Clicks every hidden spoiler under `root` once; returns how many. */
export function revealIn(root: ParentNode): number {
    const seen = new Set<Element>();
    let count = 0;
    for (const selector of HIDDEN_SELECTORS) {
        for (const element of root.querySelectorAll(selector)) {
            if (seen.has(element)) continue;
            seen.add(element);
            element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            count++;
        }
    }
    return count;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        let busy = false;
        const onClick = (event: MouseEvent) => {
            if (busy || !event.ctrlKey || !(event.target instanceof Element)) return;
            const hit = event.target.closest(SPOILER_WORDS);
            if (!hit) return;
            const root = event.shiftKey
                ? document.querySelector("[class*=\"messagesWrapper\"]")
                : hit.closest("li[id^=\"chat-messages-\"]") ?? hit.parentElement;
            if (!root) return;
            busy = true;
            try { revealIn(root); } finally { busy = false; }
        };
        document.addEventListener("click", onClick, true);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const observer = new MutationObserver(() => {
            if (!settings.store.autoReveal || timer) return;
            timer = setTimeout(() => { timer = undefined; busy = true; try { revealIn(document); } finally { busy = false; } }, 200);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        ctx.onDispose(() => {
            document.removeEventListener("click", onClick, true);
            observer.disconnect();
            if (timer) clearTimeout(timer);
        });
    }
};

export default plugin;
