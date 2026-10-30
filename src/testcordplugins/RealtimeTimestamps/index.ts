/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RealtimeTimestamps (author x2b) as found in TestCord, which patched the code that draws a timestamp and redrew every timestamp every second. Here the seconds are added to the time Discord already wrote ("Today at 3:25 AM" becomes "Today at 3:25:41 AM"), so the language and the 12 or 24 hour clock stay what Discord shows, and nothing is redrawn on a timer: each message's own time never changes, so it is done once when the message shows. The seconds come from the `datetime` of the `<time>` element of the message.
// NOT seen on a real message yet when this was written; see the log of the owner.

import type { PluginCode } from "../../renderer/engine";

const CLOCK = /(?<![\d:])(\d{1,2}):(\d{2})(?![:\d])/;

/** The text with the seconds of `date` put after the first hour:minute in it; the text unchanged when it has none or already shows seconds. */
export function withSeconds(text: string, date: Date): string {
    if (Number.isNaN(date.getTime())) return text;
    return text.replace(CLOCK, (_whole, hour: string, minute: string) => `${hour}:${minute}:${String(date.getSeconds()).padStart(2, "0")}`);
}

const SELECTOR = "li[id^=\"chat-messages-\"] time[datetime]";
const SCAN_DELAY_MS = 200;
let stop: (() => void) | undefined;

const plugin: PluginCode = {
    start() {
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const scan = () => {
            for (const element of page.querySelectorAll(SELECTOR)) {
                const date = new Date(element.getAttribute("datetime") ?? "");
                // Only text nodes are changed, in place, so Discord's own drawing code is never confused.
                for (const node of element.childNodes) {
                    if (node.nodeType !== 3 || node.nodeValue === null) continue;
                    const text = withSeconds(node.nodeValue, date);
                    if (text !== node.nodeValue) node.nodeValue = text;
                }
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
