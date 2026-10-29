/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of the Plugins tab. It builds on the classes of `styles.ts` (card, heading, hint, switch, button, confirm, divider) and adds
// what only this tab needs: a header with the count of plugins that are on and a bar that shows it, a search box with a magnifier, filters,
// and cards with a round letter mark, a quiet footer and a glow when the plugin is on. Colors come from Discord's CSS variables with a default
// each, like the rest, so the tab follows the owner's theme. The hue of each letter mark is set by the card itself (`--amiricord-hue`).
// Classes start with `amiricord-plugin` so nothing here can touch Discord's own elements.

export const PLUGINS_TAB_STYLE_NAME = "plugins-tab";

export const PLUGINS_TAB_CSS = `
.amiricord-plugins-info { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--space-24, 24px); box-sizing: border-box; padding: 22px 24px; margin-bottom: var(--space-16, 16px); overflow: hidden; background: radial-gradient(circle at 100% 0, color-mix(in srgb, var(--amiricord-on, #3ba55d) 14%, transparent) 0, transparent 55%), var(--background-surface-high, var(--card-background-default, #2b2d31)); }
.amiricord-plugins-info-text { min-width: 0; }
.amiricord-plugins-info-title { font-family: var(--font-display, inherit); font-size: 22px; font-weight: 700; line-height: 1.2; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-plugins-info-text p { max-width: 520px; margin: 6px 0 0; font-size: 14px; line-height: 1.4; color: var(--text-muted, #949ba4); }
.amiricord-plugins-restart { border-color: color-mix(in srgb, var(--text-feedback-warning, #f0b232) 55%, transparent); background: radial-gradient(circle at 100% 0, color-mix(in srgb, var(--text-feedback-warning, #f0b232) 16%, transparent) 0, transparent 55%), var(--background-surface-high, var(--card-background-default, #2b2d31)); }
.amiricord-plugins-restart .amiricord-plugins-info-text p { color: var(--text-default, #dbdee1); }
.amiricord-plugins-restart-question { margin-bottom: var(--space-16, 16px); }
.amiricord-plugins-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: var(--space-8, 8px); }
.amiricord-plugins-stat { position: relative; box-sizing: border-box; padding: 16px 18px; overflow: hidden; transition: 0.15s ease-out; transition-property: box-shadow, transform, border-color; }
.amiricord-plugins-stat:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--text-default, #dbdee1) 24%, transparent); box-shadow: var(--elevation-low, 0 4px 14px rgba(0, 0, 0, 0.28)); }
.amiricord-plugins-stat-title { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted, #949ba4); }
.amiricord-plugins-stat-value { margin: 6px 0 4px; font-size: 26px; font-weight: 700; line-height: 1.15; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-plugins-stat-hint { font-size: 13px; color: var(--text-subtle, var(--text-muted, #949ba4)); }
.amiricord-plugins-bar { height: 6px; margin-top: 12px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--text-default, #dbdee1) 10%, transparent); }
.amiricord-plugins-bar-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--amiricord-on, #3ba55d), color-mix(in srgb, var(--amiricord-on, #3ba55d) 55%, #ffffff)); transition: width 280ms ease; }
.amiricord-plugins-input, .amiricord-plugins-select { box-sizing: border-box; width: 100%; height: 42px; padding: 0 var(--space-12, 12px); border: 1px solid var(--input-border-default, var(--amiricord-line, #3f4147)); border-radius: 10px; font: inherit; font-size: 14px; color: var(--input-text-default, var(--text-default, #dbdee1)); background: var(--input-background-default, var(--background-base-lowest, #1e1f22)); outline: none; transition: border-color 140ms ease, box-shadow 140ms ease; }
.amiricord-plugins-input { height: 46px; padding-left: 42px; border-radius: 12px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23949ba4' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: 14px 50%; }
.amiricord-plugins-select { appearance: none; padding-right: 34px; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23949ba4' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; }
.amiricord-plugins-select:hover { border-color: color-mix(in srgb, var(--text-default, #dbdee1) 30%, transparent); }
.amiricord-plugins-input:focus, .amiricord-plugins-select:focus-visible { border-color: var(--border-focus, #00a8fc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--border-focus, #00a8fc) 22%, transparent); }
.amiricord-plugins-select option { color: var(--text-default, #dbdee1); background: var(--background-base-lowest, #1e1f22); }
.amiricord-plugins-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0 var(--space-8, 8px); }
.amiricord-plugins-clear { display: inline-flex; width: auto; margin-bottom: var(--space-8, 8px); }
.amiricord-plugins-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); margin-top: 12px; margin-bottom: 1em; }
.amiricord-plugins-empty { margin-top: var(--space-8, 8px); }
.amiricord-plugin { position: relative; display: flex; flex-direction: column; min-height: 156px; box-sizing: border-box; padding: 0; overflow: hidden; color: var(--text-default, #dbdee1); transition: 0.16s ease-out; transition-property: box-shadow, background-color, border-color, transform, opacity; }
.amiricord-plugin::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: linear-gradient(90deg, var(--amiricord-on, #3ba55d), transparent 70%); opacity: 0; transition: opacity 160ms ease; pointer-events: none; }
.amiricord-plugin:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--text-default, #dbdee1) 26%, transparent); background-color: var(--background-surface-highest, var(--card-background-default, #2b2d31)); box-shadow: var(--elevation-low, 0 8px 22px rgba(0, 0, 0, 0.3)); }
.amiricord-plugin:not(.amiricord-plugin-off) { border-color: color-mix(in srgb, var(--amiricord-on, #3ba55d) 32%, var(--amiricord-line, #3f4147)); background-image: radial-gradient(circle at 0 0, color-mix(in srgb, var(--amiricord-on, #3ba55d) 9%, transparent) 0, transparent 60%); }
.amiricord-plugin:not(.amiricord-plugin-off)::before { opacity: 1; }
.amiricord-plugin-off .amiricord-plugin-avatar { filter: grayscale(0.7); opacity: 0.75; }
.amiricord-plugin-off .amiricord-plugin-name { color: var(--text-default, #dbdee1); }
.amiricord-plugin-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; box-sizing: border-box; padding: 16px 16px 8px; }
.amiricord-plugin-avatar { display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; border-radius: 12px; font-size: 15px; font-weight: 800; letter-spacing: 0.02em; color: hsl(var(--amiricord-hue, 150) 80% 88%); background: linear-gradient(135deg, hsl(var(--amiricord-hue, 150) 45% 34%), hsl(calc(var(--amiricord-hue, 150) + 30) 45% 22%)); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 10%); transition: filter 160ms ease, opacity 160ms ease; user-select: none; }
.amiricord-plugin-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 16px; font-weight: 700; line-height: 1.25; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-plugin-version { margin-left: var(--space-8, 8px); font-size: 12px; font-weight: 500; color: var(--text-muted, #949ba4); }
.amiricord-plugin-desc { flex: 1; margin: 0; padding: 0 16px 14px; font-size: 14px; line-height: 1.4; color: var(--text-default, #dbdee1); overflow-wrap: anywhere; }
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
.amiricord-plugin-controls { display: flex; align-items: center; gap: 10px; }
.amiricord-plugin-details { all: unset; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; color: var(--text-muted, #949ba4); transition: color 140ms ease, background 140ms ease; }
.amiricord-plugin-details:hover { color: var(--text-default, #dbdee1); background: color-mix(in srgb, var(--text-default, #dbdee1) 10%, transparent); }
.amiricord-plugin-details:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-plugin-details svg { width: 22px; height: 22px; }
.amiricord-pwin-title { font-size: 20px; font-weight: 700; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-pwin-desc { margin: 0 0 12px; font-size: 14px; line-height: 1.4; color: var(--text-default, #dbdee1); }
.amiricord-pwin-section { margin-top: 16px; padding: 14px 16px; border: 1px solid var(--amiricord-line, rgba(255, 255, 255, 0.1)); border-radius: 14px; background: var(--card-background-default, rgba(0, 0, 0, 0.18)); }
.amiricord-pwin-heading { margin-bottom: 10px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted, #949ba4); }
.amiricord-pwin-authors { display: flex; flex-wrap: wrap; gap: 8px; }
.amiricord-pwin-avatar { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex: none; }
.amiricord-pwin-author { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 6px; border: 1px solid var(--amiricord-line, rgba(255, 255, 255, 0.1)); border-radius: 999px; font-size: 14px; color: var(--text-default, #dbdee1); background: var(--amiricord-lift, rgba(255, 255, 255, 0.04)); }
.amiricord-pwin-row { margin-top: 8px; padding: 12px 14px; border: 1px solid var(--amiricord-line, rgba(255, 255, 255, 0.1)); border-radius: 12px; background: var(--background-mod-subtle, rgba(255, 255, 255, 0.03)); }
.amiricord-pwin-row-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.amiricord-pwin-row-text { flex: 1; min-width: 0; }
.amiricord-pwin-row-title { font-size: 15px; font-weight: 600; color: var(--text-strong, var(--text-default, #f2f3f5)); }
.amiricord-pwin-row-desc { margin-top: 2px; font-size: 14px; line-height: 1.35; color: var(--text-subtle, var(--text-muted, #949ba4)); overflow-wrap: anywhere; }
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
.amiricord-plugin-extra { display: flex; flex-direction: column; gap: 6px; padding: 0 16px 12px; }
.amiricord-plugin-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-8, 8px); min-height: 20px; margin-top: auto; padding: 10px 16px; border-top: 1px solid var(--amiricord-line, rgba(255, 255, 255, 0.1)); background-color: color-mix(in srgb, var(--background-base-lowest, #000) 28%, transparent); font-size: 13px; }
.amiricord-plugin-source { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; line-height: 18px; color: var(--text-muted, #949ba4); }
.amiricord-plugin-tags { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 5px; max-width: 72%; }
.amiricord-plugin-tag { display: inline-flex; align-items: center; box-sizing: border-box; max-width: 85px; height: 20px; padding: 0 8px; overflow: hidden; border-radius: 999px; background-color: color-mix(in srgb, var(--text-default, #dbdee1) 9%, transparent); font-size: 10px; font-weight: 600; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted, #949ba4); }
.amiricord-plugin-tags .amiricord-plugin-badge { display: inline-flex; align-items: center; box-sizing: border-box; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 10px; font-weight: 700; line-height: 18px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.amiricord-plugins-toolbar { position: sticky; top: 0; z-index: 3; margin: 14px -12px 0; padding: 12px 12px 8px; background: linear-gradient(180deg, color-mix(in srgb, var(--background-base-low, #171d19) 94%, transparent) 78%, transparent); backdrop-filter: blur(10px); }
.amiricord-plugins-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.amiricord-plugins-chip { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px 0 14px; border: 1px solid var(--amiricord-line, #3f4147); border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--text-muted, #949ba4); background: var(--amiricord-lift, rgba(255, 255, 255, 0.04)); transition: 0.14s ease-out; transition-property: color, background, border-color, transform; }
.amiricord-plugins-chip:hover { color: var(--text-default, #dbdee1); transform: translateY(-1px); border-color: color-mix(in srgb, var(--text-default, #dbdee1) 28%, transparent); }
.amiricord-plugins-chip:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-plugins-chip-on, .amiricord-plugins-chip-on:hover { color: var(--text-strong, #f2f3f5); border-color: color-mix(in srgb, var(--amiricord-on, #3ba55d) 60%, transparent); background: color-mix(in srgb, var(--amiricord-on, #3ba55d) 16%, transparent); }
.amiricord-plugins-chip-count { min-width: 20px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; color: var(--text-default, #dbdee1); background: color-mix(in srgb, var(--text-default, #dbdee1) 12%, transparent); }
.amiricord-plugins-chip-on .amiricord-plugins-chip-count { color: #fff; background: var(--amiricord-on, #3ba55d); }
.amiricord-plugins-toolbar .amiricord-plugins-filters { margin-bottom: 0; }
.amiricord-heading-count { display: inline-block; margin-left: 10px; padding: 0 8px; border-radius: 999px; font-size: 11px; line-height: 18px; letter-spacing: 0; color: var(--text-default, #dbdee1); background: color-mix(in srgb, var(--text-default, #dbdee1) 10%, transparent); vertical-align: 1px; }
@keyframes amiricord-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.amiricord-plugins-grid > .amiricord-plugin { animation: amiricord-rise 320ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards; }
.amiricord-plugins-grid > .amiricord-plugin:nth-child(2) { animation-delay: 35ms; }
.amiricord-plugins-grid > .amiricord-plugin:nth-child(3) { animation-delay: 70ms; }
.amiricord-plugins-grid > .amiricord-plugin:nth-child(4) { animation-delay: 105ms; }
.amiricord-plugins-grid > .amiricord-plugin:nth-child(5) { animation-delay: 140ms; }
.amiricord-plugins-grid > .amiricord-plugin:nth-child(6) { animation-delay: 175ms; }
.amiricord-plugins-grid > .amiricord-plugin:nth-child(n+7) { animation-delay: 210ms; }
.amiricord-plugin-switch-locked { position: relative; opacity: 0.85; }
.amiricord-plugin-switch-locked::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: repeating-linear-gradient(135deg, rgb(255 255 255 / 10%) 0 3px, transparent 3px 7px); pointer-events: none; }
.amiricord-plugins-empty { padding: 28px 16px; text-align: center; border: 1px dashed var(--amiricord-line, #3f4147); border-radius: var(--amiricord-radius, 14px); }
@media (prefers-reduced-motion: reduce) { .amiricord-plugins-grid > .amiricord-plugin { animation: none; } .amiricord-plugin, .amiricord-plugins-stat, .amiricord-plugins-bar-fill { transition: none; } .amiricord-plugin:hover, .amiricord-plugins-stat:hover { transform: none; } }
@media (width <= 760px) { .amiricord-plugins-info { flex-direction: column; align-items: flex-start; } .amiricord-plugins-grid { grid-template-columns: 1fr; } }
`;
