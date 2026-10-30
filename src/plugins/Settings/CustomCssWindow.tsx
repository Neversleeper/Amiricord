/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The window that opens from "Edit Custom CSS": a plain text box for the owner's own style sheet. There is no Save button and no switch here: what is typed is kept
// and applied as it is typed (a short pause after the last key, so the file is not written at every letter), and typing turns Custom CSS on if it was off (the switch
// of the main tab turns it off again). A sheet the rules do not allow is not kept, so the last good one stays applied, and the reason is shown next to the Close
// button. Nothing is loaded from the network (a code editor from a web address would contact a third party each time it opened). It is drawn with the engine's modal pieces.

import { currentReact } from "../../api/jsxRuntime";
import { cssProblem, CUSTOM_CSS_MAX, indentAt, SAFE_MODE_NOTE } from "./customCss";
import type { WindowParts } from "./PluginWindow";

export interface CustomCssWindowDeps {
    /** The saved text and whether it is applied. Read again whenever it is needed, because the switch of the main tab can change meanwhile. */
    read(): { on: boolean; text: string; };
    /** Keep a new text. Answers a sentence when it was refused, null when it was kept (and it is applied, if Custom CSS is on). */
    save(text: string): string | null;
    setOn(on: boolean): void;
    safeMode(): boolean;
    parts: WindowParts;
}

interface TabEvent {
    key?: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    preventDefault?(): void;
    target: { value: string; selectionStart: number; selectionEnd: number; setSelectionRange?(start: number, end: number): void; };
}

export const INTRO_TEXT = "Your own style sheet for the Discord window. What you type is applied right away and stays on this PC. @import and addresses in url() are not allowed, because a style sheet must not reach the network.";

/** How long after the last key the text is kept. Short enough to feel live, long enough not to write the file at every letter. */
export const KEEP_AFTER_MS = 250;

export function makeCustomCssWindow(deps: CustomCssWindowDeps) {
    const { ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } = deps.parts;
    // One of these per opening (the window component is made once per opening), so they survive Discord drawing the layer again.
    let pending: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    return function CustomCssWindow({ onClose }: { onClose(): void; }) {
        const react = currentReact();
        const [draft, setDraft] = react.useState(deps.read().text);
        const [note, setNote] = react.useState<string | null>(null);

        const problem = cssProblem(draft);

        /** Keep what is waiting. `show` is false when the window is being closed, because there is nothing left to tell. */
        const keep = (show: boolean) => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            if (pending === undefined) return;
            const text = pending;
            pending = undefined;
            const refused = deps.save(text);
            if (refused !== null && show) setNote(refused);
        };

        const edit = (text: string) => {
            setDraft(text);
            setNote(null);
            // A sheet the rules refuse is not kept; the last good one stays applied and the reason is on the screen.
            if (cssProblem(text) !== null) return;
            // Typing is asking for the sheet to be used, so Custom CSS is turned on at once if it was off.
            if (text.trim() !== "" && !deps.read().on) deps.setOn(true);
            pending = text;
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => keep(true), KEEP_AFTER_MS);
        };
        const close = () => {
            keep(false);
            onClose();
        };
        // Tab writes an indent instead of leaving the box; Shift+Tab (and Ctrl or Alt with it) still moves the focus, so the keyboard is never trapped.
        const tab = (event: TabEvent) => {
            if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
            event.preventDefault?.();
            const box = event.target;
            const next = indentAt(box.value, box.selectionStart, box.selectionEnd);
            edit(next.text);
            // The box draws the new text on the next turn and would put the cursor at the end, so it is put back where the person was typing.
            setTimeout(() => { try { box.setSelectionRange?.(next.caret, next.caret); } catch { /* the box is gone */ } }, 0);
        };

        return (
            <ModalRoot size="large" label="Custom CSS" onClose={close}>
                <ModalHeader>
                    <div className="amiricord-pwin-title">Custom CSS</div>
                    <ModalCloseButton onClick={close} />
                </ModalHeader>
                <ModalContent>
                    <p className="amiricord-pwin-desc">{INTRO_TEXT}</p>
                    {deps.safeMode() && <div className="amiricord-warning"><span>{SAFE_MODE_NOTE}</span></div>}
                    <textarea
                        className="amiricord-css-editor" aria-label="Custom CSS" spellCheck={false} wrap="off" value={draft}
                        onChange={(event: { target: { value: string; }; }) => { edit(event.target.value); }} onKeyDown={tab}
                    />
                    <div className="amiricord-css-count">{`${draft.length.toLocaleString("en-US")} / ${CUSTOM_CSS_MAX.toLocaleString("en-US")}`}</div>
                </ModalContent>
                <ModalFooter>
                    {/* In the footer, next to Close, so the reason a sheet is not applied is never scrolled out of sight below a tall text box. */}
                    <div className="amiricord-css-footer-note">
                        {problem !== null && <div className="amiricord-pwin-error" role="alert">{problem}</div>}
                        {problem === null && note !== null && <div className="amiricord-pwin-error" role="alert">{note}</div>}
                    </div>
                    <button type="button" className="amiricord-button" onClick={close}>Close</button>
                </ModalFooter>
            </ModalRoot>
        );
    };
}
