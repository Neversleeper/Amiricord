/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "../amiricord/utils";
import type { QuestButtonDisplayMode, QuestButtonIndicatorMode } from "../settings/def";

export interface RGB {
    r: number;
    g: number;
    b: number;
}

export const QUEST_PAGE = "/quest-home";
export const q = classNameFactory("questify-");
export const leftClick = 0;
export const middleClick = 1;
export const rightClick = 2;

export function decimalToRGB(decimal: number): RGB {
    return {
        r: (decimal >> 16) & 0xff,
        g: (decimal >> 8) & 0xff,
        b: decimal & 0xff
    };
}

export function adjustRGB(rgb: RGB, shift: number): RGB {
    return {
        r: Math.max(0, Math.min(255, rgb.r + shift)),
        g: Math.max(0, Math.min(255, rgb.g + shift)),
        b: Math.max(0, Math.min(255, rgb.b + shift))
    };
}

export function isDarkish(rgb: RGB, threshold: number = 0.5): boolean {
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;

    return luminance < threshold;
}

export function canShowBadge(mode: QuestButtonIndicatorMode): boolean {
    return mode === "badge" || mode === "both";
}

export function canShowPill(mode: QuestButtonIndicatorMode): boolean {
    return mode === "pill" || mode === "both";
}

export function canShowButton(mode: QuestButtonDisplayMode): boolean {
    return mode === "always" || mode === "unclaimed";
}

function getBadgeSize(value: string, negative: boolean): number {
    const numChars = value.length;
    const subtract = negative ? 3 : 0;

    if (numChars === 1) {
        return 16;
    }

    if (numChars === 2) {
        return 21;
    }

    return (21 + (numChars - 2) * 8) - subtract;
}

export function formatLowerBadge(value: number, maxDigits: number = 4): [string, number] {
    const isNegative = value < 0;
    const absValue = Math.abs(value);

    if (maxDigits <= 0) {
        const formatted = isNegative ? `-${absValue}` : `${absValue}`;

        return [formatted, getBadgeSize(formatted, isNegative)];
    }

    const absStr = String(absValue);

    if (absStr.length <= maxDigits) {
        const formatted = isNegative ? `-${absValue}` : `${absValue}`;

        return [formatted, getBadgeSize(formatted, isNegative)];
    }

    if (absValue < 1000) {
        if (maxDigits === 1) {
            const formatted = absValue < 100
                ? (isNegative ? "<-9" : "9+")
                : (isNegative ? "<-99" : "99+");

            return [formatted, getBadgeSize(formatted, isNegative)];
        }

        if (maxDigits === 2) {
            const formatted = isNegative ? "<-99" : "99+";

            return [formatted, getBadgeSize(formatted, isNegative)];
        }
    }

    let reducedValue = absValue;
    let unit = "";
    const units = ["K", "M", "B"];

    for (let index = 0; index < units.length; index++) {
        const nextValue = Math.floor(reducedValue / 1000);

        if (nextValue === 0) {
            break;
        }

        if (index === units.length - 1 && nextValue >= 1000) {
            reducedValue = 999;
            unit = units[index];

            break;
        }

        reducedValue = nextValue;
        unit = units[index];
    }

    const formatted = isNegative ? `<-${reducedValue}${unit}` : `${reducedValue}${unit}+`;

    return [formatted, getBadgeSize(formatted, isNegative)];
}

export interface AlertOptions {
    title: string;
    body: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "primary" | "critical-primary" | "expressive";
    onConfirm?: () => void;
    onCancel?: () => void;
    onCloseCallback?: () => void;
    contextKey?: string;
}

export interface AlertsType {
    show: (options: AlertOptions) => void;
    close: () => void;
    confirm: (options: AlertOptions) => Promise<boolean>;
}

let closeCurrentAlert: (() => void) | undefined;

function showAlert(options: AlertOptions, onResult?: (confirmed: boolean) => void): void {
    const page = (globalThis as { document?: Document; }).document;
    if (!page?.body) { onResult?.(false); return; }
    closeCurrentAlert?.();

    const overlay = page.createElement("div");
    overlay.setAttribute("role", "alertdialog");
    Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "2147483000", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.6)" });
    const box = page.createElement("div");
    Object.assign(box.style, { width: "min(440px, 90vw)", padding: "20px", borderRadius: "12px", background: "#111214", color: "#dbdee1", border: "1px solid #2e3035", fontFamily: "var(--font-primary, inherit)", fontSize: "14px", lineHeight: "1.4", boxShadow: "0 8px 24px rgba(0,0,0,.5)" });
    const title = page.createElement("div");
    title.textContent = options.title;
    Object.assign(title.style, { fontFamily: "var(--font-display, var(--font-primary, inherit))", fontWeight: "600", fontSize: "20px", color: "#f2f3f5", marginBottom: "8px" });
    const body = page.createElement("div");
    body.textContent = typeof options.body === "string" ? options.body : "";
    Object.assign(body.style, { marginBottom: "16px" });
    const row = page.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });

    let answered = false;
    const finish = (confirmed: boolean) => {
        if (answered) return;
        answered = true;
        overlay.remove();
        page.removeEventListener("keydown", onKey, true);
        if (closeCurrentAlert === close) closeCurrentAlert = undefined;
        try {
            if (confirmed) options.onConfirm?.(); else options.onCancel?.();
        } finally {
            options.onCloseCallback?.();
            onResult?.(confirmed);
        }
    };
    const close = () => finish(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); finish(false); } };
    const button = (text: string, bg: string, confirmed: boolean) => {
        const el = page.createElement("button");
        el.type = "button";
        el.textContent = text;
        Object.assign(el.style, { padding: "8px 16px", borderRadius: "8px", border: "none", cursor: "pointer", color: "#fff", background: bg, fontFamily: "var(--font-primary, inherit)", fontWeight: "500", fontSize: "14px" });
        el.addEventListener("click", () => finish(confirmed));
        return el;
    };
    row.append(button(options.cancelText ?? "Cancel", "#2b2d31", false), button(options.confirmText ?? "Confirm", options.confirmVariant === "critical-primary" ? "#da373c" : "#5865f2", true));
    box.append(title, body, row);
    overlay.append(box);
    overlay.addEventListener("mousedown", event => { if (event.target === overlay) finish(false); });
    page.addEventListener("keydown", onKey, true);
    page.body.appendChild(overlay);
    closeCurrentAlert = close;
}

export const Alerts: AlertsType = {
    show: options => showAlert(options),
    close: () => closeCurrentAlert?.(),
    confirm: options => new Promise<boolean>(resolve => showAlert(options, resolve))
};
