/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the DeleteMe window is doing, as plain data: which step it is in, what was found, what was deleted, the lines of the feed, and what the buttons may do.
// The window only draws this and calls these functions. Deleting needs three things in a row: a scan (so the person sees how many messages there are), the word
// DELETE typed by hand, and a press of the button. Written for Amiricord (2026).

import { MAX_IN_A_ROW, type OwnMessage, purge, type PurgeDeps, scanOwn } from "./purge";

export const CONFIRM_PHRASE = "DELETE";
export const FEED_MAX = 200;

export type Phase = "idle" | "scanning" | "ready" | "running" | "done" | "stopped" | "error";

export interface FeedLine {
    id: string;
    kind: "killed" | "failed";
    text: string;
    note?: string;
}

export interface DeleteState {
    phase: Phase;
    channelName: string;
    scanned: number;
    found: number;
    deleted: number;
    failed: number;
    confirm: string;
    message: string;
    feed: FeedLine[];
    /** Whether the delete button may be pressed right now. */
    canStart: boolean;
    /** Whether the scan button may be pressed right now. */
    canScan: boolean;
    /** Whether the stop button is useful right now. */
    canStop: boolean;
}

const MESSAGES = {
    idle: "Press Scan to count your messages in this conversation. Nothing is deleted yet.",
    scanning: "Looking for your messages...",
    stoppedScan: "The scan was stopped. Nothing was deleted.",
    nothing: "You have no messages here that can be deleted."
};

export function createController(deps: PurgeDeps, channelName: string) {
    let stopRequested = false;
    let disposed = false;
    let own: OwnMessage[] = [];
    let state: DeleteState = build({ phase: "idle", channelName, scanned: 0, found: 0, deleted: 0, failed: 0, confirm: "", message: MESSAGES.idle, feed: [] });
    const listeners = new Set<() => void>();

    function build(base: Omit<DeleteState, "canStart" | "canScan" | "canStop">): DeleteState {
        return {
            ...base,
            canStart: base.phase === "ready" && base.found > 0 && base.confirm === CONFIRM_PHRASE,
            canScan: base.phase === "idle" || base.phase === "ready" || base.phase === "done" || base.phase === "stopped" || base.phase === "error",
            canStop: base.phase === "scanning" || base.phase === "running"
        };
    }

    function set(change: Partial<Omit<DeleteState, "canStart" | "canScan" | "canStop">>) {
        if (disposed) return;
        const { canStart: _a, canScan: _b, canStop: _c, ...current } = state;
        state = build({ ...current, ...change });
        for (const listener of [...listeners]) listener();
    }

    const isStopped = () => stopRequested || disposed;

    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        setConfirm(text: string) {
            if (state.phase !== "ready") return;
            set({ confirm: String(text).slice(0, 20) });
        },

        /** Counts the messages that could be deleted. Deletes nothing. */
        async scan() {
            if (!state.canScan) return;
            stopRequested = false;
            own = [];
            set({ phase: "scanning", scanned: 0, found: 0, deleted: 0, failed: 0, confirm: "", feed: [], message: MESSAGES.scanning });
            try {
                const result = await scanOwn(deps, isStopped, (scanned, found) => { set({ scanned, found }); });
                if (disposed) return;
                if (stopRequested) {
                    set({ phase: "idle", scanned: result.scanned, found: 0, message: MESSAGES.stoppedScan });
                    return;
                }
                own = result.own;
                const partial = result.complete ? "" : " It stopped before the oldest message, so there may be more.";
                set({
                    phase: "ready",
                    scanned: result.scanned,
                    found: own.length,
                    message: own.length === 0 ? `${MESSAGES.nothing} (${result.scanned} messages read: ${result.others} from other accounts, ${result.unusable} of yours that Discord does not let you delete, ${result.pinned} of yours pinned and kept.)` : `Found ${own.length} of your messages (${result.scanned} read).${partial} Type ${CONFIRM_PHRASE} to unlock the delete button.`
                });
            } catch (error) {
                set({ phase: "error", message: `The scan failed: ${error instanceof Error ? error.message : String(error)}` });
            }
        },

        /** Deletes what the scan found, if the word was typed. */
        async start() {
            if (!state.canStart) return;
            stopRequested = false;
            const total = own.length;
            set({ phase: "running", deleted: 0, failed: 0, confirm: "", message: `Deleting... 0 of ${total}` });
            const push = (line: FeedLine) => { set({ feed: [line, ...state.feed].slice(0, FEED_MAX) }); };
            try {
                const result = await purge(deps, own, isStopped, {
                    deleted: message => {
                        set({ deleted: state.deleted + 1, message: `Deleting... ${state.deleted + 1 + state.failed} of ${total}` });
                        push({ id: message.id, kind: "killed", text: message.content });
                    },
                    failed: (message, reason) => {
                        set({ failed: state.failed + 1, message: `Deleting... ${state.deleted + state.failed + 1} of ${total}` });
                        push({ id: message.id, kind: "failed", text: message.content, note: reason });
                    }
                });
                if (disposed) return;
                own = [];
                if (result.ended === "stopped") set({ phase: "stopped", message: `Stopped: ${result.deleted} deleted, ${result.failed} failed.` });
                else if (result.ended === "failing") set({ phase: "error", message: `Stopped: ${MAX_IN_A_ROW} deletions in a row failed. ${result.deleted} deleted.` });
                else set({ phase: "done", message: `Done: ${result.deleted} deleted, ${result.failed} failed.` });
            } catch (error) {
                set({ phase: "error", message: `Deleting failed: ${error instanceof Error ? error.message : String(error)}` });
            }
        },

        /** Stops a scan or a deletion at the next message. */
        stop() {
            if (!state.canStop) return;
            stopRequested = true;
        },

        /** The window was closed: whatever is running stops, nothing more is told to anybody. */
        dispose() {
            disposed = true;
            listeners.clear();
        }
    };
}

export type DeleteController = ReturnType<typeof createController>;
