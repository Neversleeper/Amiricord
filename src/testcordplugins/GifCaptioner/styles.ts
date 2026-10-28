/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The style of the caption window and of the pencil button, from the plugin GifCaptioner (author benjii, Equicord) as found in TestCord (commit af92dba). The rules
// that restyled Discord's own close buttons everywhere are NOT carried over; the buttons of the window are ours.

export const CAPTIONER_CSS = `.vc-gif-captioner-trigger {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 2px;
    background: transparent;
    border: 0;
    color: var(--text-normal);
    cursor: pointer;
}

.vc-gif-captioner-trigger-icon {
    color: var(--text-normal);
    filter: drop-shadow(0 0 1px var(--background-primary));
}

.vc-gif-captioner-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--background-secondary);
}

.vc-gif-captioner-caption {
    width: 100%;
    box-sizing: border-box;
    padding: 10px;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    background: var(--input-background);
    color: var(--text-normal);
    font: inherit;
}

.vc-gif-captioner-caption:focus {
    outline: none;
    border-color: var(--input-border-hover);
}

.vc-gif-captioner-range {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 12px;
}

.vc-gif-captioner-font-selector {
    flex: 1 1 auto;
    min-width: 0;
}

.vc-gif-captioner-font-selector > div {
    width: 100%;
}

.vc-gif-captioner-range > div:first-child {
    min-width: 60px;
    flex-shrink: 0;
    font-size: 16px;
}

.vc-gif-captioner-range input[type="range"] {
    width: 100%;
    flex: 1 1 auto;
    accent-color: var(--brand-500);
}

.vc-gif-captioner-preview-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-height: 52vh;
}

.vc-gif-captioner-preview-canvas {
    width: 100%;
    max-width: 100%;
    display: block;
    border-radius: 8px 8px 0 0;
}

.vc-gif-captioner-preview-media {
    width: 100%;
}

.vc-gif-captioner-media-element {
    display: block;
    width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0 0 8px 8px;
}

.vc-gif-captioner-modal-content {
    padding: 8px;
    overflow: hidden;
}

.vc-gif-captioner-select { width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--input-border); background: var(--input-background); color: var(--text-normal); }
.vc-gif-captioner-button { padding: 8px 14px; border-radius: 6px; border: 0; font-size: 14px; font-weight: 600; cursor: pointer; color: #fff; background: var(--brand-500, #5865f2); }
.vc-gif-captioner-button-quiet { background: var(--background-modifier-hover, rgba(255, 255, 255, .1)); }
`;
