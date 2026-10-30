/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The owner's own style sheet ("Custom CSS" of the main tab). The text and the on/off choice are two settings of the Settings plugin (so they are saved,
// checked and kept by the same store as everything else); this file decides what is applied and when, without Discord, so it is tested. The sheet goes
// through the engine's own `addStyle`, which refuses `@import` and addresses in `url()`: a style sheet must not be a side door to the network. Safe mode
// does not apply it, because safe mode is meant to start Discord without anything the owner added.

import { refuseCss, STYLE_ID_PREFIX, type StyleHandle } from "../../api/styles";

/** The longest sheet that can be kept. A saved setting may not be larger than 64 KB once written as JSON, and new lines and quotes take two characters there. */
export const CUSTOM_CSS_MAX = 30_000;

/** The name of the style element in the page (`amiricord-style-Settings-custom-css`). */
export const CUSTOM_CSS_STYLE_NAME = "custom-css";

/** The id of that element, which is how it is found again to keep it last. */
export const CUSTOM_CSS_ELEMENT_ID = `${STYLE_ID_PREFIX}Settings-${CUSTOM_CSS_STYLE_NAME}`;

export const SAFE_MODE_NOTE = "Safe mode is on, so your CSS is not applied until Discord starts normally.";

/** Why this text cannot be kept and applied, or null when it can. */
export function cssProblem(text: string): string | null {
    if (text.length > CUSTOM_CSS_MAX) return `The CSS is longer than ${CUSTOM_CSS_MAX.toLocaleString("en-US")} characters.`;
    const reason = refuseCss(text);
    return reason === undefined ? null : `This CSS cannot be applied: ${reason}.`;
}

/** The little of the page that keeping the sheet last needs, so tests can give it a fake. */
export interface HeadLike {
    lastElementChild: unknown;
    appendChild(node: unknown): unknown;
}

export interface PageLike {
    head: HeadLike | null;
    getElementById(id: string): unknown;
}

export interface ObserverLike {
    observe(target: unknown, options: { childList: boolean; }): void;
    disconnect(): void;
}

/**
 * Keeps the owner's style the last one in the page's head. Discord adds its own style sheets later, after ours (1,291 elements in the head on the owner's Stable,
 * 296 of them after ours, among them Discord's own sheets); a rule of the owner without `!important` would then lose to a Discord rule of the same weight, so the
 * sheet is put back at the end whenever something is added after it. Moving it does not add a second copy, and a move that is not needed is not made.
 * Returns the way to stop. Never throws.
 */
export function keepLast(page: PageLike, id: string, makeObserver: (callback: () => void) => ObserverLike): () => void {
    const move = () => {
        try {
            const element = page.getElementById(id);
            const head = page.head;
            if (element && head && head.lastElementChild !== element) head.appendChild(element);
        } catch {
            // A page that is going away is fine.
        }
    };
    move();
    let observer: ObserverLike | undefined;
    try {
        observer = makeObserver(move);
        if (page.head) observer.observe(page.head, { childList: true });
    } catch {
        observer = undefined;
    }
    return () => {
        try {
            observer?.disconnect();
        } catch {
            // Already gone.
        }
    };
}

/** What the Tab key writes in the text box: four spaces (the box would otherwise move the focus away, which is no use when writing CSS). */
export const INDENT = "    ";

/** The text with the indent put in place of the selection, and where the cursor goes after it. */
export function indentAt(text: string, start: number, end: number): { text: string; caret: number; } {
    const from = Math.max(0, Math.min(start, text.length));
    const to = Math.max(from, Math.min(end, text.length));
    return { text: text.slice(0, from) + INDENT + text.slice(to), caret: from + INDENT.length };
}

export interface CustomCssDeps {
    /** The two saved settings. */
    read(): { on: boolean; text: string; };
    /** The engine's `addStyle` for this plugin. May throw (a refused sheet, a plugin that stopped). */
    add(css: string, name: string): StyleHandle;
    safeMode(): boolean;
    /** Start keeping the style last in the page; returns the way to stop. Optional (tests do not need a page). */
    keepLast?(): () => void;
    /** Something went wrong that the person should find in the health report. */
    report(source: string, error: unknown): void;
}

export interface CustomCss {
    /** Make the page match the saved settings: apply, change or remove the style. Never throws. */
    apply(): void;
    /** Take the style out (the plugin stops). */
    stop(): void;
    /** Whether the page has the style right now. */
    applied(): boolean;
}

export function makeCustomCss(deps: CustomCssDeps): CustomCss {
    let handle: StyleHandle | undefined;
    let stopKeeping: (() => void) | undefined;
    const drop = () => {
        const old = handle;
        handle = undefined;
        stopKeeping?.();
        stopKeeping = undefined;
        try {
            old?.remove();
        } catch (error) {
            deps.report("custom CSS", error);
        }
    };
    return {
        apply() {
            try {
                const { on, text } = deps.read();
                if (!on || text.trim() === "" || deps.safeMode()) return drop();
                const problem = cssProblem(text);
                if (problem !== null) {
                    drop();
                    deps.report("custom CSS", new Error(problem));
                    return;
                }
                if (handle) handle.update(text);
                else handle = deps.add(text, CUSTOM_CSS_STYLE_NAME);
                stopKeeping ??= deps.keepLast?.();
            } catch (error) {
                handle = undefined;
                stopKeeping?.();
                stopKeeping = undefined;
                deps.report("custom CSS", error);
            }
        },
        stop: drop,
        applied: () => handle !== undefined
    };
}
