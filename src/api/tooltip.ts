/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A hover tooltip that looks like Discord's own and shows at once, for plugins that draw small pieces of their own (a mark next to a name, a badge): call `showTip(element, text)` on
// mouse enter and `hideTip()` on mouse leave. The browser's own `title` hover text is slow and plain; Discord's tooltip component cannot be asked for by a stable name (its code has
// been renamed from build to build), so this one is drawn here with the same look: the colours, radius, border, shadow and type were read from the style sheets of her running Discord
// (build 655747: `tooltip_*`, `tooltipContent_*`, `tooltipPointer_*`), using Discord's own colour variables, so it follows her theme. Only one tooltip is shown at a time.

const STYLE_ID = "amiricord-tooltip-style";
const TIP_ID = "amiricord-tooltip";
const GAP = 2;
const EDGE = 8;

export const TOOLTIP_CSS = `
#${TIP_ID} { position: fixed; z-index: 100000; pointer-events: none; box-sizing: border-box; max-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-subtle, rgb(255 255 255 / 8%)); background: var(--background-surface-high, #2b2d31); color: var(--text-default, #dbdee1); box-shadow: inset 0 0 0 1px var(--border-subtle, rgb(255 255 255 / 8%)), var(--shadow-high, 0 8px 16px rgb(0 0 0 / 24%)); font-size: 14px; font-weight: 500; line-height: 16px; overflow-wrap: break-word; animation: amiricord-tooltip-in 80ms ease-out; }
#${TIP_ID}::after { content: ""; position: absolute; left: var(--amiricord-tip-arrow, 50%); margin-left: -5px; width: 0; height: 0; border: 5px solid transparent; }
#${TIP_ID}[data-side="top"]::after { top: 100%; border-top-color: var(--background-surface-high, #2b2d31); }
#${TIP_ID}[data-side="bottom"]::after { bottom: 100%; border-bottom-color: var(--background-surface-high, #2b2d31); }
@keyframes amiricord-tooltip-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { #${TIP_ID} { animation: none; } }
`;

/** Where the tooltip goes: above the element when there is room, below it when not, kept inside the window; the arrow keeps pointing at the element. */
export function placeTip(target: { left: number; top: number; width: number; height: number; }, tip: { width: number; height: number; }, view: { width: number; height: number; }): { left: number; top: number; side: "top" | "bottom"; arrow: number; } {
    const above = target.top - tip.height - GAP >= EDGE;
    const side = above ? "top" : "bottom";
    const top = above ? target.top - tip.height - GAP : target.top + target.height + GAP;
    const centre = target.left + target.width / 2;
    const left = Math.min(Math.max(EDGE, centre - tip.width / 2), Math.max(EDGE, view.width - tip.width - EDGE));
    return { left, top: Math.min(top, Math.max(EDGE, view.height - tip.height - EDGE)), side, arrow: Math.min(Math.max(12, centre - left), Math.max(12, tip.width - 12)) };
}

function page(): Document | undefined {
    return (globalThis as unknown as { document?: Document; }).document;
}

/** Show the tooltip with `text` next to `target`, taking away the one that was shown. */
export function showTip(target: Element, text: string): void {
    const doc = page();
    if (!doc?.body || text === "") return;
    hideTip();
    if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = TOOLTIP_CSS;
        doc.head.append(style);
    }
    const tip = doc.createElement("div");
    tip.id = TIP_ID;
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    tip.style.visibility = "hidden";
    doc.body.append(tip);
    const rect = target.getBoundingClientRect();
    const view = doc.defaultView;
    const spot = placeTip(rect, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 });
    tip.setAttribute("data-side", spot.side);
    tip.style.setProperty("--amiricord-tip-arrow", `${spot.arrow}px`);
    tip.style.left = `${spot.left}px`;
    tip.style.top = `${spot.top}px`;
    tip.style.visibility = "";
}

/** Take the tooltip away. */
export function hideTip(): void {
    page()?.getElementById(TIP_ID)?.remove();
}
