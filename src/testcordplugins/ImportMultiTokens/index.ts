/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ImportMultiTokens (author x2b) as found in TestCord. The original saved the parsed tokens straight into Token Login Manager's list; the engine keeps each plugin's saved data apart, so this version does not save them (nothing is written to disk): it only parses what you paste and lets you log in with one, right there. If you want a token kept for later, add it in the engine's own TokenLogin settings instead. Nothing here is sent anywhere but to Discord itself, when you press Login.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface ParsedToken { userId: string; token: string; }

/** The tokens found in a pasted block: a three-line layout (id, blank, token), comma-separated, or one per line — whichever the text matches first. Repeated tokens are dropped. */
export function parseTokens(input: string): ParsedToken[] {
    const cleaned = input.trim();
    if (!cleaned) return [];
    const lines = cleaned.split("\n");
    const quoted = (value: string) => value.trim().replace(/^["']|["']$/g, "");
    if (lines.length >= 3) {
        const found: ParsedToken[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < lines.length; i += 3) {
            const userId = lines[i]?.trim();
            const token = quoted(lines[i + 2] ?? "");
            if (userId && token && !seen.has(token)) { seen.add(token); found.push({ userId, token }); }
        }
        if (found.length > 0) return found;
    }
    const seen = new Set<string>();
    const add = (raw: string, out: ParsedToken[]) => {
        const token = quoted(raw);
        if (token && !seen.has(token)) { seen.add(token); out.push({ userId: token.split(".")[0] || "?", token }); }
    };
    if (cleaned.includes(",")) {
        const found: ParsedToken[] = [];
        for (const part of cleaned.split(",")) add(part, found);
        if (found.length > 0) return found;
    }
    const found: ParsedToken[] = [];
    for (const line of lines) if (line.trim()) add(line, found);
    return found;
}

/** The token shown masked, keeping only its last 4 characters. */
export function maskToken(token: string): string {
    return token.length <= 4 ? "*".repeat(token.length) : `${"*".repeat(token.length - 4)}${token.slice(-4)}`;
}

function loginWithToken(page: Window, token: string): void {
    const frame = page.document.createElement("iframe");
    frame.style.display = "none";
    page.document.body.append(frame);
    const view = frame.contentWindow;
    if (!view) { frame.remove(); throw new Error("Discord's page did not give a frame to log in with."); }
    const timer = setInterval(() => { view.localStorage.setItem("token", JSON.stringify(token)); }, 50);
    setTimeout(() => { clearInterval(timer); page.location.reload(); }, 2500);
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.commands.add({
            name: "importtokens",
            description: "Paste several of your own tokens and choose one to log in with",
            execute() {
                openPanelWindow(ctx, "Import tokens", (kit, react) => {
                    const [text, setText] = react.useState("") as [string, (value: string) => void];
                    const [parsed, setParsed] = react.useState([]) as [ParsedToken[], (value: ParsedToken[]) => void];
                    return kit.panel(
                        kit.card([
                            kit.note("Paste your own tokens below (one per line, comma-separated, or an id/blank/token layout). Nothing is saved; this only reads what you paste, once."),
                            kit.area({ value: text, onChange: setText, placeholder: "token1\ntoken2\n...", rows: 8 }),
                            kit.row(kit.button("Parse", () => { setParsed(parseTokens(text)); }))
                        ]),
                        kit.card(parsed.length === 0
                            ? [kit.note("Nothing parsed yet.")]
                            : parsed.map((entry, index) => kit.item(String(index), null, entry.userId, maskToken(entry.token), [
                                kit.button("Login", () => {
                                    try { loginWithToken(globalThis as unknown as Window, entry.token); ctx.toasts.show("Logging in...", "success"); } catch (error) { ctx.reportError("ImportMultiTokens", error); ctx.toasts.show("Could not log in.", "failure"); }
                                })
                            ])))
                    );
                });
            }
        });
    }
};

export default plugin;
