/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A bar across the top of Discord's window with a message and up to two buttons: `ctx.notices.show({ id, text, buttons })`. It stays until the person closes it or the
// plugin takes it back (`ctx.notices.dismiss(id)`), and it goes when the plugin stops. TestCord has an API like this (`Notices`); this one is written from scratch and is
// an element of its own over the page, so it patches nothing and cannot break when Discord changes. The text is always set as text, never as HTML. A plugin may keep
// at most 2 bars; the page shows at most 3 at the same time (the oldest wait their turn). No permission needed: the bar only shows text the plugin gives it.

export type NoticeKind = "info" | "success" | "warning" | "danger";

export interface NoticeButton {
    label: string;
    onClick(): void;
}

export interface NoticeDefinition {
    /** Unique among the plugin's own bars. Showing the same id again replaces the bar. */
    id: string;
    text: string;
    kind?: NoticeKind;
    /** Up to two buttons. A click runs `onClick` and closes the bar. */
    buttons?: NoticeButton[];
    /** Whether the person may close the bar with the x. Default true. */
    closable?: boolean;
}

export interface PluginNotices {
    /** Shows a bar. Returns false (and shows nothing) for a bad definition. */
    show(notice: NoticeDefinition): boolean;
    /** Takes a bar of this plugin away. Safe to call for one that is not there. */
    dismiss(id: string): void;
}

export const MAX_NOTICES_PER_PLUGIN = 2;
export const MAX_NOTICES_ON_SCREEN = 3;
export const MAX_NOTICE_TEXT = 300;
export const MAX_NOTICE_BUTTONS = 2;
export const MAX_BUTTON_LABEL = 30;
export const NOTICE_ATTRIBUTE = "data-amiricord-notice";
const STYLE_NAME = "notices";
const HOST_ID = "amiricord-notices";

export const NOTICES_CSS = `
#${HOST_ID} { position: fixed; top: 0; left: 0; right: 0; z-index: 9998; display: flex; flex-direction: column; pointer-events: none; }
[${NOTICE_ATTRIBUTE}] { pointer-events: auto; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 6px 40px 6px 16px; font-size: 14px; font-weight: 500; color: #fff; background: var(--notice-bg, #5865f2); position: relative; }
[${NOTICE_ATTRIBUTE}][data-kind="success"] { background: #248046; }
[${NOTICE_ATTRIBUTE}][data-kind="warning"] { background: #9a6700; }
[${NOTICE_ATTRIBUTE}][data-kind="danger"] { background: #d83c3e; }
[${NOTICE_ATTRIBUTE}] button { cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.7); border-radius: 4px; background: transparent; color: #fff; font: inherit; font-size: 13px; padding: 1px 10px; }
[${NOTICE_ATTRIBUTE}] button:hover { background: rgba(255, 255, 255, 0.15); }
[${NOTICE_ATTRIBUTE}] [data-notice-close] { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: 0; font-size: 18px; line-height: 1; padding: 0 6px; }
`;

const KINDS: readonly string[] = ["info", "success", "warning", "danger"];

/** The definition cleaned up (texts cut to their limits, extra buttons dropped), or undefined when it cannot be shown. */
export function cleanNotice(notice: unknown): Required<Pick<NoticeDefinition, "id" | "text" | "kind" | "closable">> & { buttons: NoticeButton[]; } | undefined {
    const value = notice as Partial<NoticeDefinition> | null | undefined;
    if (!value || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 64) return undefined;
    if (typeof value.text !== "string" || value.text.trim().length === 0) return undefined;
    const buttons = (Array.isArray(value.buttons) ? value.buttons : [])
        .filter(button => button && typeof button.label === "string" && button.label.trim() !== "" && typeof button.onClick === "function")
        .slice(0, MAX_NOTICE_BUTTONS)
        .map(button => ({ label: button.label.trim().slice(0, MAX_BUTTON_LABEL), onClick: button.onClick }));
    const text = value.text.trim();
    return {
        id: value.id,
        text: text.length > MAX_NOTICE_TEXT ? `${text.slice(0, MAX_NOTICE_TEXT - 1)}…` : text,
        kind: typeof value.kind === "string" && KINDS.includes(value.kind) ? value.kind : "info",
        closable: value.closable !== false,
        buttons
    };
}

/** The height of the window's own title bar (the strip with the minimize and close buttons), so the bar sits under it and does not cover them. 0 when there is none. Checked live on Discord build 655747: `div.bar_*`, 32 pixels. */
export function titleBarHeight(doc: Document): number {
    try {
        for (const bar of doc.querySelectorAll("div[class^=\"bar_\"]")) {
            const rect = (bar as HTMLElement).getBoundingClientRect?.();
            if (rect && rect.top <= 1 && rect.height > 0 && rect.height <= 40 && rect.width > 300) return Math.round(rect.height);
        }
    } catch {
        // No title bar found.
    }
    return 0;
}

export interface NoticesPage {
    document: Document;
    setTimeout?(run: () => void, ms: number): unknown;
}

interface Entry { plugin: string; id: string; element: HTMLElement; }

export class NoticesHub {
    private readonly entries = new Map<string, Entry>();
    private readonly waiting: Array<{ plugin: string; notice: NonNullable<ReturnType<typeof cleanNotice>>; }> = [];
    private styled = false;

    constructor(private readonly page: NoticesPage, private readonly addStyle: (css: string, name: string) => void, private readonly onError: (plugin: string, source: string, error: unknown) => void) {}

    show(plugin: string, definition: NoticeDefinition): boolean {
        const notice = cleanNotice(definition);
        if (!notice) return false;
        this.remove(plugin, notice.id, false);
        const mine = [...this.entries.values(), ...this.waiting.map(item => ({ plugin: item.plugin }))].filter(entry => entry.plugin === plugin).length;
        if (mine >= MAX_NOTICES_PER_PLUGIN) return false;
        if (this.entries.size >= MAX_NOTICES_ON_SCREEN) { this.waiting.push({ plugin, notice }); return true; }
        return this.draw(plugin, notice);
    }

    dismiss(plugin: string, id: string): void { this.remove(plugin, id, true); }

    removeAll(plugin: string): void {
        for (const entry of [...this.entries.values()]) if (entry.plugin === plugin) this.remove(plugin, entry.id, false);
        for (let index = this.waiting.length - 1; index >= 0; index--) if (this.waiting[index].plugin === plugin) this.waiting.splice(index, 1);
        this.fill();
    }

    private remove(plugin: string, id: string, fill: boolean): void {
        const key = `${plugin}:${id}`;
        const entry = this.entries.get(key);
        if (entry) { entry.element.remove(); this.entries.delete(key); }
        const waitingAt = this.waiting.findIndex(item => item.plugin === plugin && item.notice.id === id);
        if (waitingAt >= 0) this.waiting.splice(waitingAt, 1);
        if (fill) this.fill();
    }

    private fill(): void {
        while (this.entries.size < MAX_NOTICES_ON_SCREEN && this.waiting.length > 0) {
            const next = this.waiting.shift()!;
            this.draw(next.plugin, next.notice);
        }
    }

    private host(): HTMLElement | undefined {
        const doc = this.page.document;
        const body = doc.body as HTMLElement | null;
        if (!body) return undefined;
        let host = doc.getElementById(HOST_ID);
        if (!host) {
            if (!this.styled) { this.styled = true; this.addStyle(NOTICES_CSS, STYLE_NAME); }
            host = doc.createElement("div");
            host.id = HOST_ID;
            body.append(host);
        }
        this.place(host, 0);
        return host;
    }

    /** Puts the bars under the title bar. When the bar is not drawn yet (Discord is still starting) it looks again a few times. */
    private place(host: HTMLElement, attempt: number): void {
        const height = titleBarHeight(this.page.document);
        host.style.top = `${height}px`;
        if (height === 0 && attempt < 20 && this.page.setTimeout) this.page.setTimeout(() => { if (host.isConnected !== false) this.place(host, attempt + 1); }, 500);
    }

    private draw(plugin: string, notice: NonNullable<ReturnType<typeof cleanNotice>>): boolean {
        const host = this.host();
        if (!host) return false;
        const doc = this.page.document;
        const element = doc.createElement("div");
        element.setAttribute(NOTICE_ATTRIBUTE, `${plugin}:${notice.id}`);
        element.setAttribute("data-kind", notice.kind);
        element.setAttribute("role", "status");
        const text = doc.createElement("span");
        text.textContent = notice.text;
        element.append(text);
        for (const definition of notice.buttons) {
            const button = doc.createElement("button");
            button.setAttribute("type", "button");
            button.textContent = definition.label;
            button.addEventListener("click", () => {
                try { definition.onClick(); } catch (error) { this.onError(plugin, `notice ${notice.id}`, error); }
                this.dismiss(plugin, notice.id);
            });
            element.append(button);
        }
        if (notice.closable) {
            const close = doc.createElement("button");
            close.setAttribute("type", "button");
            close.setAttribute("data-notice-close", "");
            close.setAttribute("aria-label", "Close");
            close.textContent = "×";
            close.addEventListener("click", () => { this.dismiss(plugin, notice.id); });
            element.append(close);
        }
        host.append(element);
        this.entries.set(`${plugin}:${notice.id}`, { plugin, id: notice.id, element });
        return true;
    }
}

export function buildNotices(hub: NoticesHub, plugin: string, onDispose: (callback: () => void) => void): PluginNotices {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        show(notice) { return hub.show(plugin, notice); },
        dismiss(id) { hub.dismiss(plugin, id); }
    };
}
