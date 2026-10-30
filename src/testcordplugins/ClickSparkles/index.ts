/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ClickSparkles (author Sharp) as found in TestCord. Same neon sparkles on every click. New here: the number of sparkles is a setting, no more than 80 are alive at the same time (a fast clicker cannot slow the page down), and nothing is drawn when the system asks for less motion.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    amount: { type: "number", default: 6, min: 1, max: 16, integer: true, description: "How many sparkles each click makes" }
});

export const COLORS = ["#ff71ce", "#01cdfe", "#b967ff", "#05ffa1"] as const;
export const MAX_ALIVE = 80;

export interface Sparkle { dx: number; dy: number; color: string; }

/** The flight of each sparkle of one click. `random` gives numbers from 0 up to (not including) 1. */
export function sparklesFor(amount: number, random: () => number): Sparkle[] {
    const count = Math.max(0, Math.min(16, Math.floor(amount)));
    return Array.from({ length: count }, () => ({
        dx: Math.round(random() * 40 - 20),
        dy: Math.round(-random() * 40 - 10),
        color: COLORS[Math.min(COLORS.length - 1, Math.floor(random() * COLORS.length))]
    }));
}

const CSS = `
.amiricord-sparkle { position: fixed; z-index: 99999; pointer-events: none; font-size: 14px; transform: translate(-50%, -50%); animation: amiricord-sparkle 700ms ease-out forwards; text-shadow: 0 0 6px currentColor; }
@keyframes amiricord-sparkle {
    from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    to { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.2); }
}
`;

let stopListening: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        ctx.addStyle(CSS, "click-sparkles");
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        let alive = 0;
        const burst = (event: MouseEvent) => {
            if (view.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
            for (const sparkle of sparklesFor(settings.store.amount, Math.random)) {
                if (alive >= MAX_ALIVE) return;
                const span = page.createElement("span");
                span.className = "amiricord-sparkle";
                span.textContent = "✦";
                span.style.left = `${event.clientX}px`;
                span.style.top = `${event.clientY}px`;
                span.style.color = sparkle.color;
                span.style.setProperty("--dx", `${sparkle.dx}px`);
                span.style.setProperty("--dy", `${sparkle.dy}px`);
                alive++;
                span.addEventListener("animationend", () => { alive--; span.remove(); }, { once: true });
                page.body.appendChild(span);
            }
        };
        page.addEventListener("click", burst);
        stopListening = () => {
            page.removeEventListener("click", burst);
            for (const span of page.querySelectorAll(".amiricord-sparkle")) span.remove();
        };
    },
    stop() {
        stopListening?.();
        stopListening = undefined;
    }
};

export default plugin;
