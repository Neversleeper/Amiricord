/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Export, Import and Verify buttons that GifTransfer adds to the tab bar of Discord's GIF picker, and the watching that keeps them there only while the GIF tab is
// open. Plain page elements (no React). Adapted for Amiricord (2026) from the plugin GifTransfer (authors nnenaza and x2b) as found in TestCord (commit af92dba).

export const BUTTONS_ID = "gif-transfer-buttons";
export const POLL_MS = 10_000;

/**
 * How the buttons look, written on each element and not in a style sheet: the tab bar of Discord's picker draws its own children, so a rule that reaches them from
 * outside may not apply. The text colour is read from one of the picker's own tabs (so it is the colour of "Stickers" and "Emojis" in any theme); the border takes
 * the same colour, and the highlight when the mouse is over is a see-through grey that works on dark and light themes.
 */
export const HOLDER_STYLE = "display: flex; align-items: center; margin-left: auto; padding-right: 8px; gap: 4px; pointer-events: auto;";
/** The text colour when the tabs' own cannot be read: Discord's muted text grey. */
export const FALLBACK_COLOR = "#b5bac1";
export const HOVER_BACKGROUND = "rgba(128, 128, 128, 0.25)";
export const buttonStyle = (color: string) => `background: transparent; border: 1px solid currentColor; border-radius: 6px; color: ${color}; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; padding: 2px 8px; margin: 0 2px; height: 24px; line-height: 1; white-space: nowrap; flex-shrink: 0; pointer-events: auto;`;

/** A colour that can be used for text: not empty and not see-through. */
export const usableColor = (color: string | undefined) => (color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color) ? color : undefined);

export type ButtonAction = "export" | "import" | "verify" | "clear";

const LABELS: Array<{ action: ButtonAction; label: string; title: string; }> = [
    { action: "export", label: "Export", title: "Export favorite GIFs to JSON file" },
    { action: "import", label: "Import", title: "Import favorite GIFs from JSON file (skips duplicates)" },
    { action: "verify", label: "Verify", title: "Check which GIFs from a file are missing from your favorites" },
    { action: "clear", label: "Delete all", title: "Delete ALL your favorite GIFs (asks first; Export a copy before)" }
];

/** Words in the name of the tab bar of Discord's expression picker, in English and Spanish. */
const TAB_BAR_WORDS = ["expresi", "expression", "categor", "selector", "picker"];

export interface ButtonsPage {
    document: Document;
    MutationObserver: new (callback: () => void) => { observe(target: Node, options: { childList: boolean; subtree: boolean; }): void; disconnect(): void; };
    requestAnimationFrame(run: () => void): unknown;
    /** The look of an element as the page draws it (used to take the colour of the picker's own tabs). */
    getComputedStyle?(element: Element): { color: string; };
    setInterval(run: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export function makeButtons(page: ButtonsPage, run: (action: ButtonAction) => void) {
    const { document: doc } = page;
    let observer: { disconnect(): void; } | undefined;
    let poll: unknown;
    let queued = false;
    let active = false;

    const container = () => doc.getElementById(BUTTONS_ID);

    function onClick(event: Event) {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== "function") return;
        const button = target.closest("[data-gif-transfer-action]");
        const holder = container();
        if (!button || !holder || !holder.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        run(button.getAttribute("data-gif-transfer-action") as ButtonAction);
    }

    function inject(tabBar: Element) {
        if (tabBar.querySelector(`#${BUTTONS_ID}`)) return;
        const wrapper = doc.createElement("div");
        wrapper.id = BUTTONS_ID;
        wrapper.setAttribute("style", HOLDER_STYLE);
        // The colour of a tab that is not the open one: that is how "Stickers" and "Emojis" look.
        const sample = tabBar.querySelector("[role=\"tab\"][aria-selected=\"false\"]") ?? tabBar.querySelector("[role=\"tab\"]");
        const color = (sample && usableColor(page.getComputedStyle?.(sample).color)) || FALLBACK_COLOR;
        for (const { action, label, title } of LABELS) {
            const button = doc.createElement("button");
            button.textContent = label;
            button.title = title;
            button.setAttribute("data-gif-transfer", "true");
            button.setAttribute("data-gif-transfer-action", action);
            button.type = "button";
            button.setAttribute("style", buttonStyle(color));
            button.addEventListener("mouseenter", () => { button.style.background = HOVER_BACKGROUND; });
            button.addEventListener("mouseleave", () => { button.style.background = "transparent"; });
            wrapper.append(button);
        }
        (tabBar as HTMLElement).style.display = "flex";
        (tabBar as HTMLElement).style.alignItems = "center";
        tabBar.append(wrapper);
    }

    /** Puts the buttons in the tab bar when the GIF tab is the open one, and takes them out otherwise. */
    function look() {
        if (doc.getElementById("gif-picker-tab") === null) {
            container()?.remove();
            return;
        }
        for (const bar of doc.querySelectorAll("[role=\"tablist\"]")) {
            const label = (bar.getAttribute("aria-label") ?? "").toLowerCase();
            if (!TAB_BAR_WORDS.some(word => label.includes(word))) continue;
            const open = bar.querySelector("[role=\"tab\"][aria-selected=\"true\"]");
            const isGif = open?.textContent?.trim().toUpperCase() === "GIF" || Boolean(open?.closest("[id*=gif-picker]"));
            if (isGif) inject(bar);
            else bar.querySelector(`#${BUTTONS_ID}`)?.remove();
            return;
        }
    }

    function schedule() {
        if (queued) return;
        queued = true;
        page.requestAnimationFrame(() => { queued = false; look(); });
    }

    return {
        start() {
            if (active) return;
            active = true;
            doc.addEventListener("click", onClick, true);
            const watcher = new page.MutationObserver(schedule);
            watcher.observe(doc.body, { childList: true, subtree: true });
            observer = watcher;
            poll = page.setInterval(() => { if (!doc.hidden) look(); }, POLL_MS);
            look();
        },
        stop() {
            active = false;
            doc.removeEventListener("click", onClick, true);
            observer?.disconnect();
            observer = undefined;
            queued = false;
            if (poll !== undefined) page.clearInterval(poll);
            poll = undefined;
            for (const holder of doc.querySelectorAll(`#${BUTTONS_ID}`)) holder.remove();
        }
    };
}
