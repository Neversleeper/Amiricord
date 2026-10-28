/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The part of DeleteMe that decides what to delete and how: it reads the messages of ONE channel, keeps only the ones the account itself wrote, and deletes them
// one by one, slowly, stopping when asked, waiting when Discord says "slow down", and giving up when everything fails. It does not touch the page: the channel's
// messages, the delete call, the waiting and the clock are handed to it, so it is tested with fakes. The window, the confirmation and the buttons are in `controller.ts`.
// Written for Amiricord (2026); the idea and the look of the window come from the plugin DeleteMe of TestCord (its style file; its code was not available).

/** What Discord gives for a message, as far as this code looks at it. */
export interface RawMessage {
    id: string;
    type?: number;
    pinned?: boolean;
    content?: string;
    timestamp?: string;
    author?: { id?: string; };
}

export interface OwnMessage {
    id: string;
    content: string;
}

export interface PurgeOptions {
    /** Wait between two deletions (ms). */
    delayMs: number;
    skipPinned: boolean;
}

export interface PurgeDeps {
    /** The id of the account whose messages may be deleted. */
    me: string;
    /** The messages of the channel, newest first, up to 100, older than the message `before` when it is given. */
    list(before: string | undefined): Promise<RawMessage[]>;
    /** Delete one message. Rejects with `{ status, body: { retry_after } }` like Discord's own calls. */
    remove(id: string): Promise<void>;
    sleep(ms: number): Promise<void>;
    options(): PurgeOptions;
}

/** Messages Discord lets their author delete: a normal message, a reply, a slash command and a context-menu command. */
export const DELETABLE_TYPES = [0, 19, 20, 23];
export const PAGE_SIZE = 100;
export const MAX_PAGES = 500;
export const PAGE_DELAY_MS = 300;
export const MAX_RETRIES = 5;
export const MAX_RETRY_WAIT_MS = 60_000;
export const DEFAULT_RETRY_WAIT_MS = 2000;
export const MAX_IN_A_ROW = 10;
export const PREVIEW_LENGTH = 80;

export interface ScanResult {
    own: OwnMessage[];
    scanned: number;
    /** False when it stopped before reaching the oldest message (asked to stop, or too many pages). */
    complete: boolean;
    /** Messages read that were written by somebody else. */
    others: number;
    /** Own messages of a kind Discord does not let the author delete (joins, calls, pins...). */
    unusable: number;
    /** Own pinned messages that were kept because of the setting. */
    pinned: number;
}

const preview = (text: string | undefined) => {
    const clean = (text ?? "").replace(/\s+/g, " ").trim();
    if (clean === "") return "(no text)";
    return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1)}…` : clean;
};

/** Reads the channel from the newest message backwards and gathers the ones this account wrote. Nothing is deleted. */
export async function scanOwn(deps: PurgeDeps, isStopped: () => boolean, onPage?: (scanned: number, found: number) => void): Promise<ScanResult> {
    const own: OwnMessage[] = [];
    const seen = new Set<string>();
    let scanned = 0;
    let others = 0;
    let unusable = 0;
    let pinned = 0;
    let before: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        if (isStopped()) return { own, scanned, complete: false, others, unusable, pinned };
        const messages = await deps.list(before);
        const skipPinned = deps.options().skipPinned;
        for (const message of messages) {
            scanned++;
            if (seen.has(message.id)) continue;
            seen.add(message.id);
            if (message.author?.id !== deps.me) {
                others++;
                continue;
            }
            if (!DELETABLE_TYPES.includes(message.type ?? 0)) {
                unusable++;
                continue;
            }
            if (skipPinned && message.pinned) {
                pinned++;
                continue;
            }
            own.push({ id: message.id, content: preview(message.content) });
        }
        onPage?.(scanned, own.length);
        if (messages.length < PAGE_SIZE) return { own, scanned, complete: true, others, unusable, pinned };
        before = messages[messages.length - 1].id;
        await deps.sleep(PAGE_DELAY_MS);
    }
    return { own, scanned, complete: false, others, unusable, pinned };
}

export interface PurgeEvents {
    deleted(message: OwnMessage): void;
    failed(message: OwnMessage, reason: string): void;
}

export interface PurgeResult {
    deleted: number;
    failed: number;
    /** Why it ended early: asked to stop, or everything failed. Undefined when it went through the whole list. */
    ended?: "stopped" | "failing";
}

interface RejectionLike { status?: unknown; body?: { retry_after?: unknown; message?: unknown; }; text?: unknown; message?: unknown; }

const reasonOf = (error: unknown) => {
    const e = error as RejectionLike | null | undefined;
    const text = e?.body?.message ?? e?.message ?? e?.text;
    return typeof text === "string" && text !== "" ? text.slice(0, 120) : `error ${String(e?.status ?? "unknown")}`;
};

/** Seconds Discord asked to wait, as milliseconds (never more than a minute), or the default when it did not say. */
export function retryWait(error: unknown): number {
    const seconds = Number((error as RejectionLike | null | undefined)?.body?.retry_after);
    if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_WAIT_MS;
    return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_WAIT_MS);
}

/** Deletes the given messages one by one, slowly. A message that is already gone counts as deleted; a refused one is left and counted as failed. */
export async function purge(deps: PurgeDeps, messages: OwnMessage[], isStopped: () => boolean, events: PurgeEvents): Promise<PurgeResult> {
    const result: PurgeResult = { deleted: 0, failed: 0 };
    let inARow = 0;
    for (const message of messages) {
        if (isStopped()) { result.ended = "stopped"; return result; }
        let tries = 0;
        for (;;) {
            try {
                await deps.remove(message.id);
                result.deleted++;
                inARow = 0;
                events.deleted(message);
                break;
            } catch (error) {
                const status = (error as RejectionLike | null | undefined)?.status;
                if (status === 404) {
                    result.deleted++;
                    inARow = 0;
                    events.deleted(message);
                    break;
                }
                if (status === 429 && tries < MAX_RETRIES) {
                    tries++;
                    await deps.sleep(retryWait(error));
                    if (isStopped()) { result.ended = "stopped"; return result; }
                    continue;
                }
                result.failed++;
                inARow++;
                events.failed(message, reasonOf(error));
                break;
            }
        }
        if (inARow >= MAX_IN_A_ROW) { result.ended = "failing"; return result; }
        await deps.sleep(deps.options().delayMs);
    }
    return result;
}
