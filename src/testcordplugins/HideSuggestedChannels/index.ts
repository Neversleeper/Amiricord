/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin HideSuggestedChannels (author Aviv) as found in TestCord. Same idea: when Discord draws a "Suggested" section in the channel list, press its own dismiss button. Changes: it looks at the page a moment after it changed (not on every single change), each section is dismissed once, and the header text is a setting so it also works in a Discord that is not in English. NOT seen on a real "Suggested" section (her test server has none).

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    headerText: { type: "string", default: "Suggested", maxLength: 60, description: "The title of the section, as your Discord shows it (change it if your Discord is not in English)" }
});

/** Whether a header's text is the one to dismiss (the same words, spaces and capitals aside). */
export function isSuggestedHeader(text: string | null | undefined, wanted: string): boolean {
    const clean = (text ?? "").trim().toLowerCase();
    return clean !== "" && clean === wanted.trim().toLowerCase();
}

const SCAN_DELAY_MS = 250;
let stop: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start() {
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const dismissed = new WeakSet<Element>();
        const scan = () => {
            const scope = page.querySelector("ul[aria-label=\"Channels\"]") ?? page.body;
            for (const header of scope.querySelectorAll("h3")) {
                if (!isSuggestedHeader(header.textContent, settings.store.headerText)) continue;
                const item = header.closest("li");
                if (!item || dismissed.has(item)) continue;
                const button = item.querySelector<HTMLElement>("[role=\"button\"]");
                if (!button) continue;
                dismissed.add(item);
                button.click();
            }
        };
        let timer: number | undefined;
        const queue = () => {
            if (timer !== undefined) return;
            timer = view.setTimeout(() => { timer = undefined; scan(); }, SCAN_DELAY_MS);
        };
        const observer = new view.MutationObserver(queue);
        observer.observe(page.body, { childList: true, subtree: true });
        queue();
        stop = () => {
            observer.disconnect();
            if (timer !== undefined) view.clearTimeout(timer);
        };
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
