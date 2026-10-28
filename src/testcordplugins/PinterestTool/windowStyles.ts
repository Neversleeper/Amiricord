/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of the Pinterest Tool window. Colours come from the `--pt-*` variables that `theme.ts` builds (set on the window's own root), so the person's theme and
// light/dark choice apply here. Plain classes with a `pt-` prefix; nothing outside the window is touched.

export const WINDOW_CSS = `
.pt-window { display: flex; flex-direction: column; gap: 12px; min-height: 0; max-height: 100%; padding: 16px; color: var(--pt-text); background: var(--pt-bg); border-radius: 8px; }
.pt-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pt-title { margin: 0; font-size: 18px; font-weight: 700; flex: 1 1 auto; }
.pt-tabs { display: flex; gap: 4px; }
.pt-button, .pt-chip, .pt-input, .pt-select { font: inherit; color: var(--pt-text); background: var(--pt-input); border: 1px solid var(--pt-border); border-radius: 6px; padding: 6px 10px; }
.pt-button, .pt-chip { cursor: pointer; }
.pt-button:hover:not(:disabled), .pt-chip:hover { background: var(--pt-hover); }
.pt-button:disabled { opacity: 0.5; cursor: default; }
.pt-button-primary, .pt-tab-on { color: var(--pt-accent-contrast); background: var(--pt-accent); border-color: var(--pt-accent); }
.pt-button-primary:hover:not(:disabled) { background: var(--pt-accent-hover); }
.pt-chip { padding: 2px 10px; border-radius: 999px; font-size: 12px; }
.pt-input { flex: 1 1 220px; min-width: 0; }
.pt-muted { color: var(--pt-muted); font-size: 12px; }
.pt-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pt-error { padding: 8px 10px; border: 1px solid var(--pt-border); border-radius: 6px; background: var(--pt-raised); }
.pt-notice { color: var(--pt-accent-text); font-size: 12px; min-height: 16px; }
.pt-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.pt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.pt-grid-banner { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.pt-card { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--pt-border); border-radius: 8px; background: var(--pt-surface); }
.pt-pic { position: relative; aspect-ratio: 1 / 1; background: var(--pt-raised); }
.pt-grid-banner .pt-pic { aspect-ratio: 16 / 9; }
.pt-pic img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pt-badge { position: absolute; left: 6px; top: 6px; padding: 0 6px; border-radius: 4px; font-size: 11px; color: var(--pt-accent-contrast); background: var(--pt-accent); }
.pt-card-foot { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; }
.pt-card-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-heart, .pt-edit { align-self: flex-start; cursor: pointer; font: inherit; font-size: 12px; color: var(--pt-text); background: transparent; border: 1px solid var(--pt-border); border-radius: 999px; padding: 1px 8px; }
.pt-heart-on { color: var(--pt-accent-contrast); background: var(--pt-accent); border-color: var(--pt-accent); }
.pt-more { display: flex; justify-content: center; padding: 12px 0; }
.pt-editor { display: flex; flex-direction: column; gap: 12px; }
.pt-editor-body { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.pt-editor-preview { flex: 1 1 320px; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.pt-editor-tools { flex: 1 1 280px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pt-canvas { max-width: 100%; max-height: 360px; border: 1px solid var(--pt-border); border-radius: 8px; background: var(--pt-raised); cursor: grab; touch-action: none; }
.pt-canvas-banner { width: 100%; }
.pt-slider { display: grid; grid-template-columns: 110px 1fr 40px; gap: 8px; align-items: center; font-size: 13px; }
.pt-slider input[type="range"] { width: 100%; accent-color: var(--pt-accent); }
`;
