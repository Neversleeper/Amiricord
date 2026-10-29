/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The window of "Notification options": the three choices about the notifications Amiricord's plugins show inside Discord's window. Every change is kept at once (there is no
// Save). It does not touch Discord's own message notifications, and it says so. It is drawn with the engine's modal pieces.

import { currentReact } from "../../api/jsxRuntime";
import { LOG_SIZE_CHOICES } from "../../api/notificationLog";
import type { WindowParts } from "./PluginWindow";

export interface NotificationOptions {
    /** Whether a plugin's notification is drawn as a card in the corner of the window. */
    cards: boolean;
    /** Whether the notifications are kept in the Notification Log. */
    log: boolean;
    /** How many the log keeps. */
    size: number;
}

export interface NotificationOptionsWindowDeps {
    read(): NotificationOptions;
    set(change: Partial<NotificationOptions>): void;
    parts: WindowParts;
}

export const OPTIONS_INTRO = "What the notifications of Amiricord's plugins do inside Discord's window. Discord's own message notifications are not affected.";
export const CARDS_TEXT = "Show a card in the corner";
export const CARDS_HELP = "When a plugin has something to tell you it draws a small card for a few seconds. Turn this off to not see the cards; the notification is still kept in the log if the log is on.";
export const LOG_TEXT = "Keep the Notification Log";
export const LOG_HELP = "Keeps what plugins showed in this session, in memory only, so you can read it again. Turning it off does not clear what is already there.";
export const SIZE_TEXT = "How many to keep";
export const SIZE_HELP = "When there are more, the oldest ones are dropped.";

function SwitchLine({ title, help, on, flip }: { title: string; help: string; on: boolean; flip(): void; }) {
    const key = (event: { key?: string; preventDefault?(): void; }) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault?.();
            flip();
        }
    };
    return (
        <div className="amiricord-switch-row">
            <div className="amiricord-switch-text">
                <div className="amiricord-switch-title">{title}</div>
                <div className="amiricord-switch-desc">{help}</div>
            </div>
            <div
                role="switch" aria-checked={on ? "true" : "false"} aria-label={title} tabIndex={0}
                className="amiricord-switch amiricord-switch-live" onClick={flip} onKeyDown={key}
            ><span className="amiricord-knob" /></div>
        </div>
    );
}

export function makeNotificationOptionsWindow(deps: NotificationOptionsWindowDeps) {
    const { ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } = deps.parts;
    return function NotificationOptionsWindow({ onClose }: { onClose(): void; }) {
        const react = currentReact();
        const start = deps.read();
        const [cards, setCards] = react.useState(start.cards);
        const [log, setLog] = react.useState(start.log);
        const [size, setSize] = react.useState(start.size);

        return (
            <ModalRoot size="medium" label="Notification options" onClose={onClose}>
                <ModalHeader>
                    <div className="amiricord-pwin-title">Notification options</div>
                    <ModalCloseButton onClick={onClose} />
                </ModalHeader>
                <ModalContent>
                    <p className="amiricord-pwin-desc">{OPTIONS_INTRO}</p>
                    <SwitchLine title={CARDS_TEXT} help={CARDS_HELP} on={cards} flip={() => { const next = !cards; setCards(next); deps.set({ cards: next }); }} />
                    <SwitchLine title={LOG_TEXT} help={LOG_HELP} on={log} flip={() => { const next = !log; setLog(next); deps.set({ log: next }); }} />
                    <div className="amiricord-choice">
                        <div className="amiricord-switch-title">{SIZE_TEXT}</div>
                        <div className="amiricord-switch-desc">{SIZE_HELP}</div>
                        <select
                            className="amiricord-plugins-select" aria-label={SIZE_TEXT} value={String(size)}
                            onChange={(event: { target: { value: string; }; }) => {
                                const next = Number(event.target.value);
                                if (!(LOG_SIZE_CHOICES as readonly number[]).includes(next)) return;
                                setSize(next);
                                deps.set({ size: next });
                            }}
                        >
                            {LOG_SIZE_CHOICES.map(choice => <option key={choice} value={String(choice)}>{String(choice)}</option>)}
                        </select>
                    </div>
                </ModalContent>
                <ModalFooter>
                    <button type="button" className="amiricord-button" onClick={onClose}>Close</button>
                </ModalFooter>
            </ModalRoot>
        );
    };
}
