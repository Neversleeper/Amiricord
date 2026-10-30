/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin TokenLoginManager (by Neversleeper, who posted it in TestCord as nnenaza) as found in TestCord.
// A list of your own accounts (a name you choose and the account's token) in the plugin's settings window, and a Login button that makes Discord start as that
// account: the token is written into Discord's page storage through a hidden frame (Discord removes its own handle to it) and Discord is reloaded.
// A token is the key to an account. Read this before you use it:
//  - the tokens are kept in the plugin's own storage in Discord's page on this computer, NOT encrypted: the engine's secret store cannot be used because the page
//    can never read a secret back, and this plugin has to hand the token to Discord (the original kept them in plain text too). Anyone who can read the page's
//    storage on this computer can read them. Delete an account here to forget its token;
//  - a token is never written in the console, a toast or a message by this plugin, and it is sent to Discord's own address only, to ask who the account is (`fetchPreview`, once when an account is added and when "Refresh pictures" is pressed), and the plugin
//    declares no network at all (the token guard would take the header off any other host);
//  - a token that does not look like one (letters, digits, `.`, `-`, `_`, 20 to 200 characters) is refused, so it can never break the text it is written into.
// Differences, NOT verified in a real Discord: the window is the plugin's settings window (the original added its own entry to Discord's settings); the Login button
// and Delete ask first (the original did not); the order of the list is the order the accounts were added.

/* eslint-disable @typescript-eslint/no-explicit-any -- the window is built with React's createElement, which has no types here (as in ProfilePresets) */

import { currentReact } from "../../api/jsxRuntime";
import { PANEL_CSS, panelKit } from "../../api/panelKit";
import type { StyleHandle } from "../../api/styles";
import { KeyIcon } from "../../plugins/Settings/icon";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { JsonValue } from "../../shared/settings";

/** What Discord says about the account of a token, kept so each account can be told apart in the list: its id, the name it shows and the hash of its picture (none: the default one). */
export interface Preview { userId: string; name: string; avatar: string | null; }
export interface Account { id: string; username: string; token: string; preview?: Preview; }

const USER_ID = /^[0-9]{15,22}$/;
const AVATAR_HASH = /^(?:a_)?[0-9a-f]{20,40}$/;

/** A saved preview as plain data, or nothing when it does not have the right shape (so it can never break the address it is put into). */
export function readPreview(value: unknown): Preview | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const { userId, name, avatar } = value as Record<string, unknown>;
    if (typeof userId !== "string" || !USER_ID.test(userId) || typeof name !== "string") return undefined;
    if (avatar !== null && (typeof avatar !== "string" || !AVATAR_HASH.test(avatar))) return undefined;
    return { userId, name: name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80), avatar };
}

/** The preview from Discord's answer to "who am I" (`/users/@me`), or nothing when the answer is not one. */
export function previewFromUser(user: unknown): Preview | undefined {
    if (typeof user !== "object" || user === null) return undefined;
    const { id, username, global_name: globalName, avatar } = user as Record<string, unknown>;
    const name = typeof globalName === "string" && globalName.trim() !== "" ? globalName : username;
    return readPreview({ userId: id, name, avatar: avatar ?? null });
}

/** The address of the picture of an account: its own on Discord's picture server, or one of the six default ones (chosen by the id, as Discord does). */
export function avatarUrl(preview: Preview): string {
    if (preview.avatar !== null) return `https://cdn.discordapp.com/avatars/${preview.userId}/${preview.avatar}.png?size=64`;
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(preview.userId) >> 22n) % 6n)}.png`;
}

const KEY = "accounts";
export const MAX_ACCOUNTS = 30;
const TOKEN_FORMAT = /^[A-Za-z0-9._-]{20,200}$/;

export const looksLikeToken = (value: string): boolean => TOKEN_FORMAT.test(value);

/** The saved list as plain accounts: anything that does not have the right shape is dropped, never trusted. */
export function readAccounts(value: unknown): Account[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const accounts: Account[] = [];
    for (const item of value) {
        if (typeof item !== "object" || item === null) continue;
        const { id, username, token } = item as Record<string, unknown>;
        if (typeof id !== "string" || id === "" || seen.has(id)) continue;
        if (typeof username !== "string" || typeof token !== "string" || !looksLikeToken(token)) continue;
        seen.add(id);
        const preview = readPreview((item as Record<string, unknown>).preview);
        accounts.push(preview ? { id, username: username.slice(0, 40), token, preview } : { id, username: username.slice(0, 40), token });
    }
    return accounts.slice(0, MAX_ACCOUNTS);
}

/** The list with one more account, or the reason it was refused. */
export function withAccount(list: readonly Account[], username: string, token: string, id: string, preview?: Preview): { ok: true; list: Account[]; } | { ok: false; error: string; } {
    const name = username.trim().slice(0, 40);
    const cleanToken = token.trim();
    if (name === "") return { ok: false, error: "Give the account a name." };
    if (!looksLikeToken(cleanToken)) return { ok: false, error: "That does not look like a token (letters, digits, . - _ and 20 to 200 characters)." };
    if (list.length >= MAX_ACCOUNTS) return { ok: false, error: `You can keep ${MAX_ACCOUNTS} accounts. Delete one first.` };
    if (list.some(account => account.token === cleanToken)) return { ok: false, error: "That token is already in the list." };
    return { ok: true, list: [...list, preview ? { id, username: name, token: cleanToken, preview } : { id, username: name, token: cleanToken }] };
}

/** The list with the preview of one account set (or replaced). */
export const withPreview = (list: readonly Account[], id: string, preview: Preview): Account[] => list.map(account => account.id === id ? { ...account, preview } : account);

export type PreviewAnswer = { ok: true; preview: Preview; } | { ok: false; invalid: boolean; error: string; };

/**
 * Asks Discord who the account of a token is, to show its picture and name in the list. The token goes to Discord's own address only (`discord.com`, the same one the page
 * uses all the time; the token guard keeps the header for Discord's hosts and takes it off for any other), once per press, and nothing from the answer is kept but the preview.
 * `invalid` is true when Discord answered that the token is not accepted.
 */
export async function fetchPreview(token: string): Promise<PreviewAnswer> {
    try {
        const answer = await fetch("https://discord.com/api/v9/users/@me", { headers: { Authorization: token } });
        if (answer.status === 401) return { ok: false, invalid: true, error: "Discord does not accept this token." };
        if (!answer.ok) return { ok: false, invalid: false, error: `Discord answered ${answer.status}.` };
        const preview = previewFromUser(await answer.json());
        return preview ? { ok: true, preview } : { ok: false, invalid: false, error: "Discord's answer was not one this plugin knows." };
    } catch {
        return { ok: false, invalid: false, error: "Could not reach Discord." };
    }
}

export const withoutAccount = (list: readonly Account[], id: string): Account[] => list.filter(account => account.id !== id);

/** Makes Discord start as the account of this token: the token goes into the storage of a hidden frame that shares Discord's storage, then Discord reloads. */
function loginWithToken(token: string): void {
    const page = globalThis as unknown as Window;
    const frame = page.document.createElement("iframe");
    frame.style.display = "none";
    page.document.body.append(frame);
    const view = frame.contentWindow;
    if (!view) { frame.remove(); throw new Error("Discord's page did not give a frame to log in with."); }
    // Discord rewrites its own saved token while it runs, so the new one is written again and again for a moment, then the page reloads.
    const timer = setInterval(() => { view.localStorage.setItem("token", JSON.stringify(token)); }, 50);
    setTimeout(() => { clearInterval(timer); page.location.reload(); }, 2500);
}

let context: EnginePluginContext | undefined;
let panelStyle: StyleHandle | undefined;

const toast = (message: string, kind: "info" | "success" | "failure" = "info") => { context?.toasts.show(message, kind); };

async function loadAccounts(): Promise<Account[]> {
    return readAccounts(await context?.storage.get(KEY));
}

async function saveAccounts(list: readonly Account[]): Promise<void> {
    await context?.storage.set(KEY, list as unknown as JsonValue);
}

function AccountsPanel() {
    const react = currentReact() as any;
    const [accounts, setAccounts] = react.useState([]) as [Account[], (v: Account[]) => void];
    const [shown, setShown] = react.useState(new Set<string>()) as [Set<string>, (v: Set<string>) => void];
    const [username, setUsername] = react.useState("") as [string, (v: string) => void];
    const [token, setToken] = react.useState("") as [string, (v: string) => void];
    const [busy, setBusy] = react.useState(false) as [boolean, (v: boolean) => void];

    const reload = react.useCallback(async () => { setAccounts(await loadAccounts()); }, []);
    react.useEffect(() => { void reload().catch(() => { toast("Could not read the saved accounts.", "failure"); }); }, []);

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try { await work(); } catch (error) { toast(error instanceof Error ? error.message : "Something went wrong.", "failure"); } finally { setBusy(false); }
    };
    const confirm = (question: string) => (globalThis as unknown as { confirm(text: string): boolean; }).confirm(question);

    const add = () => run(async () => {
        const clean = token.trim();
        // Discord is asked who the account is, to keep its picture and name; a token it does not accept is not saved, and when Discord cannot be reached the account is saved without them.
        const seen = looksLikeToken(clean) ? await fetchPreview(clean) : undefined;
        if (seen && !seen.ok && seen.invalid) { toast(seen.error, "failure"); return; }
        const preview = seen?.ok ? seen.preview : undefined;
        const result = withAccount(accounts, username.trim() === "" ? preview?.name ?? "" : username, token, crypto.randomUUID(), preview);
        if (!result.ok) { toast(result.error, "failure"); return; }
        await saveAccounts(result.list);
        setUsername("");
        setToken("");
        await reload();
        toast(seen && !seen.ok ? `Account saved without its picture: ${seen.error}` : "Account saved.", seen && !seen.ok ? "info" : "success");
    });
    const refresh = () => run(async () => {
        let list = accounts;
        let failed = 0;
        for (const account of accounts) {
            const seen = await fetchPreview(account.token);
            if (seen.ok) list = withPreview(list, account.id, seen.preview); else failed++;
        }
        await saveAccounts(list);
        await reload();
        toast(failed === 0 ? "Pictures and names updated." : `${failed} accounts could not be checked (the token may no longer work).`, failed === 0 ? "success" : "info");
    });
    const remove = (account: Account) => run(async () => {
        if (!confirm(`Delete "${account.username}" from the list? Its token is forgotten here (the account itself is not touched).`)) return;
        await saveAccounts(withoutAccount(accounts, account.id));
        await reload();
    });
    const login = (account: Account) => {
        if (!confirm(`Log in as "${account.username}"? Discord reloads: calls end and messages you have not sent are lost.`)) return;
        try { loginWithToken(account.token); toast(`Logging in as ${account.username}...`); } catch (error) { toast(error instanceof Error ? error.message : "Could not log in.", "failure"); }
    };
    const toggle = (id: string) => { const next = new Set(shown); if (next.has(id)) next.delete(id); else next.add(id); setShown(next); };

    const kit = panelKit({ react, Button: context?.components.Button.get() });
    const button = (label: string, onClick: () => void, key: string, variant: "primary" | "secondary" | "danger" = "secondary") => kit.button(label, onClick, { key, disabled: busy, variant });

    return kit.panel(
        kit.card([
            kit.title("Your accounts"),
            kit.note("Your own accounts. A token is the key to an account: here it is kept in plain text in Discord's storage on this computer. When you add one, it is sent to Discord (and only Discord) once, to get the picture and name that tell the accounts apart. Do not add a token that is not yours."),
            kit.row(
                kit.input({ value: username, placeholder: "Name (empty: the account's own)", maxLength: 40, onChange: setUsername }),
                kit.input({ value: token, type: "password", placeholder: "Token", maxLength: 200, onChange: setToken }),
                button("Add account", () => { void add(); }, "add", "primary"))
        ]),
        kit.card([
            kit.row(kit.title(`Saved accounts (${accounts.length}/${MAX_ACCOUNTS})`), accounts.length === 0 ? null : button("Refresh pictures", () => { void refresh(); }, "refresh")),
            accounts.length === 0
                ? kit.note("No accounts yet.")
                : accounts.map(account => kit.item(account.id, kit.avatar(account.preview ? avatarUrl(account.preview) : undefined), account.username, [account.preview && account.preview.name !== account.username ? account.preview.name : "", shown.has(account.id) ? account.token : "•".repeat(16)].filter(Boolean).join("  ·  "), [
                    button(shown.has(account.id) ? "Hide token" : "Show token", () => { toggle(account.id); }, "show"),
                    button("Login", () => { login(account); }, "login", "primary"),
                    button("Delete", () => { void remove(account); }, "delete", "danger")]))
        ]));
}

const Panel = () => (currentReact() as any).createElement(AccountsPanel);

const plugin: PluginCode = {
    settingsComponent: Panel as never,

    start(ctx) {
        context = ctx;
        panelStyle = ctx.addStyle(PANEL_CSS, "panel");
        // TestCord showed the Token Login Manager as a tab of its own in the settings; the panel is also behind the gear of the plugin's card.
        ctx.settingsTabs.add({ title: "Token Login Manager", panelTitle: "Token Login Manager", Component: Panel, icon: KeyIcon as () => unknown });
    },

    stop() {
        panelStyle?.remove();
        panelStyle = undefined;
        context = undefined;
    }
};

export default plugin;
