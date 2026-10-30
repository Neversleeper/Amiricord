/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin LoginWithToken (author thororen) as found in Equicord's copy of Vencord's plugins. The original types the token into the page's storage through a hidden frame (the same trick the engine's own TokenLogin plugin uses) and reloads Discord. Only a token you paste yourself, by hand, into the box is used; nothing is read, scanned or guessed from other accounts or other installs. Not tried in a real Discord.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

const TOKEN_FORMAT = /^[A-Za-z0-9._-]{20,200}$/;

export const looksLikeToken = (value: string): boolean => TOKEN_FORMAT.test(value.trim());

/** Writes the token into the page's storage through a hidden frame and reloads, the same way as the engine's own TokenLogin. */
function loginWithToken(page: Window, token: string): void {
    const frame = page.document.createElement("iframe");
    frame.style.display = "none";
    page.document.body.append(frame);
    const view = frame.contentWindow;
    if (!view) { frame.remove(); throw new Error("Discord's page did not give a frame to log in with."); }
    const timer = setInterval(() => { view.localStorage.setItem("token", JSON.stringify(token)); }, 50);
    setTimeout(() => { clearInterval(timer); page.location.reload(); }, 2500);
}

const LOGIN_PATHS = /^\/(login|register)/;
const MOUNT_ATTRIBUTE = "data-amiricord-loginwithtoken";

function isOnLoginPage(page: Window): boolean {
    return LOGIN_PATHS.test(page.location.pathname);
}

function mount(doc: Document, open: () => void): void {
    if (doc.querySelector(`[${MOUNT_ATTRIBUTE}]`)) return;
    const emailField = doc.querySelector("input[name=\"email\"], input[type=\"email\"], input[autocomplete=\"username\"]");
    const form = emailField?.closest("form");
    if (!form) return;
    const link = doc.createElement("button");
    link.setAttribute(MOUNT_ATTRIBUTE, "1");
    link.type = "button";
    link.textContent = "Login with token";
    link.style.cssText = "display:block;margin-top:8px;background:none;border:none;color:var(--text-link,#00b0f4);cursor:pointer;font-size:14px;text-decoration:underline;padding:0;";
    link.addEventListener("click", open);
    form.append(link);
}

const plugin: PluginCode = {
    start(ctx) {
        const page = globalThis as unknown as Window;
        const openWindow = () => {
            openPanelWindow(ctx, "Login with token", (kit, react) => {
                const [token, setToken] = react.useState("") as [string, (value: string) => void];
                const [error, setError] = react.useState("") as [string, (value: string) => void];
                return kit.panel(kit.card([
                    kit.note("Paste one of your own account tokens. Never share this with anyone else; it gives full access to the account."),
                    kit.input({ value: token, onChange: setToken, placeholder: "Paste your token here", type: "password" }),
                    error ? kit.note(error) : null,
                    kit.row(kit.button("Login", () => {
                        const clean = token.trim();
                        if (!looksLikeToken(clean)) { setError("That does not look like a token."); return; }
                        try { loginWithToken(page, clean); ctx.toasts.show("Logging in...", "success"); } catch (err) { ctx.reportError("LoginWithToken", err); setError("Could not log in."); }
                    }, { variant: "primary" }))
                ]));
            });
        };
        if (!isOnLoginPage(page)) return;
        mount(page.document, openWindow);
        const observer = new MutationObserver(() => { if (isOnLoginPage(page)) mount(page.document, openWindow); });
        observer.observe(page.document.body, { childList: true, subtree: true });
        ctx.onDispose(() => { observer.disconnect(); page.document.querySelector(`[${MOUNT_ATTRIBUTE}]`)?.remove(); });
    }
};

export default plugin;
