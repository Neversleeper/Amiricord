/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the window is built with React's createElement, which has no types here (as in ProfilePresets) */

// Adapted for Amiricord (2026) from the plugin getMyToken (author Sami) as found in TestCord. `/gettoken` shows the token of the account you are using, so you can
// keep it (for example in the Token Login plugin). A token is the key to your account: anyone who has it can act as you.
// Differences, NOT verified in a real Discord:
//  - the original answered with a message that only you could see; the engine has no such messages, and sending the token to the chat would publish it, so it is
//    shown in a window on your screen instead: hidden behind dots until you press Show, with a Copy button (which is why the manifest asks for the clipboard);
//  - the token is read from Discord's own token store (found by the name of its method) at the moment you press Show or Copy, kept in the page's memory only while
//    the window is open, and never written in the console, a toast, a message or the plugin's storage;
//  - the manifest declares `permissions.token`, so the plugin is marked high risk and the engine's token guard treats it as one that uses the token.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface TokenStore { getToken?(): string | null | undefined; }

/** The text a window shows for a token: dots of the same length while it is hidden, the token itself once shown, a plain sentence when there is none. */
export function tokenText(token: string | null, shown: boolean): string {
    if (!token) return "Your token could not be found.";
    return shown ? token : "•".repeat(Math.min(token.length, 40));
}

let context: EnginePluginContext | undefined;
let store: { get(): TokenStore | undefined; } | undefined;

/** Discord's token, or null when it cannot be read. Never throws. */
function currentToken(): string | null {
    try {
        const token = store?.get()?.getToken?.();
        return typeof token === "string" && token !== "" ? token : null;
    } catch {
        return null;
    }
}

function TokenWindow() {
    const react = currentReact() as any;
    const h = react.createElement;
    const [shown, setShown] = react.useState(false) as [boolean, (v: boolean) => void];
    const [token, setToken] = react.useState(null) as [string | null, (v: string | null) => void];
    // The token is read when it is first needed and forgotten when the window closes (the component goes away with it).
    const reveal = () => { setToken(currentToken()); setShown(true); };
    const copy = () => {
        const value = currentToken();
        if (!value) { context?.toasts.show("Your token could not be found.", "failure"); return; }
        navigator.clipboard.writeText(value).then(
            () => { context?.toasts.show("Token copied. Keep it to yourself.", "success"); },
            () => { context?.toasts.show("Could not copy the token.", "failure"); }
        );
    };
    const button = (label: string, onClick: () => void) => h("button", { type: "button", onClick, style: { cursor: "pointer", padding: "4px 10px" } }, label);
    return h("div", { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px", color: "var(--text-default, var(--text-normal, #dbdee1))" } },
        h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: 0 } }, "Your token"),
        h("span", { style: { fontSize: "13px", opacity: 0.85 } }, "Anyone who has this can act as you. Never send it to anybody, and do not show it on a stream or a call."),
        h("code", { style: { display: "block", padding: "8px", wordBreak: "break-all", userSelect: shown ? "text" : "none", background: "var(--background-secondary, #2b2d31)", borderRadius: "4px" } }, tokenText(shown ? token : "x".repeat(40), shown)),
        h("div", { style: { display: "flex", gap: "8px" } }, shown ? button("Hide", () => { setShown(false); setToken(null); }) : button("Show", reveal), button("Copy", copy)));
}

function openWindow(ctx: EnginePluginContext): void {
    const react = currentReact() as any;
    const h = react.createElement;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) { ctx.toasts.show("The window could not be opened.", "failure"); return; }
    ctx.modals.open(props => h(Root, { size: "small", onClose: props.onClose, label: "Your token" }, h(Content, null, h(TokenWindow)), Close ? h(Close, { onClick: props.onClose }) : null));
}

const plugin: PluginCode = {
    start(ctx) {
        context = ctx;
        store = ctx.finders.byProps<TokenStore>("getToken");
        ctx.commands.add({
            name: "gettoken",
            description: "Show your Discord token in a window only you can see",
            execute() { openWindow(ctx); }
        });
    },

    stop() {
        context = undefined;
        store = undefined;
    }
};

export default plugin;
