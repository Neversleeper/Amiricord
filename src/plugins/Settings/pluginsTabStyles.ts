/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of the Plugins tab. It builds on the classes of `styles.ts` (card, heading, hint, switch, button, confirm, divider) and adds
// what only this tab needs. Sizes follow TestCord's Plugins tab (grid of cards at least 330 px wide, 12 px gaps, 18 px padding on the top
// card, three or four filter boxes in a row). Colors come from Discord's CSS variables with a default each, like the rest.
// Classes start with `amiricord-plugin` so nothing here can touch Discord's own elements.

export const PLUGINS_TAB_STYLE_NAME = "plugins-tab";

export const PLUGINS_TAB_CSS = `
.amiricord-plugins-info { display: flex; align-items: center; justify-content: space-between; gap: var(--space-16, 16px); box-sizing: border-box; padding: 18px; margin-bottom: var(--space-16, 16px); background-color: var(--background-surface-high, var(--card-background-default, #2b2d31)); }
.amiricord-plugins-info-text { min-width: 0; }
.amiricord-plugins-info-title { font-family: var(--font-display, inherit); font-size: 16px; font-weight: 500; line-height: 1.25; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-plugins-info-text p { max-width: 520px; margin: 5px 0 0; font-size: 14px; line-height: 1.28571; color: var(--text-muted, #949ba4); }
.amiricord-plugins-restart { border-color: var(--text-feedback-warning, #f0b232); background-color: var(--background-feedback-warning, rgba(240, 178, 50, 0.1)); }
.amiricord-plugins-restart .amiricord-plugins-info-text p { color: var(--text-default, #dbdee1); }
.amiricord-plugins-restart-question { margin-bottom: var(--space-16, 16px); }
.amiricord-plugins-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: var(--space-8, 8px); }
.amiricord-plugins-stat { box-sizing: border-box; padding: 14px; transition: 0.1s ease-out; transition-property: box-shadow, transform; }
.amiricord-plugins-stat:hover { transform: translateY(-1px); box-shadow: var(--elevation-low, 0 1px 3px rgba(0, 0, 0, 0.3)); }
.amiricord-plugins-stat-title { font-size: 14px; font-weight: 500; color: var(--text-muted, #949ba4); }
.amiricord-plugins-stat-value { margin: 2px 0; font-size: 24px; font-weight: 600; line-height: 1.2; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-plugins-stat-hint { font-size: 13px; color: var(--text-subtle, var(--text-muted, #949ba4)); }
.amiricord-plugins-input, .amiricord-plugins-select { box-sizing: border-box; width: 100%; height: 40px; padding: 0 var(--space-12, 12px); border: 1px solid var(--input-border-default, var(--border-subtle, #3f4147)); border-radius: 4px; font: inherit; font-size: 14px; color: var(--input-text-default, var(--text-default, #dbdee1)); background: var(--input-background-default, var(--background-base-lowest, #1e1f22)); outline: none; }
.amiricord-plugins-input:focus, .amiricord-plugins-select:focus-visible { border-color: var(--border-focus, #00a8fc); }
.amiricord-plugins-select option { color: var(--text-default, #dbdee1); background: var(--background-base-lowest, #1e1f22); }
.amiricord-plugins-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: var(--space-8, 8px) 0; }
.amiricord-plugins-clear { display: inline-flex; width: auto; margin-bottom: var(--space-8, 8px); }
.amiricord-plugins-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); margin-top: 12px; margin-bottom: 1em; }
.amiricord-plugins-empty { margin-top: var(--space-8, 8px); }
.amiricord-plugin { display: flex; flex-direction: column; min-height: 148px; box-sizing: border-box; padding: 0; overflow: hidden; border-radius: 8px; color: var(--text-default, #dbdee1); transition: 0.1s ease-out; transition-property: box-shadow, background-color, opacity; }
.amiricord-plugin:hover { background-color: var(--background-surface-highest, var(--card-background-default, #2b2d31)); box-shadow: var(--elevation-low, 0 1px 3px rgba(0, 0, 0, 0.3)); }
.amiricord-plugin-off { opacity: 0.78; }
.amiricord-plugin-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8, 8px); box-sizing: border-box; padding: 14px 14px 8px; }
.amiricord-plugin-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 16px; font-weight: 700; line-height: 1.25; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-plugin-version { margin-left: var(--space-8, 8px); font-size: 12px; font-weight: 500; color: var(--text-muted, #949ba4); }
.amiricord-plugin-desc { flex: 1; margin: 0; padding: 0 14px 12px; font-size: 14px; line-height: 1.28571; color: var(--text-default, #dbdee1); overflow-wrap: anywhere; }
.amiricord-plugin-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.amiricord-plugin-badge { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 1.6; color: var(--text-muted, #949ba4); background: var(--background-mod-normal, #3a3c42); }
.amiricord-plugin-badge-info { color: var(--text-feedback-info, #00a8fc); background: var(--background-feedback-info, rgba(0, 168, 252, 0.1)); }
.amiricord-plugin-badge-warn { color: var(--text-feedback-warning, #f0b232); background: var(--background-feedback-warning, rgba(240, 178, 50, 0.1)); }
.amiricord-plugin-badge-danger { color: var(--text-feedback-critical, #fa777c); background: var(--background-feedback-critical, rgba(242, 63, 66, 0.1)); }
.amiricord-plugin-status { font-size: 13px; color: var(--text-subtle, var(--text-muted, #949ba4)); overflow-wrap: anywhere; }
.amiricord-plugin-status-problem, .amiricord-plugin-note-bad { color: var(--text-feedback-critical, #fa777c); }
.amiricord-plugin-compat { font-size: 13px; color: var(--text-feedback-warning, #f0b232); }
.amiricord-plugin-note { font-size: 13px; overflow-wrap: anywhere; }
.amiricord-plugin-note-ok { color: var(--text-feedback-positive, #5bd17f); }
.amiricord-plugin-note-info { color: var(--text-feedback-info, #00a8fc); }
.amiricord-plugin-switch { padding: 0; margin-top: 0; cursor: pointer; font: inherit; }
.amiricord-plugin-switch:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-plugin-switch[aria-disabled="true"] { cursor: not-allowed; opacity: 0.6; }
.amiricord-plugin-question { margin-top: var(--space-4, 4px); }
.amiricord-plugin-controls { display: flex; align-items: center; gap: 12px; }
.amiricord-plugin-details { all: unset; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; color: var(--text-muted, #949ba4); }
.amiricord-plugin-details:hover { color: var(--text-default, #dbdee1); }
.amiricord-plugin-details:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-plugin-details svg { width: 24px; height: 24px; }
.amiricord-pwin-title { font-size: 20px; font-weight: 600; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-pwin-desc { margin: 0 0 12px; font-size: 14px; line-height: 1.35; color: var(--text-default, #dbdee1); }
.amiricord-pwin-section { margin-top: 16px; padding: 12px 14px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1)); border-radius: 12px; background: var(--card-background-default, rgba(0, 0, 0, 0.18)); }
.amiricord-pwin-heading { margin-bottom: 8px; font-size: 18px; font-weight: 600; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-pwin-authors { display: flex; flex-wrap: wrap; gap: 8px; }
.amiricord-pwin-avatar { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex: none; }
.amiricord-pwin-author { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1)); border-radius: 8px; font-size: 14px; color: var(--text-default, #dbdee1); }
.amiricord-pwin-row { margin-top: 8px; padding: 10px 12px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1)); border-radius: 8px; background: var(--background-mod-subtle, rgba(255, 255, 255, 0.03)); }
.amiricord-pwin-row-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.amiricord-pwin-row-text { flex: 1; min-width: 0; }
.amiricord-pwin-row-title { font-size: 16px; font-weight: 500; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-pwin-row-desc { margin-top: 2px; font-size: 14px; line-height: 1.3; color: var(--text-subtle, var(--text-muted, #949ba4)); overflow-wrap: anywhere; }
.amiricord-pwin-control { flex-shrink: 0; max-width: 220px; }
.amiricord-pwin-switch { padding: 0; margin-top: 2px; cursor: pointer; font: inherit; flex-shrink: 0; }
.amiricord-pwin-switch:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-pwin-risky { color: var(--text-feedback-warning, #f0b232); }
.amiricord-pwin-error { margin-top: 6px; font-size: 13px; color: var(--text-feedback-critical, #fa777c); overflow-wrap: anywhere; }
.amiricord-pwin-note { margin-top: 6px; font-size: 13px; color: var(--text-feedback-info, #00a8fc); }
.amiricord-pwin-confirm { margin-top: 8px; }
.amiricord-pwin-empty { margin: 0; }
.amiricord-pwin-custom { margin-top: 8px; }
.amiricord-pwin-reset { margin-right: auto; }
.amiricord-plugin-extra { display: flex; flex-direction: column; gap: 6px; padding: 0 14px 12px; }
.amiricord-plugin-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8, 8px); min-height: 20px; margin-top: auto; padding: 10px 14px; border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1)); background-color: color-mix(in srgb, var(--background-base-low, #1e1f22) 72%, transparent); font-size: 13px; }
.amiricord-plugin-source { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; line-height: 18px; color: var(--text-muted, #949ba4); }
.amiricord-plugin-tags { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px; max-width: 72%; }
.amiricord-plugin-tag { display: inline-flex; align-items: center; box-sizing: border-box; max-width: 85px; height: 20px; padding: 0 6px; overflow: hidden; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1)); border-radius: 6px; background-color: var(--background-surface-high, rgba(255, 255, 255, 0.04)); font-size: 10px; font-weight: 600; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted, #949ba4); }
.amiricord-plugin-tags .amiricord-plugin-badge { display: inline-flex; align-items: center; box-sizing: border-box; height: 20px; padding: 0 6px; border-radius: 6px; font-size: 10px; font-weight: 700; line-height: 18px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
@media (width <= 760px) { .amiricord-plugins-info { flex-direction: column; align-items: flex-start; } .amiricord-plugins-grid { grid-template-columns: 1fr; } }
`;
