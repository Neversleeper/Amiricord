/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A diagnostic for "Windows title bar": with the standard bar on, Discord's page still draws its own bar under it, and hiding it needs the name of that bar in the current build of
// Discord. A few seconds after the page loads, the shapes of the elements in the top 56 pixels of the page are written to the boot trace: tag, class names, role, place and size.
// No text is read, and the only label kept is the one of a window button (Minimize, Maximize, Restore, Close), so no name of a person or a channel can end up in the trace. At most 40
// lines per start. Nothing is sent anywhere. Never throws.

export const TOP_BAR_DELAY_MS = 8000;
const MAX_ROWS = 40;

/** Runs in Discord's page and returns rows of [tag, classes, role, window-button label, left, top, width, height]. Reads shapes only. */
export const TOP_BAR_SCRIPT = `(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top > 56 || r.height > 56) continue;
        const label = el.getAttribute("aria-label") || "";
        out.push([el.tagName.toLowerCase(), typeof el.className === "string" ? el.className.slice(0, 90) : "", el.getAttribute("role") || "",
            /^(minimize|maximize|restore|close)\\b/i.test(label) ? label.slice(0, 20) : "", Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
        if (out.length >= 60) break;
    }
    return out;
})()`;

/** The lines to write for what the script returned. Anything that is not the expected shape is skipped. */
export function topBarLines(rows: unknown): string[] {
    if (!Array.isArray(rows)) return ["top bar: the page gave no rows"];
    const lines: string[] = [];
    for (const row of rows) {
        if (lines.length >= MAX_ROWS) break;
        if (!Array.isArray(row) || row.length < 8) continue;
        const [tag, classes, role, label, left, top, width, height] = row as unknown[];
        if (typeof tag !== "string" || typeof classes !== "string" || typeof role !== "string" || typeof label !== "string") continue;
        if (![left, top, width, height].every(n => typeof n === "number")) continue;
        lines.push(`top bar: <${tag.slice(0, 20)}> class="${classes.replace(/\s+/g, " ").slice(0, 90)}"${role ? ` role=${role.slice(0, 20)}` : ""}${label ? ` label=${label}` : ""} at ${String(left)},${String(top)} size ${String(width)}x${String(height)}`);
    }
    return lines.length > 0 ? lines : ["top bar: no elements were found in the top of the page"];
}

/** The part of Electron's `webContents` used here. */
export interface PageLike {
    getURL?(): string;
    executeJavaScript?(code: string): Promise<unknown>;
    isDestroyed?(): boolean;
}

/** Write the top of the page to the trace once, after the delay, for a window that shows Discord's app. `schedule` is `setTimeout`, given so it can be tested. */
export function probeTopBar(page: PageLike, trace: (text: string) => void, schedule: (run: () => void, ms: number) => void = (run, ms) => { setTimeout(run, ms).unref(); }): void {
    try {
        schedule(() => {
            try {
                if (page.isDestroyed?.() === true || typeof page.executeJavaScript !== "function") return;
                if (!/discord\.com\/(app|channels|login)/.test(page.getURL?.() ?? "")) return;
                page.executeJavaScript(TOP_BAR_SCRIPT).then(rows => { for (const line of topBarLines(rows)) trace(line); }, (error: unknown) => {
                    trace(`top bar: could not be read: ${error instanceof Error ? error.message : String(error)}`);
                });
            } catch (error) {
                trace(`top bar: could not be read: ${error instanceof Error ? error.message : String(error)}`);
            }
        }, TOP_BAR_DELAY_MS);
    } catch {
        // A diagnostic must never disturb a window.
    }
}
