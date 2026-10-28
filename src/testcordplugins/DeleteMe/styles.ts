/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The style of the DeleteMe window. Most of it is the style file of the plugin DeleteMe of TestCord (its code was not available, only this file); the buttons are ours.

export const DELETEME_CSS = `/* Vencord / Equicord - DeleteMe */

.vc-deleteme-modal {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
}

.vc-deleteme-warning {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.vc-deleteme-confirm-input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--input-background);
    border: 1px solid var(--input-border, var(--background-modifier-accent));
    color: var(--text-normal);
    font-size: 14px;
}

.vc-deleteme-stats {
    display: flex;
    gap: 16px;
    align-items: center;
    font-weight: 600;
    flex-wrap: wrap;
}

.vc-deleteme-stat {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
}

.vc-deleteme-stat-num {
    font-size: 22px;
    color: var(--header-primary);
}

.vc-deleteme-stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .04em;
    color: var(--text-muted);
}

.vc-deleteme-status {
    font-size: 13px;
    color: var(--text-normal);
}

.vc-deleteme-status[data-state="running"] { color: var(--status-danger, #f23f43); }
.vc-deleteme-status[data-state="done"]    { color: var(--text-positive); }
.vc-deleteme-status[data-state="stopped"] { color: var(--text-warning); }
.vc-deleteme-status[data-state="error"]   { color: var(--text-danger, #f23f43); }

.vc-deleteme-current-channel {
    font-size: 12px;
    color: var(--text-muted);
}

.vc-deleteme-current-channel b {
    color: var(--text-normal);
}

.vc-deleteme-progressbar {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--background-tertiary);
    overflow: hidden;
}

.vc-deleteme-progressbar-fill {
    height: 100%;
    background: var(--brand-experiment, #5865f2);
    transition: width .2s ease-out;
}

.vc-deleteme-feed {
    display: flex;
    flex-direction: column;
    gap: 2px;
    height: 260px;
    overflow-y: auto;
    background: var(--background-tertiary);
    border-radius: 8px;
    padding: 8px;
    font-size: 13px;
}

.vc-deleteme-line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 3px 6px;
    border-radius: 4px;
    animation: vc-deleteme-flash .5s ease-out;
}

.vc-deleteme-line-killed { color: var(--text-muted); }
.vc-deleteme-line-failed { color: var(--text-warning); }

.vc-deleteme-tag {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .03em;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--status-danger, #f23f43);
    color: #fff;
}

.vc-deleteme-line-failed .vc-deleteme-tag { background: var(--text-warning); }

.vc-deleteme-channel-badge {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--text-muted);
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-deleteme-content {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: line-through;
    opacity: .8;
}

@keyframes vc-deleteme-flash {
    from { background: var(--status-danger-background, rgba(240, 71, 71, .25)); }
    to   { background: transparent; }
}

.vc-deleteme-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.vc-deleteme-button { padding: 8px 14px; border-radius: 6px; border: 0; font-size: 14px; font-weight: 600; cursor: pointer; color: #fff; background: var(--brand-500, #5865f2); }
.vc-deleteme-button:disabled { opacity: .4; cursor: not-allowed; }
.vc-deleteme-button-danger { background: var(--status-danger, #f23f43); }
.vc-deleteme-button-quiet { background: var(--background-modifier-hover, rgba(255, 255, 255, .1)); }
`;
