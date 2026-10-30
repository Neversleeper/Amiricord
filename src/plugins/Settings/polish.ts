/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A last layer of style over the Amiricord tabs (added after `styles.ts` and `pluginsTabStyles.ts`, so it wins on equal footing): a wider page, smoother movement, clear
// keyboard focus, thin scrollbars and a short fade when a tab opens. Everything is scoped to `.amiricord-tab` or to the Discord elements that hold it (found with `:has`),
// so no other settings page changes. The widening was checked live on Discord build 655747: the page sits inside `panel_` (with `categories_`, `container_` and `stack_` wrappers, a different number on each tab), and the panel caps its width at 696px; if Discord renames these, the page just stays at its old width (nothing breaks).

export const POLISH_STYLE_NAME = "polish";

export const POLISH_CSS = `
[class*="panel_"]:has(.amiricord-tab) { max-width: min(1100px, 100%) !important; }
[class*="panel_"]:has(.amiricord-tab) :is([class*="categories_"], [class*="container_"], [class*="stack_"]):has(.amiricord-tab) { max-width: none !important; width: 100% !important; }
[class*="scroller_"]:has(.amiricord-tab) { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--text-default, #dbdee1) 28%, transparent) transparent; }

.amiricord-plugins-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }

.amiricord-tab > * { animation: amiricord-polish-in 220ms ease-out both; }
.amiricord-tab > *:nth-child(2) { animation-delay: 30ms; }
.amiricord-tab > *:nth-child(3) { animation-delay: 60ms; }
.amiricord-tab > *:nth-child(n+4) { animation-delay: 90ms; }
@keyframes amiricord-polish-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.amiricord-card, .amiricord-plugin, .amiricord-chip, .amiricord-action, .amiricord-button, .amiricord-plugins-stat, .amiricord-plugins-chip, .amiricord-plugins-select {
    transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, filter 160ms ease;
}
.amiricord-plugin:hover, .amiricord-chip:hover, .amiricord-plugins-stat:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgb(0 0 0 / 22%); }
.amiricord-action:hover, .amiricord-button:hover { filter: brightness(1.08); }
.amiricord-action:active, .amiricord-button:active { transform: translateY(1px); filter: brightness(0.96); }

.amiricord-tab :is(button, a, input, select, textarea, [role="switch"], [tabindex]):focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-plugins-input:focus, .amiricord-plugins-select:focus { border-color: var(--amiricord-accent, #f2f3f5); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 22%, transparent); }

@media (prefers-reduced-motion: reduce) {
    .amiricord-tab, .amiricord-tab * { animation: none !important; transition: none !important; }
    .amiricord-plugin:hover, .amiricord-chip:hover, .amiricord-plugins-stat:hover { transform: none; }
}
`;
