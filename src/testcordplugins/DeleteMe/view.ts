/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the DeleteMe window looks like for a given state. A plain function from the state to elements (no hooks), so it is looked at in tests without a page.
// The window pieces (root, header, content, close button) come in as arguments: Discord's own when found, ours when not.

import { CONFIRM_PHRASE, type DeleteState } from "./controller";

type Make = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;

export interface WindowParts {
    Root: unknown;
    Header: unknown;
    Content: unknown;
    CloseButton: unknown;
}

export interface WindowActions {
    scan(): void;
    start(): void;
    stop(): void;
    setConfirm(text: string): void;
    close(): void;
}

const LABELS: Record<DeleteState["feed"][number]["kind"], string> = { killed: "deleted", failed: "failed" };

/** How much of the work is done, 0 to 100. */
export function progressOf(state: Pick<DeleteState, "found" | "deleted" | "failed" | "phase">): number {
    if (state.found <= 0) return state.phase === "done" ? 100 : 0;
    return Math.min(100, Math.round(((state.deleted + state.failed) / state.found) * 100));
}

export function renderWindow(h: Make, parts: WindowParts, state: DeleteState, actions: WindowActions): unknown {
    const stat = (label: string, value: number) => h("div", { className: "vc-deleteme-stat", key: label }, h("span", { className: "vc-deleteme-stat-num" }, String(value)), h("span", { className: "vc-deleteme-stat-label" }, label));
    return h(parts.Root, { size: "medium", onClose: actions.close, label: "DeleteMe" },
        h(parts.Header, null, h("span", null, "DeleteMe"), h(parts.CloseButton, { onClick: actions.close })),
        h(parts.Content, null,
            h("div", { className: "vc-deleteme-modal" },
                h("div", { className: "vc-deleteme-warning" },
                    h("strong", null, "This deletes YOUR messages in this conversation, and it cannot be undone."),
                    h("span", null, "Only messages you wrote are deleted, one by one and slowly. Messages of other people are never touched. You can stop at any time.")),
                h("div", { className: "vc-deleteme-current-channel" }, "Conversation: ", h("b", null, state.channelName)),
                h("div", { className: "vc-deleteme-stats" }, stat("found", state.found), stat("deleted", state.deleted), stat("failed", state.failed)),
                h("div", { className: "vc-deleteme-status", "data-state": state.phase, role: "status" }, state.message),
                h("div", { className: "vc-deleteme-progressbar" }, h("div", { className: "vc-deleteme-progressbar-fill", style: { width: `${progressOf(state)}%` } })),
                state.phase === "ready" && state.found > 0
                    ? h("input", {
                        className: "vc-deleteme-confirm-input",
                        placeholder: `Type ${CONFIRM_PHRASE} to unlock`,
                        value: state.confirm,
                        autoComplete: "off",
                        onChange: (event: { target: { value: string; }; }) => { actions.setConfirm(event.target.value); }
                    })
                    : null,
                h("div", { className: "vc-deleteme-actions" },
                    h("button", { type: "button", className: "vc-deleteme-button vc-deleteme-button-quiet", disabled: !state.canScan, onClick: actions.scan }, state.phase === "idle" ? "Scan" : "Scan again"),
                    h("button", { type: "button", className: "vc-deleteme-button vc-deleteme-button-danger", disabled: !state.canStart, onClick: actions.start }, "Delete my messages"),
                    h("button", { type: "button", className: "vc-deleteme-button vc-deleteme-button-quiet", disabled: !state.canStop, onClick: actions.stop }, "Stop")),
                h("div", { className: "vc-deleteme-feed" }, ...state.feed.map(line =>
                    h("div", { className: `vc-deleteme-line vc-deleteme-line-${line.kind}`, key: line.id },
                        h("span", { className: "vc-deleteme-tag" }, LABELS[line.kind]),
                        line.note ? h("span", { className: "vc-deleteme-channel-badge", title: line.note }, line.note) : null,
                        h("span", { className: "vc-deleteme-content" }, line.text)))))));
}
