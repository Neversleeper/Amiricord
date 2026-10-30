/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The list of the notifications plugins have shown in this session (the "Notification Log" of the main tab). It lives in the page's memory only: nothing is written to
// disk, because a notification can carry a name or a message that a plugin read (Relationship Notifier, for one), and it is gone when Discord closes. It keeps the most
// recent ones up to a limit the owner chooses. Pure code with no Discord and no page, so it is tested. Written from scratch; no code of another mod.

export interface LoggedNotification {
    /** Grows by one for each notification, so a list can be keyed and a newer one is always larger. */
    id: number;
    /** Milliseconds since 1970, when the notification was shown. */
    at: number;
    /** The plugin that showed it. */
    plugin: string;
    title: string;
    body: string;
}

/** The sizes offered in the options window. */
export const LOG_SIZE_CHOICES = [25, 50, 100, 200] as const;
export const DEFAULT_LOG_SIZE = 100;

/** A saved size when it is one of the choices; the default for anything else (a file edited by hand, an older version). */
export function logSizeOf(value: unknown): number {
    return typeof value === "number" && (LOG_SIZE_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_LOG_SIZE;
}

export interface NotificationLog {
    /** Keep one more, and drop the oldest ones that are over `limit`. */
    add(plugin: string, title: string, body: string, limit: number): void;
    /** The kept ones, newest first. A new array each time. */
    list(): LoggedNotification[];
    /** Forget all of them. */
    clear(): void;
    /** Drop the oldest ones that are over `limit` (the owner lowered the size). */
    trim(limit: number): void;
    /** Be told when the list changes. Returns the way to stop. */
    subscribe(listener: () => void): () => void;
    /** A number that changes whenever the list does (for React's `useSyncExternalStore`). */
    version(): number;
}

export function createNotificationLog(now: () => number = () => Date.now()): NotificationLog {
    let entries: LoggedNotification[] = [];
    let nextId = 1;
    let changes = 0;
    const listeners = new Set<() => void>();

    const changed = () => {
        changes++;
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {
                // A listener that fails must not stop the others, nor the plugin that showed the notification.
            }
        }
    };
    const keep = (limit: number) => {
        const most = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : DEFAULT_LOG_SIZE));
        if (entries.length > most) entries = entries.slice(entries.length - most);
    };

    return {
        add(plugin, title, body, limit) {
            entries.push({ id: nextId++, at: now(), plugin, title, body });
            keep(limit);
            changed();
        },
        list: () => [...entries].reverse(),
        clear() {
            if (entries.length === 0) return;
            entries = [];
            changed();
        },
        trim(limit) {
            const before = entries.length;
            keep(limit);
            if (entries.length !== before) changed();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        version: () => changes
    };
}
