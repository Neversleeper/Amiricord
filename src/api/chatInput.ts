/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Writing into the message box from a plugin, as if the person had typed it. Discord's own way (a dispatcher with an "insert text" event) sits in a module whose export
// changes shape between builds; the box is a text editor in the page, so the text is typed into it by the browser's editing command, which the editor takes like real
// typing (checked on Discord build 655747: the box is `[role="textbox"][data-slate-editor="true"]` inside the form of the channel). Returns false when there is no box.

export interface ChatInputPage {
    querySelector(selector: string): Element | null;
    execCommand(command: string, showUi?: boolean, value?: string): boolean;
}

const BOX = "form [role=\"textbox\"][data-slate-editor=\"true\"]";

/** Types `text` into the message box of the channel that is open, at the cursor. Returns whether it could. */
export function insertIntoChatInput(page: ChatInputPage, text: string): boolean {
    const box = page.querySelector(BOX) as (Element & { focus?(): void; }) | null;
    if (!box || typeof box.focus !== "function") return false;
    box.focus();
    return page.execCommand("insertText", false, text);
}
