/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Notifications inside Discord's window: `ctx.notifications.show({ title, body, ... })` draws a small card in a corner of the page and takes it away again.
// It is plain DOM made here, so it needs no Discord module and no permission; it is not the browser's `Notification`. Text is always set as text, never as HTML.
// A plugin can have a few cards at once (the oldest goes when it asks for more), the sizes are limited, an icon is accepted only as an https or an image data
// address, and everything a plugin showed is taken away when it stops. Design: docs/analysis-50-engine-apis-devtools-menus-sounds-notifications.md.

export interface NotificationOptions {
    title: string;
    body?: string;
    /** An `https:` address or a `data:image/...` one. Anything else is ignored. */
    icon?: string;
    /** Runs when the card is pressed (or Enter or Space is pressed on it). */
    onClick?(): void;
    /** Close the card when it is pressed, after `onClick`. Default true. */
    dismissOnClick?: boolean;
    /** How long it stays, in milliseconds. Default 6 000; 0 keeps it until it is closed; never more than 60 000. */
    timeoutMs?: number;
}

export interface NotificationHandle {
    /** Take the card away. Calling it again does nothing. */
    close(): void;
}

export interface PluginNotifications {
    /** Show a card. Returns a handle to close it. A card with no title and no body is not shown (the handle does nothing). */
    show(options: NotificationOptions): NotificationHandle;
    /** Take away every card this plugin showed and has not closed. */
    closeAll(): void;
}

export const MAX_CARDS_PER_PLUGIN = 5;
export const TITLE_MAX = 120;
export const BODY_MAX = 400;
export const DEFAULT_TIMEOUT_MS = 6000;
export const MAX_TIMEOUT_MS = 60_000;
const ICON_MAX = 200_000;

/** The part of a DOM event the cards use. */
export interface EventLike {
    key?: string;
    stopPropagation?(): void;
    preventDefault?(): void;
}

/** The part of a DOM element the cards use. The real elements fit. */
export interface ElementLike {
    className: string;
    textContent: string | null;
    tabIndex: number;
    src?: string;
    setAttribute(name: string, value: string): void;
    append(...children: ElementLike[]): void;
    remove(): void;
    addEventListener(type: string, listener: (event: EventLike) => void): void;
}

export interface DocumentLike {
    createElement(tag: string): ElementLike;
    body?: { append(...children: ElementLike[]): void; } | null;
}

export interface NotificationLayerDeps {
    /** The page's document. Without one nothing is drawn and every handle does nothing. */
    document?: DocumentLike;
    setTimeout(work: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
    /** Put the cards' CSS into the page (called once, the first time a card is shown). */
    addStyle(css: string): void;
}

export const NOTIFICATION_CSS = `
.amiricord-notifications { position: fixed; right: 16px; bottom: 16px; z-index: 1003; display: flex; flex-direction: column; gap: 8px; width: 340px; max-width: calc(100vw - 32px); pointer-events: none; }
.amiricord-notification { position: relative; display: flex; align-items: flex-start; gap: 10px; box-sizing: border-box; padding: 12px 36px 12px 12px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1)); border-radius: 8px; color: var(--text-default, #dbdee1); background: var(--background-floating, var(--background-surface-high, #1e1f22)); box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, 0.4)); pointer-events: auto; cursor: default; }
.amiricord-notification[role="button"] { cursor: pointer; }
.amiricord-notification[role="button"]:hover { background: var(--background-surface-highest, var(--background-floating, #232428)); }
.amiricord-notification:focus-visible { outline: 2px solid var(--border-focus, #00a8fc); outline-offset: 2px; }
.amiricord-notification-icon { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 6px; object-fit: cover; }
.amiricord-notification-text { flex: 1; min-width: 0; }
.amiricord-notification-title { font-size: 14px; font-weight: 600; line-height: 1.25; color: var(--text-strong, var(--text-default, #f2f3f5)); overflow-wrap: anywhere; }
.amiricord-notification-body { margin-top: 2px; font-size: 13px; line-height: 1.3; color: var(--text-subtle, var(--text-muted, #b5bac1)); overflow-wrap: anywhere; white-space: pre-wrap; }
.amiricord-notification-close { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; font: inherit; font-size: 18px; line-height: 1; cursor: pointer; color: var(--interactive-normal, #b5bac1); background: transparent; }
.amiricord-notification-close:hover { color: var(--interactive-hover, #dbdee1); background: var(--background-modifier-hover, rgba(255, 255, 255, 0.07)); }
`;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The text of an option as a short string: a missing or non-text value is empty. */
function textOf(value: unknown, max: number): string {
    return typeof value === "string" ? cut(value.trim(), max) : "";
}

/** An icon address a card may load: https, or a small image given in the address itself. Anything else (javascript:, file:, http:, blob:) is dropped. */
export function safeIcon(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    if (value.length > ICON_MAX) return undefined;
    if (/^https:\/\/[^\s]+$/i.test(value)) return value;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
    return undefined;
}

/** How long a card stays: the default for anything that is not a number, 0 for "until closed", never more than the largest allowed. */
export function timeoutOf(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

export function createNotificationLayer(deps: NotificationLayerDeps) {
    let container: ElementLike | undefined;

    /** The corner where the cards go, made the first time one is shown. Undefined when there is no page to draw in. */
    const corner = (): ElementLike | undefined => {
        if (container) return container;
        const page = deps.document;
        if (!page?.body) return undefined;
        deps.addStyle(NOTIFICATION_CSS);
        const made = page.createElement("div");
        made.className = "amiricord-notifications";
        made.setAttribute("role", "region");
        made.setAttribute("aria-label", "Notifications");
        made.setAttribute("aria-live", "polite");
        page.body.append(made);
        container = made;
        return container;
    };

    return {
        forPlugin(id: string, onDispose: (undo: () => void) => void, reportError: (source: string, error: unknown) => void): PluginNotifications {
            const cards: Array<{ close(): void; }> = [];
            let registered = false;
            const none: NotificationHandle = { close() { /* nothing was shown */ } };

            const closeAll = () => {
                for (const card of [...cards]) card.close();
            };

            return {
                show(options) {
                    const input = typeof options === "object" && options !== null ? options : ({} as Partial<NotificationOptions>);
                    const title = textOf(input.title, TITLE_MAX);
                    const body = textOf(input.body, BODY_MAX);
                    if (title === "" && body === "") return none;
                    const page = deps.document;
                    const where = corner();
                    if (!page || !where) return none;

                    const onClick = typeof input.onClick === "function" ? input.onClick : undefined;
                    const dismiss = input.dismissOnClick !== false;
                    const clickable = onClick !== undefined || dismiss;
                    const icon = safeIcon(input.icon);
                    const ms = timeoutOf(input.timeoutMs);

                    // The oldest card of this plugin goes when it asks for more than it may have.
                    while (cards.length >= MAX_CARDS_PER_PLUGIN) cards[0].close();

                    const card = page.createElement("div");
                    card.className = "amiricord-notification";
                    card.setAttribute("data-plugin", id);
                    card.setAttribute("role", clickable ? "button" : "status");
                    if (clickable) card.tabIndex = 0;
                    if (icon) {
                        const image = page.createElement("img");
                        image.className = "amiricord-notification-icon";
                        image.src = icon;
                        image.setAttribute("alt", "");
                        card.append(image);
                    }
                    const text = page.createElement("div");
                    text.className = "amiricord-notification-text";
                    if (title !== "") {
                        const heading = page.createElement("div");
                        heading.className = "amiricord-notification-title";
                        heading.textContent = title;
                        text.append(heading);
                    }
                    if (body !== "") {
                        const paragraph = page.createElement("div");
                        paragraph.className = "amiricord-notification-body";
                        paragraph.textContent = body;
                        text.append(paragraph);
                    }
                    card.append(text);
                    const cross = page.createElement("button");
                    cross.className = "amiricord-notification-close";
                    cross.setAttribute("type", "button");
                    cross.setAttribute("aria-label", "Close");
                    cross.textContent = "×";
                    card.append(cross);

                    let timer: unknown;
                    let closed = false;
                    const entry = {
                        close() {
                            if (closed) return;
                            closed = true;
                            if (timer !== undefined) deps.clearTimeout(timer);
                            card.remove();
                            const at = cards.indexOf(entry);
                            if (at >= 0) cards.splice(at, 1);
                        }
                    };

                    const press = () => {
                        if (onClick) {
                            try {
                                onClick();
                            } catch (error) {
                                reportError("notification click", error);
                            }
                        }
                        if (dismiss) entry.close();
                    };
                    if (clickable) {
                        card.addEventListener("click", press);
                        card.addEventListener("keydown", event => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault?.();
                                press();
                            }
                        });
                    }
                    cross.addEventListener("click", event => {
                        event.stopPropagation?.();
                        entry.close();
                    });

                    where.append(card);
                    cards.push(entry);
                    if (ms > 0) timer = deps.setTimeout(() => { entry.close(); }, ms);

                    // The first card registers one undo with the plugin's lifecycle, so switching the plugin off takes its cards away.
                    if (!registered) {
                        registered = true;
                        onDispose(closeAll);
                    }
                    return { close: () => { entry.close(); } };
                },
                closeAll
            };
        }
    };
}
