/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A short message at the bottom of the page ("Copied!"). The text is set as text, never as markup. Messages are removed after a few seconds and when the plugin
// that showed them stops. Plugins that bring their own look can still draw their own; this is the common one.

export type ToastKind = "info" | "success" | "failure";

export interface PluginToasts {
    show(message: string, kind?: ToastKind): void;
}

export const TOAST_MS = 3500;
export const TOAST_MAX_LENGTH = 300;
const BOX_CLASS = "amiricord-toasts";

export const TOAST_CSS = `
.${BOX_CLASS} { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: 100000; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.amiricord-toast { max-width: 420px; padding: 10px 16px; border-radius: 8px; font-size: 14px; line-height: 1.3; color: #fff; background: #1e1f22; box-shadow: 0 6px 20px rgba(0, 0, 0, .45); border-left: 4px solid #5865f2; }
.amiricord-toast-success { border-left-color: #23a55a; }
.amiricord-toast-failure { border-left-color: #f23f43; }
`;

export interface ToastPage {
    document: Document;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

/** One per plugin: it adds the CSS the first time a message is shown. */
export function buildToasts(page: ToastPage, addStyle: (css: string) => void, onDispose: (undo: () => void) => void): PluginToasts {
    const live = new Set<{ remove(): void; timer: unknown; }>();
    let styled = false;
    onDispose(() => {
        for (const toast of live) { page.clearTimeout(toast.timer); toast.remove(); }
        live.clear();
    });
    return {
        show(message, kind = "info") {
            if (!styled) {
                styled = true;
                addStyle(TOAST_CSS);
            }
            const { document: doc } = page;
            let box = doc.querySelector(`.${BOX_CLASS}`);
            if (!box) {
                box = doc.createElement("div");
                box.className = BOX_CLASS;
                doc.body.append(box);
            }
            const toast = doc.createElement("div");
            toast.className = kind === "info" ? "amiricord-toast" : `amiricord-toast amiricord-toast-${kind}`;
            toast.setAttribute("role", "status");
            toast.textContent = String(message).slice(0, TOAST_MAX_LENGTH);
            box.append(toast);
            const entry = { remove: () => { toast.remove(); }, timer: undefined as unknown };
            entry.timer = page.setTimeout(() => { toast.remove(); live.delete(entry); }, TOAST_MS);
            live.add(entry);
        }
    };
}
