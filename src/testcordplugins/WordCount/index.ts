/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WordCount (author x2b) as found in TestCord. Two small grey lines say how many words and characters a text has:
//  - under a message of more than five words (as the original did). The original used the message-accessories API of Vencord, which Amiricord does not have; this one puts
//    the line at the end of the message's own content. Where it hooks was read in a running Discord (build 653945): the component that draws a message's content (found by
//    `WITH_CONTENT})`, which is in it once) ends its children with the edited marker; the line is added after it. Seen working;
//  - above the box where you type (new, asked by the owner: "the word counter does not show"), while you write, from the first letter. It reads the box of the page
//    (`[role="textbox"][data-slate-editor="true"]`, the way Discord names it in build 653945) and draws a small element of ours over the page next to the box, so it patches
//    nothing and Discord's own drawing is never touched. Both can be switched off in the settings.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { StyleHandle } from "../../api/styles";
import type { PluginCode } from "../../renderer/engine";

export const MIN_WORDS = 6;

const settings = definePluginSettings({
    underMessages: { type: "boolean", default: true, description: "Show the count under messages of more than five words." },
    inComposer: { type: "boolean", default: true, description: "Show the count above the box where you type, while you write." }
});

/** The words and characters of a text (any amount of white space between words). */
export function countWords(content: unknown): { words: number; characters: number; } | undefined {
    if (typeof content !== "string") return undefined;
    return { words: content.split(/\s+/).filter(word => word.length > 0).length, characters: content.length };
}

/** The words and characters of a message's text, or undefined when it has no more than five words (nothing is shown then). */
export function countOf(content: unknown): { words: number; characters: number; } | undefined {
    const count = countWords(content);
    return count && count.words >= MIN_WORDS ? count : undefined;
}

/** The text of the live line for what is typed, or an empty text when nothing is (the invisible marks Slate leaves in an empty box are not text). */
export function typedLine(content: string): string {
    const clean = content.replace(/[​﻿]/g, "");
    const count = countWords(clean);
    if (!count || clean.trim() === "") return "";
    return `${count.words} ${count.words === 1 ? "word" : "words"}, ${count.characters} ${count.characters === 1 ? "character" : "characters"}`;
}

const CSS = `
.amiricord-wordcount-live { position: fixed; z-index: 100; pointer-events: none; padding: 1px 6px; border-radius: 4px; font-size: 12px; line-height: 1.4; color: var(--text-muted, #949ba4); background: var(--background-base-low, var(--background-secondary, #2b2d31)); }
`;

const COMPOSER = "[role=\"textbox\"][data-slate-editor=\"true\"]";
let styleHandle: StyleHandle | undefined;
let stopLive: (() => void) | undefined;

/** Starts the live line over the page; returns what stops it. */
function startLive(page: Document): () => void {
    const view = page.defaultView!;
    let label: HTMLElement | undefined;
    const hide = () => { label?.remove(); label = undefined; };
    const update = () => {
        if (!settings.store.inComposer) { hide(); return; }
        const editor = page.querySelector(COMPOSER);
        const line = editor ? typedLine(editor.textContent ?? "") : "";
        if (!editor || line === "") { hide(); return; }
        const box = (editor.closest("form") ?? editor).getBoundingClientRect();
        if (box.width === 0) { hide(); return; }
        if (!label) {
            label = page.createElement("div");
            label.className = "amiricord-wordcount-live";
            page.body.append(label);
        }
        label.textContent = line;
        label.style.left = `${Math.max(0, box.right - label.offsetWidth - 12)}px`;
        label.style.top = `${Math.max(0, box.top - label.offsetHeight - 2)}px`;
    };
    const events = ["input", "keyup", "keydown", "focusin", "focusout", "click", "paste", "cut"] as const;
    // The text changes after the key event (Slate writes it a moment later), so the line is read again right after.
    const later = () => { update(); view.setTimeout(update, 30); };
    for (const type of events) page.addEventListener(type, later, true);
    view.addEventListener("resize", update);
    return () => {
        for (const type of events) page.removeEventListener(type, later, true);
        view.removeEventListener("resize", update);
        hide();
    };
}

const plugin: PluginCode & { wordCount(message: { content?: unknown; } | undefined): unknown; } = {
    settings,

    patches: [
        {
            // The content of a message: the line goes after the edited marker, at the end of the children.
            find: "WITH_CONTENT})",
            lazy: true,
            required: false,
            replacements: [{
                match: /(\(0,\i\.jsx\)\(\i\.\i,\{message:\i,compact:\i,location:\i\.\i\.WITH_CONTENT\}\))\]/,
                replace: "$1,$self.wordCount(arguments[0].message)]"
            }]
        }
    ],

    wordCount(message) {
        if (!settings.store.underMessages) return null;
        const count = countOf(message?.content);
        if (!count) return null;
        const react = currentReact() as { createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown; };
        return react.createElement("div", { key: "amiricord-word-count", style: { color: "var(--text-muted)", fontSize: "12px", lineHeight: "1.3" } }, `${count.words} words, ${count.characters} characters`);
    },

    start(ctx) {
        styleHandle = ctx.addStyle(CSS, "word-count-live");
        stopLive = startLive((globalThis as unknown as { document: Document; }).document);
    },

    stop() {
        stopLive?.();
        stopLive = undefined;
        styleHandle?.remove();
        styleHandle = undefined;
    }
};

export default plugin;
