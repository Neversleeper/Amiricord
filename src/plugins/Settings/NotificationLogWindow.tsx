/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The window of the "Notification Log" tile and of "Open the log": what plugins have shown in this session, newest first, with the time, the plugin and the text. It keeps
// itself up to date while it is open (the list tells it when it changes). The list is in memory only, and the window says so. It is drawn with the engine's modal pieces.
// Design: docs/analysis-10-testcord-main-settings-and-cloud.md section 4 (the log of TestCord); the storage is ours (memory, not disk).

import { currentReact } from "../../api/jsxRuntime";
import type { LoggedNotification } from "../../api/notificationLog";
import type { WindowParts } from "./PluginWindow";

export interface NotificationLogWindowDeps {
    /** The kept notifications, newest first. */
    list(): LoggedNotification[];
    clear(): void;
    subscribe(listener: () => void): () => void;
    version(): number;
    parts: WindowParts;
}

export const MEMORY_NOTE = "This list is kept in memory only, for this session. It is gone when Discord closes, and nothing is written to your disk.";
export const EMPTY_TEXT = "No notifications yet in this session.";

/** The time of day a notification was shown, as hours, minutes and seconds of the local clock. */
export function clockOf(at: number): string {
    const when = new Date(at);
    const two = (value: number) => String(value).padStart(2, "0");
    return `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}`;
}

export function makeNotificationLogWindow(deps: NotificationLogWindowDeps) {
    const { ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } = deps.parts;
    return function NotificationLogWindow({ onClose }: { onClose(): void; }) {
        // Draws again whenever the list changes, so a notification that arrives while the window is open shows up at once.
        currentReact().useSyncExternalStore(deps.subscribe, deps.version);
        const entries = deps.list();
        return (
            <ModalRoot size="medium" label="Notification Log" onClose={onClose}>
                <ModalHeader>
                    <div className="amiricord-pwin-title">Notification Log</div>
                    <ModalCloseButton onClick={onClose} />
                </ModalHeader>
                <ModalContent>
                    <p className="amiricord-pwin-desc">{MEMORY_NOTE}</p>
                    {entries.length === 0
                        ? <p className="amiricord-hint amiricord-nlog-empty">{EMPTY_TEXT}</p>
                        : (
                            <ul className="amiricord-nlog-list" aria-label="Notifications of this session">
                                {entries.map(entry => (
                                    <li key={entry.id} className="amiricord-nlog-item">
                                        <div className="amiricord-nlog-meta"><span className="amiricord-nlog-time">{clockOf(entry.at)}</span><span className="amiricord-nlog-plugin">{entry.plugin}</span></div>
                                        {entry.title !== "" && <div className="amiricord-nlog-title">{entry.title}</div>}
                                        {entry.body !== "" && <div className="amiricord-nlog-body">{entry.body}</div>}
                                    </li>
                                ))}
                            </ul>
                        )}
                </ModalContent>
                <ModalFooter>
                    <button type="button" className="amiricord-action" aria-disabled={entries.length === 0 ? "true" : "false"} onClick={() => { if (entries.length > 0) deps.clear(); }}>Clear the list</button>
                    <button type="button" className="amiricord-button" onClick={onClose}>Close</button>
                </ModalFooter>
            </ModalRoot>
        );
    };
}
