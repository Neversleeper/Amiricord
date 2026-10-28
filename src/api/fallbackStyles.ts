/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of the fallback components. Colors come from Discord's own CSS variables so the pieces follow the theme;
// each has a plain default for when a variable does not exist. The first name of each is the one Canary has today
// (discovery run, docs/analysis-09-settings-core.md section 9); the older Discord name is the second choice.

export const FALLBACK_STYLE_ID = "amiricord-fallback-components";

export const FALLBACK_CSS = `
.amiricord-card { padding: 16px; margin: 8px 0; border-radius: 8px; background: var(--card-background-default, var(--background-secondary, #2b2d31)); color: var(--text-default, var(--text-normal, #dbdee1)); }
.amiricord-heading { margin: 0 0 8px; color: var(--text-default, var(--header-primary, #f2f3f5)); font-weight: 600; }
.amiricord-heading-1 { font-size: 24px; }
.amiricord-heading-2 { font-size: 18px; }
.amiricord-heading-3 { font-size: 14px; text-transform: uppercase; letter-spacing: .02em; }
.amiricord-text { color: var(--text-default, var(--text-normal, #dbdee1)); font-size: 14px; line-height: 1.4; }
.amiricord-text-muted { color: var(--text-muted, #949ba4); }
.amiricord-divider { border: 0; border-top: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); margin: 12px 0; }
.amiricord-button { padding: 8px 16px; border: 0; border-radius: 4px; font-size: 14px; cursor: pointer; color: #fff; background: var(--interactive-background-default, var(--button-secondary-background, #4e5058)); }
.amiricord-button-primary { background: var(--brand-500, var(--brand-experiment, #5865f2)); }
.amiricord-button-danger { background: var(--status-danger, #da373c); }
.amiricord-button:disabled { opacity: .5; cursor: not-allowed; }
.amiricord-switch { position: relative; width: 40px; height: 24px; border: 0; border-radius: 12px; cursor: pointer; background: var(--border-muted, var(--primary-500, #80848e)); }
.amiricord-switch-on { background: var(--status-positive, #248046); }
.amiricord-switch:disabled { opacity: .5; cursor: not-allowed; }
.amiricord-switch-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .1s; }
.amiricord-switch-on .amiricord-switch-knob { left: 19px; }
.amiricord-input, .amiricord-select { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border-subtle, var(--background-modifier-accent, #3f4147)); border-radius: 4px; font-size: 14px; color: var(--text-default, var(--text-normal, #dbdee1)); background: var(--input-background-default, var(--input-background, #1e1f22)); }
.amiricord-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; color: #fff; background: var(--border-muted, var(--primary-500, #80848e)); }
.amiricord-badge-good { background: var(--status-positive, #248046); }
.amiricord-badge-warning { background: var(--status-warning, #f0b232); color: #000; }
.amiricord-badge-danger { background: var(--status-danger, #da373c); }
.amiricord-modal-backdrop { position: fixed; inset: 0; z-index: 1002; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; pointer-events: auto; background: rgba(0, 0, 0, .35); }
.amiricord-modal { pointer-events: auto; display: flex; flex-direction: column; max-width: 100%; max-height: 100%; border-radius: 8px; overflow: hidden; outline: none; color: var(--text-default, var(--text-normal, #dbdee1)); background: var(--modal-background, var(--background-primary, #313338)); border: 1px solid var(--border-subtle, rgba(255, 255, 255, .1)); box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
.amiricord-modal-small { width: 440px; }
.amiricord-modal-medium { width: 600px; }
.amiricord-modal-large { width: 800px; }
.amiricord-modal-dynamic { width: auto; min-width: 280px; }
.amiricord-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; font-size: 20px; font-weight: 600; color: var(--text-default, var(--header-primary, #f2f3f5)); }
.amiricord-modal-content { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 16px 16px; }
.amiricord-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px; background: var(--modal-footer-background, var(--background-secondary, #2b2d31)); }
.amiricord-modal-close { width: 32px; height: 32px; border: 0; border-radius: 4px; font-size: 24px; line-height: 1; cursor: pointer; color: var(--interactive-normal, #b5bac1); background: transparent; }
.amiricord-modal-close:hover { color: var(--interactive-hover, #dbdee1); background: var(--background-modifier-hover, rgba(255, 255, 255, .07)); }
`;
