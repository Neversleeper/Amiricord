/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of the Amiricord tabs. Colors come from Discord's own CSS variables so the tabs follow the owner's theme; each has a default
// for when a variable does not exist. The first name is the one Canary has today (analysis 09 section 9), the second the older one.
// Classes start with `amiricord-` so nothing here can touch Discord's own elements.

export const SETTINGS_STYLE_NAME = "settings";

export const SETTINGS_CSS = `
.theme-light .amiricord-tab, [data-theme="light"] .amiricord-tab { --amiricord-accent: #17181a; --amiricord-on-accent: #f2f3f5; }
.amiricord-tab { --amiricord-on: var(--status-positive, #3ba55d); --amiricord-radius: 14px; --amiricord-line: color-mix(in srgb, var(--text-default, #dbdee1) 13%, transparent); --amiricord-lift: color-mix(in srgb, var(--text-default, #dbdee1) 5%, transparent); box-sizing: border-box; width: 100%; margin: 0 auto; padding: var(--space-8, 8px) 0 var(--space-40, 40px); color: var(--text-default, var(--text-normal, #dbdee1)); font-family: var(--font-primary, "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif); font-size: 16px; line-height: 1.375; }
.amiricord-card { border: 1px solid var(--amiricord-line, var(--border-subtle, #3f4147)); border-radius: var(--amiricord-radius, 14px); background-color: var(--card-background-default, var(--background-secondary, #2b2d31)); }
.amiricord-banner { position: relative; overflow: hidden; background-color: #0b0b0d; display: flex; align-items: center; justify-content: center; min-height: 120px; box-sizing: border-box; padding: 1.25em 1.5em; margin-bottom: 1em; }
.amiricord-editor { overflow: hidden; margin-bottom: var(--space-20, 20px); padding: var(--space-16, 16px); border: 1px solid color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 35%, var(--border-subtle, #3f4147)); border-radius: 18px; background: radial-gradient(circle at top right, color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 12%, transparent) 0, transparent 36%), linear-gradient(135deg, var(--background-base-low, #2b2d31), var(--background-base-lower, #232428)); box-shadow: 0 12px 36px rgb(0 0 0 / 18%), 0 0 22px color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 10%, transparent); transition: border-color 180ms ease, box-shadow 180ms ease; }
.amiricord-editor-open { border-color: color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 70%, var(--border-subtle, #3f4147)); box-shadow: 0 16px 44px rgb(0 0 0 / 24%), 0 0 28px color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 22%, transparent); }
.amiricord-editor-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-16, 16px); }
.amiricord-editor-kicker { margin-bottom: var(--space-4, 4px); color: var(--text-muted, #949ba4); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.amiricord-editor-title { margin: 0; color: var(--header-primary, var(--text-strong, #f2f3f5)); font-size: 28px; line-height: 1; }
.amiricord-editor-toggle { display: inline-flex; align-items: center; gap: var(--space-8, 8px); min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; font: inherit; cursor: pointer; color: var(--button-secondary-text, #fff); background: var(--button-secondary-background, #4e5058); transition: background 160ms ease, color 160ms ease, transform 160ms ease; }
.amiricord-editor-toggle:hover { transform: translateY(-1px); background: var(--button-secondary-background-hover, #6d6f78); }
.amiricord-editor-toggle-on { color: var(--amiricord-on-accent, #17181a); background: var(--amiricord-accent, #f2f3f5); box-shadow: 0 0 14px color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 55%, transparent); }
.amiricord-editor-toggle-on:hover { background: #ffffff; }
.amiricord-editor-dot { width: 9px; height: 9px; border-radius: 999px; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 16%, transparent); }
.amiricord-editor-copy { padding-top: 14px; color: var(--text-secondary, var(--text-default, #b5bac1)); font-size: 14px; line-height: 1.45; }
.amiricord-editor-undo { display: flex; align-items: center; justify-content: space-between; gap: var(--space-12, 12px); margin-top: 10px; padding: var(--space-8, 8px) var(--space-12, 12px); border-radius: 8px; font-size: 14px; color: var(--text-default, #dbdee1); background: var(--background-modifier-accent, #3a3c42); }
.amiricord-editor-undo button { padding: 2px var(--space-8, 8px); border: 0; border-radius: 999px; font: inherit; font-size: 13px; cursor: pointer; color: var(--amiricord-on-accent, #17181a); background: var(--amiricord-accent, #f2f3f5); }
.amiricord-editor-preview { margin-top: 14px; padding: var(--space-12, 12px); border: 1px solid var(--border-subtle, #3f4147); border-radius: 14px; background: color-mix(in srgb, var(--background-base-lowest, #1e1f22) 70%, transparent); }
.amiricord-editor-preview-title { color: var(--text-muted, #949ba4); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.amiricord-editor-preview-list { display: flex; flex-wrap: wrap; gap: var(--space-8, 8px); margin-top: 10px; }
.amiricord-editor-preview-item { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; border-radius: 999px; font-size: 13px; color: var(--text-primary, var(--text-default, #dbdee1)); background: var(--background-modifier-accent, #3a3c42); }
.amiricord-editor-preview-item svg, .amiricord-editor-preview-item img { width: 14px; height: 14px; }
.amiricord-editor-preview-pin { font-size: 11px; font-weight: 700; color: var(--amiricord-accent, #f2f3f5); }
.amiricord-editor-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 14px; }
.amiricord-chip { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 48px; box-sizing: border-box; padding: 10px var(--space-12, 12px); border: 1px solid var(--border-subtle, #3f4147); border-radius: 14px; cursor: pointer; color: var(--text-secondary, var(--text-default, #b5bac1)); background: color-mix(in srgb, var(--background-base-lowest, #1e1f22) 82%, transparent); transition: border-color 160ms ease, background 160ms ease, color 160ms ease, transform 160ms ease; }
.amiricord-chip[aria-disabled="true"] { cursor: default; opacity: 0.78; }
.amiricord-chip:hover:not([aria-disabled="true"]) { transform: translateY(-2px); border-color: color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 55%, var(--border-subtle, #3f4147)); color: var(--text-primary, var(--text-default, #f2f3f5)); }
.amiricord-chip svg, .amiricord-chip img { width: 18px; height: 18px; flex-shrink: 0; }
.amiricord-chip-on { border-color: color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 65%, var(--border-subtle, #3f4147)); color: var(--text-primary, var(--text-default, #f2f3f5)); background: color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 8%, var(--background-base-lowest, #1e1f22)); }
.amiricord-chip-dragging { opacity: 0.58; transform: scale(0.98) rotate(-1deg); box-shadow: 0 18px 42px rgb(0 0 0 / 26%); }
.amiricord-chip-drop { border-color: var(--amiricord-accent, #f2f3f5); box-shadow: inset 4px 0 0 var(--amiricord-accent, #f2f3f5), 0 0 0 1px color-mix(in srgb, var(--amiricord-accent, #f2f3f5) 40%, transparent); transform: translateX(4px); }
.amiricord-chip-handle { color: var(--text-muted, #949ba4); font-weight: 800; letter-spacing: -3px; opacity: 0.75; }
.amiricord-chip-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amiricord-chip-pin, .amiricord-chip-state { padding: 3px var(--space-8, 8px); border: 0; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 700; color: var(--text-muted, #949ba4); background: var(--background-modifier-accent, #3a3c42); }
.amiricord-chip-pin { cursor: pointer; }
.amiricord-chip-pin:hover { color: var(--text-primary, #f2f3f5); background: var(--background-modifier-hover, #4a4c52); }
.amiricord-chip-pin-on { color: var(--amiricord-on-accent, #17181a); background: var(--amiricord-accent, #f2f3f5); }
.amiricord-chip-state { margin-left: auto; }
.amiricord-chip-on .amiricord-chip-state { color: var(--amiricord-on-accent, #17181a); background: var(--amiricord-accent, #f2f3f5); }
.amiricord-editor-link { display: inline-block; margin-top: 14px; padding: var(--space-8, 8px) var(--space-12, 12px); border: 0; border-radius: 10px; font: inherit; cursor: pointer; color: var(--amiricord-accent, #f2f3f5); background: transparent; transition: background 160ms ease, opacity 160ms ease; }
.amiricord-editor-link:hover { background: var(--background-modifier-hover, #4a4c52); }
.amiricord-editor-restore { margin-left: var(--space-8, 8px); color: var(--text-muted, #949ba4); }
.amiricord-logo { width: 96px; height: 96px; flex-shrink: 0; object-fit: contain; }
.amiricord-logo-fallback { display: flex; align-items: center; justify-content: center; width: 96px; height: 96px; flex-shrink: 0; border-radius: 16px; font-size: 40px; font-weight: 600; color: #fff; background: var(--brand-500, #5865f2); }
.amiricord-heading { margin: 28px 0 12px; font-family: var(--font-display, inherit); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.25; color: var(--text-muted, #949ba4); }
.amiricord-hint { margin: 0 0 var(--space-16, 16px); color: var(--text-default, #dbdee1); font-size: 14px; line-height: 1.28571; }
.amiricord-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6em; padding: 0.6em; margin-bottom: 1em; }
@media (width <= 1040px) { .amiricord-actions { grid-template-columns: repeat(2, 1fr); } }
.amiricord-action { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 0.5em; padding: 10px var(--space-16, 16px) 10px var(--space-12, 12px); border: 1px solid var(--amiricord-line, transparent); border-radius: 12px; line-height: 1; cursor: pointer; transition: 0.14s ease-out; font-size: 15px; font-weight: 500; color: var(--control-secondary-text-default, var(--text-default, #dbdee1)); background: var(--amiricord-lift, var(--interactive-background-default, #4e5058)); }
.amiricord-action:hover { background: color-mix(in srgb, var(--text-default, #dbdee1) 11%, transparent); border-color: color-mix(in srgb, var(--text-default, #dbdee1) 26%, transparent); transform: translateY(-2px); box-shadow: var(--elevation-high, 0 8px 18px rgba(0, 0, 0, 0.3)); }
.amiricord-action:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-action svg { width: 24px; height: 24px; flex-shrink: 0; }
.amiricord-confirm { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-12, 12px); padding: 12px var(--space-16, 16px); border: 1px solid color-mix(in srgb, var(--text-feedback-warning, #f0b232) 40%, transparent); border-radius: 12px; font-size: 14px; color: var(--text-feedback-warning, #f0b232); background: color-mix(in srgb, var(--text-feedback-warning, #f0b232) 9%, transparent); }
.amiricord-confirm-buttons { display: flex; gap: var(--space-8, 8px); }
.amiricord-soon, .amiricord-soon:hover { cursor: default; transform: none; box-shadow: none; }
.amiricord-action.amiricord-soon, .amiricord-button.amiricord-soon { position: relative; }
.amiricord-action.amiricord-soon:hover::after, .amiricord-action.amiricord-soon:active::after, .amiricord-button.amiricord-soon:hover::after, .amiricord-button.amiricord-soon:active::after { content: attr(data-soon); position: absolute; top: -9px; right: 8px; z-index: 1; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; line-height: 1.4; text-transform: uppercase; letter-spacing: 0.04em; pointer-events: none; color: var(--text-muted, #949ba4); background: var(--background-mod-normal, #3a3c42); box-shadow: 0 2px 6px rgb(0 0 0 / 30%); }
.amiricord-tag-soon { visibility: hidden; }
.amiricord-soon:hover .amiricord-tag-soon, .amiricord-soon:active .amiricord-tag-soon, .amiricord-soon:focus-within .amiricord-tag-soon { visibility: visible; }
.amiricord-notice { display: flex; align-items: center; gap: var(--space-12, 12px); box-sizing: border-box; width: 100%; padding: 12px var(--space-16, 16px); margin-bottom: var(--space-20, 20px); border: 1px solid color-mix(in srgb, var(--icon-feedback-info, #00a8fc) 55%, transparent); border-radius: 12px; font-size: 14px; font-weight: 500; line-height: 1.35; color: var(--text-default, #dbdee1); background: var(--background-feedback-info, rgba(0, 168, 252, 0.1)); }
.amiricord-notice svg { flex-shrink: 0; color: var(--text-feedback-info, #00a8fc); }
.amiricord-switch-row { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-16, 16px); margin-bottom: var(--space-20, 20px); }
.amiricord-switch-text { flex: 1; min-width: 0; max-width: 80%; }
.amiricord-switch-title { font-weight: 500; color: var(--text-strong, var(--text-default, #dbdee1)); }
.amiricord-switch-desc { margin-top: var(--space-4, 4px); font-size: 14px; line-height: 1.28571; color: var(--text-subtle, var(--text-muted, #949ba4)); }
.amiricord-warning { display: flex; align-items: center; gap: var(--space-12, 12px); box-sizing: border-box; margin-top: var(--space-8, 8px); padding: 12px var(--space-16, 16px); border: 1px solid color-mix(in srgb, var(--icon-feedback-critical, #f23f42) 55%, transparent); border-radius: 12px; font-size: 14px; font-weight: 500; line-height: 1.35; color: var(--text-feedback-critical, #fa777c); background: var(--background-feedback-critical, rgba(242, 63, 66, 0.1)); }
.amiricord-warning svg { flex-shrink: 0; color: var(--icon-feedback-critical, #f23f42); }
.amiricord-tag { display: inline-block; margin-left: var(--space-8, 8px); padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: 2px; color: var(--text-muted, #949ba4); background: color-mix(in srgb, var(--text-default, #dbdee1) 10%, transparent); }
.amiricord-banner-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.4; pointer-events: none; }
.amiricord-banner > :not(.amiricord-banner-art) { position: relative; }
.amiricord-banner .amiricord-banner-status { position: absolute; left: var(--space-16, 16px); bottom: var(--space-12, 12px); display: flex; flex-wrap: wrap; gap: var(--space-8, 8px); }
.amiricord-status-pill { padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.6; color: #dbdee1; background: rgb(255 255 255 / 12%); backdrop-filter: blur(6px); }
.amiricord-status-pill-good { color: #17181a; background: var(--amiricord-accent-on-dark, #f2f3f5); }
.amiricord-status-pill-warn { color: #17181a; background: #f0b232; }
.amiricord-switch[aria-checked="true"] { border-color: var(--amiricord-on, #3ba55d); background: var(--amiricord-on, #3ba55d); box-shadow: 0 0 12px color-mix(in srgb, var(--amiricord-on, #3ba55d) 45%, transparent); }
.amiricord-switch[aria-checked="true"] .amiricord-knob { left: 21px; background: #fff; }
.amiricord-switch { position: relative; flex-shrink: 0; width: 44px; height: 26px; margin-top: 2px; box-sizing: border-box; border: 1px solid var(--amiricord-line, #3f4147); border-radius: 13px; background: var(--background-mod-strong, #1e1f22); transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease; }
.amiricord-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--text-muted, #b5bac1); box-shadow: 0 1px 3px rgb(0 0 0 / 35%); transition: left 160ms cubic-bezier(0.3, 0.7, 0.4, 1), background 160ms ease; }
.amiricord-choice { margin-bottom: var(--space-20, 20px); }
.amiricord-select { display: flex; align-items: center; justify-content: space-between; box-sizing: border-box; width: 100%; margin-top: var(--space-8, 8px); padding: 10px var(--space-12, 12px); border: 1px solid var(--input-border-default, var(--border-subtle, #3f4147)); border-radius: 4px; font-size: 14px; color: var(--input-text-default, var(--text-default, #dbdee1)); background: var(--input-background-default, var(--background-base-lowest, #1e1f22)); }
.amiricord-select::after { content: ""; width: 8px; height: 8px; margin-left: var(--space-12, 12px); border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg) translateY(-2px); }
.amiricord-group { margin-top: var(--space-16, 16px); }
.amiricord-group-buttons { display: flex; flex-wrap: wrap; gap: var(--space-8, 8px); }
.amiricord-divider { height: 0; margin: var(--space-20, 20px) 0 0; border: 0; border-top: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); }
.amiricord-rows { overflow: hidden; margin-top: var(--space-4, 4px); margin-bottom: 1em; border: 1px solid var(--amiricord-line, var(--background-modifier-accent, #3f4147)); border-radius: var(--amiricord-radius, 14px); background-color: var(--card-background-default, var(--background-secondary, #2b2d31)); }
.amiricord-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-16, 16px); padding: 12px 16px; border-bottom: 1px solid var(--amiricord-line, var(--background-modifier-accent, #3f4147)); transition: background 120ms ease; }
.amiricord-row:hover { background: var(--amiricord-lift, rgba(255, 255, 255, 0.04)); }
.amiricord-row:last-child { border-bottom: none; }
.amiricord-row-name { flex-shrink: 0; font-size: 14px; font-weight: 500; color: var(--text-strong, var(--text-default, #dbdee1)); }
.amiricord-row-value { min-width: 0; text-align: right; color: var(--text-muted, #949ba4); font-size: 14px; overflow-wrap: anywhere; }
.amiricord-row-action { display: flex; justify-content: flex-end; padding: 12px 16px; border-bottom: 1px solid var(--amiricord-line, var(--background-modifier-accent, #3f4147)); }
.amiricord-button { padding: 9px 18px; border: 0; border-radius: 10px; cursor: pointer; font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: var(--brand-500, #5865f2); box-shadow: 0 1px 2px rgb(0 0 0 / 25%); transition: filter 140ms ease, transform 140ms ease, box-shadow 140ms ease; }
.amiricord-button:hover:not([disabled]) { filter: brightness(1.12); transform: translateY(-1px); box-shadow: 0 6px 14px rgb(0 0 0 / 28%); }
.amiricord-button:active:not([disabled]) { transform: translateY(0); filter: brightness(0.95); }
.amiricord-button:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-error { margin: var(--space-16, 16px) 0; padding: var(--space-16, 16px) 20px; border-radius: 14px; border: 1px solid var(--border-feedback-critical, #da373c); background: var(--card-background-default, #2b2d31); }
.amiricord-error-title { margin-bottom: var(--space-4, 4px); font-weight: 600; color: var(--text-feedback-critical, #f5787d); }
.amiricord-error-text { margin-bottom: 10px; color: var(--text-muted, #949ba4); overflow-wrap: anywhere; }
.amiricord-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-16, 16px); align-items: start; }
@media (width <= 1100px) { .amiricord-grid { grid-template-columns: minmax(0, 1fr); } }
.amiricord-pcard { box-sizing: border-box; min-width: 0; margin-bottom: var(--space-16, 16px); padding: 20px; border: 1px solid var(--amiricord-line, var(--background-modifier-accent, #3f4147)); border-radius: var(--amiricord-radius, 14px); background-color: var(--card-background-default, var(--background-secondary, #1e1f22)); transition: border-color 160ms ease, box-shadow 160ms ease; }
.amiricord-pcard:hover { border-color: color-mix(in srgb, var(--text-default, #dbdee1) 22%, transparent); box-shadow: 0 6px 20px rgb(0 0 0 / 18%); }
.amiricord-pcard-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-8, 8px); margin-bottom: var(--space-4, 4px); }
.amiricord-pcard-title { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.25; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.amiricord-pcard-text { margin: 0 0 var(--space-12, 12px); font-size: 14px; line-height: 1.35; color: var(--text-subtle, var(--text-muted, #949ba4)); }
.amiricord-pcard .amiricord-rows { margin-bottom: var(--space-12, 12px); }
.amiricord-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border: 1px solid transparent; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.6; }
.amiricord-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.amiricord-badge-good { color: #3ba55d; border-color: rgb(59 165 93 / 35%); background: rgb(59 165 93 / 14%); }
.amiricord-badge-warn { color: #f0b232; border-color: rgb(240 178 50 / 35%); background: rgb(240 178 50 / 14%); }
.amiricord-badge-bad { color: #f23f42; border-color: rgb(242 63 66 / 35%); background: rgb(242 63 66 / 14%); }
.amiricord-badge-off { color: var(--text-muted, #949ba4); border-color: var(--border-subtle, #3f4147); background: rgb(255 255 255 / 5%); }
.amiricord-badge-live { color: #8ea1ff; border-color: rgb(88 101 242 / 40%); background: rgb(88 101 242 / 14%); }
.amiricord-badge-good .amiricord-badge-dot { animation: amiricord-pulse 1.8s ease-in-out infinite; }
.amiricord-badge-live .amiricord-badge-dot { animation: amiricord-pulse-live 1.8s ease-in-out infinite; }
@keyframes amiricord-pulse-live { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgb(88 101 242 / 60%); } 50% { opacity: 0.55; box-shadow: 0 0 0 5px rgb(88 101 242 / 0%); } }
@keyframes amiricord-pulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgb(59 165 93 / 60%); } 50% { opacity: 0.55; box-shadow: 0 0 0 5px rgb(59 165 93 / 0%); } }
@media (prefers-reduced-motion: reduce) { .amiricord-badge-good .amiricord-badge-dot, .amiricord-badge-live .amiricord-badge-dot { animation: none; } }
.amiricord-pswitch { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-16, 16px); margin-top: var(--space-8, 8px); padding: 12px 16px; border: 1px solid var(--amiricord-line, transparent); border-radius: 12px; background: color-mix(in srgb, var(--background-base-lowest, #000) 40%, transparent); }
.amiricord-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: var(--space-12, 12px); }
.amiricord-tile { box-sizing: border-box; padding: 14px 8px; text-align: center; border: 1px solid var(--amiricord-line, #3f4147); border-top: 3px solid var(--amiricord-on, #3ba55d); border-radius: 12px; background: color-mix(in srgb, var(--background-base-lowest, #000) 40%, transparent); }
.amiricord-tile-number { font-size: 26px; font-weight: 700; line-height: 1.1; color: var(--text-strong, #f2f3f5); }
.amiricord-tile-label { margin-top: 2px; font-size: 12px; color: var(--text-muted, #949ba4); }
.amiricord-subheading { margin: var(--space-16, 16px) 0 var(--space-8, 8px); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted, #949ba4); }
.amiricord-pchips { display: flex; flex-wrap: wrap; gap: 6px; }
.amiricord-pchip { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-muted, #949ba4); background: color-mix(in srgb, var(--text-default, #dbdee1) 8%, transparent); }
.amiricord-pchip-on { color: #fff; background: var(--button-filled-brand-background, #5865f2); }
.amiricord-provider { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-8, 8px) var(--space-16, 16px); padding: 12px 16px; border-bottom: 1px solid var(--amiricord-line, #3f4147); }
.amiricord-provider:last-child { border-bottom: none; }
.amiricord-provider-text { flex: 1 1 220px; min-width: 0; }
.amiricord-provider-name { font-size: 14px; font-weight: 600; color: var(--text-strong, #f2f3f5); }
.amiricord-provider-note { margin-top: 2px; font-size: 13px; line-height: 1.3; color: var(--text-muted, #949ba4); }
.amiricord-provider-test { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.amiricord-provider-result { font-size: 12px; color: var(--text-muted, #949ba4); }
.amiricord-button[disabled] { opacity: 0.6; cursor: default; }
.amiricord-switch-live { cursor: pointer; }
.amiricord-switch-live:hover { filter: brightness(1.15); }
.amiricord-switch-live:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-css-switch { display: flex; align-items: center; justify-content: space-between; gap: var(--space-16, 16px); margin: var(--space-8, 8px) 0; }
.amiricord-css-editor { box-sizing: border-box; display: block; width: 100%; height: 45vh; min-height: 260px; margin-top: var(--space-8, 8px); padding: 10px var(--space-12, 12px); border: 1px solid var(--input-border-default, var(--border-subtle, #3f4147)); border-radius: 4px; resize: vertical; overflow: auto; white-space: pre; font-family: Consolas, "Cascadia Mono", "Courier New", monospace; font-size: 13px; line-height: 1.45; tab-size: 4; color: var(--text-default, #dbdee1); background: var(--input-background-default, var(--background-base-lowest, #1e1f22)); outline: none; }
.amiricord-css-editor:focus { border-color: var(--border-focus, #00a8fc); }
.amiricord-css-footer-note { flex: 1; min-width: 0; margin-right: var(--space-12, 12px); align-self: center; }
.amiricord-css-count { margin-top: var(--space-4, 4px); text-align: right; font-size: 12px; color: var(--text-subtle, var(--text-muted, #949ba4)); }
.amiricord-note { margin-top: var(--space-4, 4px); font-size: 13px; color: var(--text-feedback-info, #00a8fc); }
.amiricord-restart { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-12, 12px); margin-top: var(--space-12, 12px); padding: 12px var(--space-16, 16px); border: 1px solid rgb(240 178 50 / 45%); border-radius: 12px; background: rgb(240 178 50 / 10%); font-size: 14px; }
.amiricord-dropdown { position: relative; }
.amiricord-dropdown .amiricord-select { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 10px var(--space-12, 12px); border: 1px solid var(--border-subtle, #3f4147); border-radius: 6px; background: var(--input-background-default, var(--background-base-lowest, #1e1f22)); color: var(--text-strong, #f2f3f5); cursor: pointer; }
.amiricord-dropdown .amiricord-select:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); }
.amiricord-options { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); max-height: 260px; overflow-y: auto; padding: 4px; border: 1px solid var(--border-subtle, #3f4147); border-radius: 6px; background: var(--background-floating, var(--background-base-low, #2b2d31)); box-shadow: 0 8px 24px rgb(0 0 0 / 40%); }
.amiricord-option { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 8px 10px; border-radius: 4px; font-size: 14px; color: var(--text-default, #dbdee1); cursor: pointer; }
.amiricord-option:hover, .amiricord-option:focus-visible { background: var(--background-modifier-hover, #4a4c52); }
.amiricord-option-on { color: #fff; background: var(--button-filled-brand-background, #5865f2); }
.amiricord-segments { display: flex; gap: 6px; margin-bottom: var(--space-4, 4px); }
.amiricord-segment { all: unset; box-sizing: border-box; flex: 1; padding: 8px 10px; text-align: center; border: 1px solid var(--border-subtle, #3f4147); border-radius: 6px; font-size: 14px; font-weight: 500; color: var(--text-default, #dbdee1); cursor: pointer; }
.amiricord-segment:hover { background: var(--background-modifier-hover, #4a4c52); }
.amiricord-segment:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); }
.amiricord-segment-on, .amiricord-segment-on:hover { color: #fff; border-color: transparent; background: var(--button-filled-brand-background, #5865f2); }
.amiricord-provider-test-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-12, 12px); }
.amiricord-pcard .amiricord-provider-note { margin: var(--space-4, 4px) 0 var(--space-8, 8px); }
.amiricord-button-quiet { color: var(--text-default, #dbdee1); background: transparent; border: 1px solid var(--border-subtle, #3f4147); }
.amiricord-button-quiet:hover { background: var(--background-modifier-hover, #4a4c52); }
.amiricord-grid-even { align-items: stretch; }
.amiricord-grid-even > .amiricord-pcard { margin-bottom: var(--space-16, 16px); }
.amiricord-blocks-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-8, 8px); margin-bottom: var(--space-8, 8px); }
.amiricord-search { flex: 1 1 180px; min-width: 0; box-sizing: border-box; padding: 9px var(--space-12, 12px); border: 1px solid var(--amiricord-line, #3f4147); border-radius: 10px; background: var(--input-background-default, var(--background-base-lowest, #1e1f22)); color: var(--text-default, #dbdee1); font: inherit; font-size: 14px; }
.amiricord-search:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); }
.amiricord-blocks { display: flex; flex-direction: column; gap: 8px; margin-bottom: var(--space-12, 12px); }
.amiricord-block { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-12, 12px); padding: 12px var(--space-16, 16px); border: 1px solid var(--amiricord-line, #3f4147); border-radius: 12px; background: color-mix(in srgb, var(--background-base-lowest, #000) 40%, transparent); }
.amiricord-block-main { min-width: 0; }
.amiricord-block-title { font-size: 14px; font-weight: 600; color: var(--text-strong, #f2f3f5); }
.amiricord-block-count { margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700; color: var(--text-default, #dbdee1); background: rgb(255 255 255 / 10%); }
.amiricord-block-where { margin-top: 2px; font-family: var(--font-code, monospace); font-size: 12px; color: var(--text-muted, #949ba4); overflow-wrap: anywhere; }
.amiricord-block-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.amiricord-block-tag { padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-muted, #b5bac1); background: rgb(255 255 255 / 8%); }
.amiricord-block-source { color: #8ea1ff; background: rgb(88 101 242 / 16%); }
.amiricord-block-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.amiricord-block-badge { padding: 1px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; }
.amiricord-block-badge-blocked { color: #f23f42; border: 1px solid rgb(242 63 66 / 45%); background: rgb(242 63 66 / 12%); }
.amiricord-block-badge-stripped { color: #f0b232; border: 1px solid rgb(240 178 50 / 45%); background: rgb(240 178 50 / 12%); }
.amiricord-block-age { font-size: 12px; color: var(--text-muted, #949ba4); }
.amiricord-blocks-empty { margin-bottom: var(--space-12, 12px); padding: 14px; text-align: center; font-size: 14px; color: var(--text-muted, #949ba4); border: 1px dashed var(--border-subtle, #3f4147); border-radius: 6px; }
.amiricord-pager { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-8, 8px); margin-bottom: var(--space-8, 8px); }
.amiricord-pager-text { font-size: 13px; color: var(--text-muted, #949ba4); }
.amiricord-rule-form { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-8, 8px); margin-bottom: var(--space-8, 8px); }
.amiricord-rule-form .amiricord-search { flex: 1 1 130px; }
.amiricord-rule-form .amiricord-pswitch { flex: 1 1 100%; margin-top: 0; }
.amiricord-pswitch-compact { align-items: center; padding: 6px 12px; }
.amiricord-pswitch-compact .amiricord-switch-title { font-size: 14px; }
.amiricord-pswitch-compact .amiricord-switch { margin-top: 0; }
.amiricord-remove { margin-left: var(--space-12, 12px); padding: 2px var(--space-8, 8px); font-size: 12px; }
.amiricord-updates-news { display: flex; flex-direction: column; gap: var(--space-8, 8px); }
.amiricord-updates-entry { position: relative; padding: var(--space-16, 16px) 20px var(--space-16, 16px) 24px; overflow: hidden; }
.amiricord-updates-entry::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, var(--amiricord-on, #3ba55d), transparent); }
.amiricord-updates-entry-head { display: flex; align-items: baseline; gap: var(--space-8, 8px); }
.amiricord-updates-entry-version { padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--amiricord-on, #3ba55d); background: color-mix(in srgb, var(--amiricord-on, #3ba55d) 14%, transparent); }
.amiricord-updates-entry-title { margin-top: 6px; font-size: 16px; font-weight: 700; color: var(--text-strong, #f2f3f5); }
.amiricord-updates-entry-notes { margin: var(--space-8, 8px) 0 0; padding: 0; list-style: none; font-size: 14px; line-height: 21px; color: var(--text-default, #dbdee1); }
.amiricord-updates-entry-notes li { position: relative; margin: 6px 0 0; padding-left: 16px; }
.amiricord-updates-entry-notes li::before { content: ""; position: absolute; left: 2px; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--amiricord-on, #3ba55d); opacity: 0.8; }
.amiricord-updates-publisher { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: var(--space-12, 12px); padding-top: var(--space-12, 12px); border-top: 1px solid var(--border-subtle, rgba(128, 132, 142, 0.24)); font-size: 12px; }
.amiricord-updates-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.amiricord-updates-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--text-default, #dbdee1); background: var(--background-mod-subtle, rgba(128, 132, 142, 0.16)); text-decoration: none; }
a.amiricord-updates-chip:hover { background: var(--background-mod-normal, rgba(128, 132, 142, 0.3)); text-decoration: none; }
.amiricord-updates-chip svg { flex: 0 0 auto; opacity: 0.85; }
`;
