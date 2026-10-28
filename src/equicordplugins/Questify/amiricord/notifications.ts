/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getContext, hasContext, reportProblem } from "./context";

export interface NotificationData {
    title: string;
    body: string;
    icon?: string;
    onClick?(): void;
    dismissOnClick?: boolean;
    [key: string]: unknown;
}

function showInAppNotification(data: NotificationData): void {
    const page = (globalThis as { document?: Document; }).document;
    if (!page?.body) return;
    let stack = page.getElementById("questify-notification-stack");
    if (!stack) {
        stack = page.createElement("div");
        stack.id = "questify-notification-stack";
        Object.assign(stack.style, { position: "fixed", top: "16px", right: "16px", zIndex: "2147482000", display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none" });
        page.body.appendChild(stack);
    }
    const card = page.createElement("div");
    card.setAttribute("role", "status");
    Object.assign(card.style, {
        pointerEvents: "auto", cursor: data.onClick ? "pointer" : "default", width: "320px", padding: "12px 14px", borderRadius: "8px",
        background: "var(--background-base-lowest, #111214)", border: "1px solid var(--border-subtle, rgba(255,255,255,.1))",
        boxShadow: "0 8px 16px rgba(0,0,0,.4)", fontFamily: "var(--font-primary, sans-serif)", color: "var(--text-default, #dbdee1)"
    });
    const title = page.createElement("div");
    title.textContent = data.title;
    Object.assign(title.style, { fontWeight: "600", fontSize: "14px", marginBottom: "4px", color: "var(--text-strong, #fff)" });
    const body = page.createElement("div");
    body.textContent = data.body;
    Object.assign(body.style, { fontSize: "13px", lineHeight: "18px", whiteSpace: "pre-wrap" });
    card.appendChild(title);
    card.appendChild(body);
    const remove = () => { card.remove(); };
    card.addEventListener("click", () => {
        try {
            data.onClick?.();
        } finally {
            if (data.dismissOnClick !== false) remove();
        }
    });
    stack.appendChild(card);
    setTimeout(remove, 8000);
}

export function showNotification(data: NotificationData): void {
    try {
        const engineCards = hasContext() ? getContext().notifications : undefined;
        if (engineCards && typeof engineCards.show === "function") {
            engineCards.show({ title: data.title, body: data.body, icon: data.icon, onClick: data.onClick, dismissOnClick: data.dismissOnClick });
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the browser Notification global is read without its types
        const Notification = (globalThis as { Notification?: any; }).Notification;
        if (!Notification || Notification.permission === "denied") {
            showInAppNotification(data);
            return;
        }
        const show = () => {
            try {
                const notification = new Notification(data.title, { body: data.body, icon: data.icon, silent: true });
                notification.onclick = () => {
                    try {
                        data.onClick?.();
                    } finally {
                        if (data.dismissOnClick !== false) notification.close();
                    }
                };
            } catch {
                showInAppNotification(data);
            }
        };
        if (Notification.permission === "granted") show();
        else Notification.requestPermission().then((answer: string) => { if (answer === "granted") show(); else showInAppNotification(data); }, () => showInAppNotification(data));
    } catch (error) {
        reportProblem("notification", error);
    }
}
