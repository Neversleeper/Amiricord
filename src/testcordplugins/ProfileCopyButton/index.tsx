/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and answers have no types */

// Adapted for Amiricord (2026) from the plugin ProfileCopyButton (authors x2b and nnenaza) as found in TestCord. Differences from the original:
//  - the editor fields (picture, banner, name, pronouns, bio, colours) are only FILLED in Discord's profile editor, as in the original: nothing is saved until the person presses Save.
//    The other things the original did are kept because they are the point of the plugin, and each one is announced on screen: the custom status (with its emoji) is set at once,
//    the public server behind the profile's server tag is joined (through its vanity link, only when it has one) and set as your tag, and the custom emojis of the bio that you do
//    not have are uploaded to a server YOU pick in a window (or removed from the bio if you skip). The game widgets are copied too (a setting, on by default);
//  - no button in the editor (its anchor no longer exists in Discord's web build 653945). The entries are the right-click menu of a user (`user-context`, a name that could not
//    be checked in the readable part of the build) and a box in this plugin's own settings window, which does not depend on any patch;
//  - profile effect and name styles are not copied (the editor's format for them was not checked).
// The editor fields and the shape of the avatar change were read in that build (`USER_PROFILE_SETTINGS_SET_PENDING_CHANGES`, `pendingAvatar` with `assetOrigin`/`imageUri`).
// Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const ID = /^\d{17,20}$/;
const CUSTOM_EMOJI = /<(a?):([A-Za-z0-9_~]+):(\d+)>/g;
const CDN = "https://cdn.discordapp.com";
/** Discord's MANAGE_GUILD_EXPRESSIONS permission (1 << 30). */
const MANAGE_EXPRESSIONS = 1n << 30n;

const settings = definePluginSettings({
    copyGameWidgets: { type: "boolean", default: true, description: "Also copy their game widgets (favourite game, currently playing, want to play...). Applied at once, not through Save." }
});

let context: EnginePluginContext | undefined;
let rest: any;
let dispatcher: any;
let users: any;
let guilds: any;
let presences: any;
let presenceFinder: { ready(): Promise<any>; } | undefined;
let permissions: any;

const toast = (message: string, kind: "success" | "error" | "info" = "info") => { context?.toasts.show(message, kind as never); };

function setPending(changes: Record<string, unknown>) {
    dispatcher?.dispatch({ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", ...changes });
}

export function imageUrl(kind: "avatars" | "banners", id: string, hash: string, size: number): string {
    return `${CDN}/${kind}/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=${size}`;
}

export function cleanBio(bio: string, hasNitro: boolean): string {
    return hasNitro ? bio : bio.replace(CUSTOM_EMOJI, "").replace(/[ \t]+\n/g, "\n").trim();
}

async function toDataUri(url: string): Promise<string | null> {
    try {
        const answer = await fetch(url);
        if (!answer.ok) return null;
        const blob = await answer.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

function resolveTarget(input: string): string | null {
    const text = input.trim().replace(/^@/, "");
    if (!text) return null;
    if (ID.test(text)) return text;
    const lower = text.toLowerCase();
    let found: string | null = null;
    users?.forEach?.((user: any) => {
        if (user.username?.toLowerCase() === lower || user.globalName?.toLowerCase() === lower) { found = user.id; return false; }
        return undefined;
    });
    return found;
}

function ownedEmojiIds(): Set<string> {
    const ids = new Set<string>();
    for (const guild of Object.values(guilds?.getGuilds?.() ?? {}) as any[]) for (const emoji of guild.emojis ?? []) ids.add(emoji.id);
    return ids;
}

function manageableGuilds(): Array<{ id: string; name: string; }> {
    return (Object.values(guilds?.getGuilds?.() ?? {}) as any[])
        .filter(guild => permissions?.can?.(MANAGE_EXPRESSIONS, guild))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Asks which server should receive the missing emojis. Resolves to its id, or null to skip them. */
function pickGuild(count: number, what: string): Promise<string | null> {
    return new Promise(resolve => {
        const ctx = context;
        const list = manageableGuilds();
        const Root = ctx?.components.ModalRoot.get() as any;
        const Content = ctx?.components.ModalContent.get() as any;
        if (!ctx || !Root || !Content || list.length === 0) { resolve(null); return; }
        const react = currentReact() as any;
        const h = react.createElement;
        let answered = false;
        const answer = (value: string | null, close: () => void) => {
            if (answered) return;
            answered = true;
            close();
            resolve(value);
        };
        ctx.modals.open(props => {
            const Picker = () => {
                const [chosen, setChosen] = react.useState(list[0].id) as [string, (v: string) => void];
                return h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px" } },
                    h("strong", null, `${what} uses ${count} custom emoji(s) you do not have`),
                    h("span", null, "Pick a server to upload them to, or skip to leave them out."),
                    h("select", { value: chosen, onChange: (e: any) => setChosen(e.target.value) }, ...list.map(g => h("option", { key: g.id, value: g.id }, g.name))),
                    h("div", { style: { display: "flex", gap: "8px" } },
                        h("button", { type: "button", onClick: () => answer(chosen, props.onClose) }, "Upload and continue"),
                        h("button", { type: "button", onClick: () => answer(null, props.onClose) }, "Skip (remove them)")));
            };
            return h(Root, { size: "small", onClose: () => answer(null, props.onClose), label: "Upload emojis" }, h(Content, null, h(Picker)));
        }, { onCloseCallback: () => { if (!answered) { answered = true; resolve(null); } } });
    });
}

/** The server picked for the emojis during the copy in progress; `undefined` until the person has been asked, `null` when they skipped. */
let emojiGuild: string | null | undefined;

/** Uploads somebody else's custom emoji to one of the person's servers and gives the id of the copy, or `null` when it could not be done. */
async function uploadEmoji(guildId: string, name: string, id: string, animated: boolean): Promise<string | null> {
    const existing = ((guilds?.getGuild?.(guildId)?.emojis ?? []) as any[]).find(e => e.name === name && Boolean(e.animated) === animated);
    if (existing) return existing.id;
    const uri = await toDataUri(`${CDN}/emojis/${id}.${animated ? "gif" : "png"}`);
    if (!uri) return null;
    try {
        return (await rest.post({ url: `/guilds/${guildId}/emojis`, body: { name, image: uri, roles: [] } }))?.body?.id ?? null;
    } catch {
        return null;
    }
}

async function emojiTarget(count: number, what: string): Promise<string | null> {
    if (emojiGuild === undefined) emojiGuild = await pickGuild(count, what);
    return emojiGuild;
}

async function resolveBioEmojis(bio: string): Promise<string> {
    const owned = ownedEmojiIds();
    const found = [...bio.matchAll(CUSTOM_EMOJI)];
    const missing = found.filter((m, i) => !owned.has(m[3]) && found.findIndex(o => o[3] === m[3]) === i);
    if (missing.length === 0) return bio;
    const guildId = await emojiTarget(missing.length, "The bio");
    let result = bio;
    for (const [full, animated, name, id] of missing) {
        const newId = guildId ? await uploadEmoji(guildId, name, id, Boolean(animated)) : null;
        result = result.split(full).join(newId ? `<${animated}:${name}:${newId}>` : "");
    }
    return result.replace(/[ \t]+\n/g, "\n").trim();
}

/** Waits until Discord has the server (it joins after the person solves the captcha Discord shows, which retries the request by itself). */
async function waitForGuild(guildId: string, seconds: number): Promise<boolean> {
    for (let i = 0; i < seconds; i++) {
        if (guilds?.getGuild?.(guildId)) return true;
        await new Promise(resolve => { setTimeout(resolve, 1000); });
    }
    return Boolean(guilds?.getGuild?.(guildId));
}

/** Whether the person is in the server but has not accepted its rules yet (member screening). */
function isPendingMember(guildId: string): boolean {
    const me = users?.getCurrentUser?.()?.id;
    const member = (context?.common.GuildMemberStore.get() as any)?.getMember?.(guildId, me);
    return member?.isPending === true;
}

/** Sets the tag when the person accepts the rules of the server (looks for up to ten minutes). */
async function waitForAcceptance(guildId: string): Promise<void> {
    for (let i = 0; i < 600; i++) {
        await new Promise(resolve => { setTimeout(resolve, 1000); });
        if (!context) return;
        if (!isPendingMember(guildId)) {
            setPending({ pendingPrimaryGuildId: guildId });
            toast("The server tag is in your profile editor now. Open it and press Save.", "success");
            return;
        }
    }
}

/**
 * Joins the server behind a server tag the way the "Join" button of the tag's card does (`PUT /guilds/{id}/members/@me`, read in build 653945), which needs no invitation when the
 * server is open to join. If that is refused, the vanity link is tried. Then the server is set as the person's tag.
 */
async function joinTagServer(guildId: string): Promise<void> {
    try {
        if (!guilds?.getGuild?.(guildId)) {
            let joined = false;
            try {
                await rest.put({ url: `/guilds/${guildId}/members/@me`, query: { lurker: false }, body: {}, oldFormErrors: true, rejectWithError: true });
                joined = true;
            } catch {
                // Discord shows a captcha for this request and retries it by itself once it is solved; this call has already failed, so wait for the server to appear.
                toast("If Discord shows a captcha, solve it: the server of the tag is joined after that.", "info");
                joined = await waitForGuild(guildId, 120);
            }
            if (!joined) {
                let code: string | null = null;
                try { code = (await rest.get({ url: `/guilds/${guildId}/preview`, rejectWithError: true }))?.body?.vanity_url_code ?? null; } catch { code = null; }
                if (!code) {
                    toast("The server of that tag cannot be joined without an invitation, so it was not joined.", "info");
                    return;
                }
                await rest.post({ url: `/invites/${code}`, body: {}, rejectWithError: true });
            }
            toast("Joined the server of that tag.", "success");
        }
        // Discord saves the tag as `primary_guild_id` together with the rest of the profile, so it goes into the editor like the other fields and waits for Save.
        if (!guilds?.getGuild?.(guildId)) { toast("You are not in the server of that tag, so it was not set as your tag.", "info"); return; }
        if (isPendingMember(guildId)) {
            // Seen in build 653945: a server that asks new members to accept its rules (member screening) leaves the person "pending", and Discord does not offer that server's tag
            // in the editor until they accept. That is their choice to make, so the plugin takes them to the server and waits.
            toast("You joined the server of that tag, but it asks you to accept its rules first. Accept them and the tag is set by itself.", "info");
            // Discord's own navigation function, found by its log text: its module has no readable property names in this build.
            (context?.finders.byCode("transitionTo - Transitioning to").get() as ((path: string) => void) | undefined)?.(`/channels/${guildId}`);
            void waitForAcceptance(guildId);
            return;
        }
        setPending({ pendingPrimaryGuildId: guildId });
    } catch (error) {
        const e = error as { status?: number; body?: { message?: string; }; } | undefined;
        toast(`Could not join the server of that tag (error ${e?.status ?? "?"}${e?.body?.message ? `: ${e.body.message}` : ""}).`, "info");
    }
}

const utf8 = (text: string) => new TextEncoder().encode(text);

function varint(value: number): number[] {
    const out: number[] = [];
    let rest = value;
    while (rest >= 0x80) { out.push((rest & 0x7f) | 0x80); rest = Math.floor(rest / 128); }
    out.push(rest);
    return out;
}

const field = (number: number, bytes: ArrayLike<number>) => [(number << 3) | 2, ...varint(bytes.length), ...Array.from(bytes)];

function fixed64(number: number, value: bigint): number[] {
    const out = [(number << 3) | 1];
    for (let i = 0n; i < 8n; i++) out.push(Number((value >> (8n * i)) & 0xffn));
    return out;
}

/**
 * The settings message Discord saves a custom status with (`PreloadedUserSettings.status.customStatus`, field numbers read in build 653945), as base64. Every field is written, also
 * the empty ones, because the server merges the message into the stored settings and an omitted field would keep its old value (an old emoji, an old expiry).
 */
export function customStatusSettings(text: string, emojiId: string, emojiName: string, createdAtMs: number): string {
    const custom = [...field(1, utf8(text)), ...fixed64(2, BigInt(emojiId)), ...field(3, utf8(emojiName)), ...fixed64(4, 0n), ...fixed64(5, BigInt(createdAtMs))];
    const bytes = field(11, field(2, custom));
    return btoa(String.fromCharCode(...bytes));
}

/** Says what happened, in words for the person, or `null` when there was nothing to copy. */
async function copyStatus(targetId: string): Promise<string | null> {
    // The store is looked for now and not at start: it is not in Discord's modules yet when the plugin starts.
    try { presences = await presenceFinder?.ready(); } catch { presences = undefined; }
    const status = ((presences?.getActivities?.(targetId) ?? []) as any[]).find(a => a.type === 4);
    if (!status || (!status.state && !status.emoji)) return null;
    const emoji = status.emoji;
    let emojiCopy: string | null = emoji?.id && ownedEmojiIds().has(emoji.id) ? emoji.id : null;
    if (emoji?.id && !emojiCopy) {
        // Discord shows a custom status emoji only if the person can use it where they are, so it is uploaded to one of their servers like the bio's ones.
        const guildId = await emojiTarget(1, "Their status");
        if (guildId) emojiCopy = await uploadEmoji(guildId, emoji.name ?? "status", emoji.id, Boolean(emoji.animated));
    }
    const usable = emojiCopy;
    try {
        // Discord keeps the custom status in its settings protobuf; the old `PATCH /users/@me/settings` answers OK and changes nothing. This is the request its own save sends.
        const emojiId = usable ? String(usable) : "0";
        const emojiName = emoji?.id && !usable ? "" : emoji?.name ?? "";
        const createdAtMs = Date.now();
        // The client has to be told as well: its own save dispatches this, and its panel and presence follow the settings it holds, not what the server stored.
        dispatcher.dispatch({ type: "USER_SETTINGS_PROTO_UPDATE", settings: { type: 1, proto: { status: { customStatus: { text: status.state ?? "", emojiId, emojiName, expiresAtMs: "0", createdAtMs: `${createdAtMs}` } } } }, partial: true, local: true });
        await rest.patch({ url: "/users/@me/settings-proto/1", body: { settings: customStatusSettings(status.state ?? "", emojiId, emojiName, createdAtMs) }, rejectWithError: true });
        return emoji?.id && !usable ? "Their custom status was copied, without its emoji (it could not be uploaded to one of your servers)." : "Their custom status was copied.";
    } catch (error) {
        const e = error as { status?: number; body?: unknown; } | undefined;
        return `Could not copy their custom status (error ${e?.status ?? "?"} ${JSON.stringify(e?.body ?? "").slice(0, 120)}).`;
    }
}

/**
 * The game widgets in the shape Discord's own save sends (`toSubmission` of its widget classes, read in build 653945): `{ id, data: { type, games: [{ game_id, comment, tags }] } }`,
 * or `{ id, data: { type, application_id } }` for a single-application widget. The widgets of a profile answer may carry the games either under `data` or at the top.
 * Widgets of other kinds (clips, personal) are not copied.
 */
export function sanitizeWidgets(widgets: any[]): any[] {
    const out: any[] = [];
    for (const w of widgets) {
        const data = w?.data ?? w;
        const type = data?.type ?? w?.type;
        if (typeof type !== "number" && typeof type !== "string") continue;
        if (Array.isArray(data?.games)) {
            const games = data.games
                .map((g: any) => ({ game_id: g.game_id ?? g.application_id ?? g.applicationId ?? g.gameId, comment: g.comment ?? null, tags: g.tags ?? [] }))
                .filter((g: any) => g.game_id !== undefined && g.game_id !== null);
            if (games.length > 0) out.push({ id: w.id, data: { type, games } });
        } else if (data?.application_id ?? data?.applicationId) {
            out.push({ id: w.id, data: { type, application_id: data.application_id ?? data.applicationId } });
        }
    }
    return out;
}

async function copyWidgets(widgets: unknown): Promise<string | null> {
    if (!Array.isArray(widgets) || widgets.length === 0) return null;
    const body = sanitizeWidgets(widgets);
    if (body.length === 0) return null;
    try {
        await rest.put({ url: "/users/@me/widgets", body: { widgets: body }, oldFormErrors: true, rejectWithError: true });
        return "";
    } catch (error) {
        const e = error as { status?: number; body?: unknown; } | undefined;
        return `error ${e?.status ?? "?"} ${JSON.stringify(e?.body ?? "").slice(0, 160)}`;
    }
}

export async function copyProfile(targetId: string): Promise<void> {
    if (!rest || !dispatcher) { toast("Discord's functions for this were not found.", "error"); return; }
    const me = users?.getCurrentUser?.();
    if (!me || targetId === me.id) { toast("Pick somebody else.", "error"); return; }
    let body: any;
    try {
        body = await rest.get({ url: `/users/${targetId}/profile`, query: { type: "popout", with_mutual_guilds: false, with_mutual_friends: false }, rejectWithError: true });
        const answer = body;
        body = answer?.body;
        if (!body && typeof answer?.text === "string") {
            try { body = JSON.parse(answer.text); } catch { body = undefined; }
        }
        if (!body?.user) {
            toast(`Could not load that profile (Discord said ${answer?.status ?? "?"} ${String(answer?.statusText ?? "")}: ${String(answer?.text ?? "").slice(0, 120)}).`, "error");
            return;
        }
    } catch (error) {
        const status = (error as { status?: number; message?: string; body?: { message?: string; }; } | undefined);
        const detail = status?.status ? `error ${status.status}${status.body?.message ? `: ${status.body.message}` : ""}` : String(status?.message ?? error);
        toast(`Could not load that profile (${detail}).`, "error");
        context?.reportError("ProfileCopyButton", error);
        return;
    }
    const user = body?.user;
    const profile = body?.user_profile;
    if (!user) { toast(`Could not load that profile (Discord answered with: ${body && typeof body === "object" ? Object.keys(body).slice(0, 6).join(", ") || "nothing" : String(body)}).`, "error"); return; }
    const nitro = (me.premiumType ?? 0) >= 1;
    emojiGuild = undefined;
    let copied = 0;

    if (user.global_name) { setPending({ pendingGlobalName: user.global_name }); copied++; }
    if (profile?.pronouns) { setPending({ pendingPronouns: profile.pronouns }); copied++; }
    if (profile?.bio) { setPending({ pendingBio: nitro ? await resolveBioEmojis(profile.bio) : cleanBio(profile.bio, false) }); copied++; }
    if (nitro && Array.isArray(profile?.theme_colors)) { setPending({ pendingThemeColors: [...profile.theme_colors] }); copied++; }
    if (nitro && typeof profile?.accent_color === "number") { setPending({ pendingAccentColor: profile.accent_color }); copied++; }

    if (user.avatar) {
        const uri = await toDataUri(imageUrl("avatars", targetId, user.avatar, 512));
        if (uri) { setPending({ pendingAvatar: { assetOrigin: "NEW_ASSET", imageUri: uri, description: `profile-copy-${targetId}` } }); copied++; }
    }
    const banner = profile?.banner ?? user.banner;
    if (nitro && banner) {
        const uri = await toDataUri(imageUrl("banners", targetId, banner, 1024));
        if (uri) { setPending({ pendingBanner: uri }); copied++; }
    }

    const statusResult = await copyStatus(targetId);
    if (statusResult) { toast(statusResult, statusResult.startsWith("Could not") ? "error" : "info"); copied++; } else toast("No custom status to copy: Discord shows none for that person (they may be offline or share no server with you).", "info");
    if (settings.store.copyGameWidgets) {
        const failed = await copyWidgets(body?.widgets);
        if (failed === "") { toast("Their game widgets were applied to your profile.", "info"); copied++; } else if (failed) toast(`Could not copy the game widgets (${failed}).`, "error");
    }
    const tagGuild = user.primary_guild?.identity_guild_id ?? user.clan?.identity_guild_id;
    if (tagGuild) { await joinTagServer(tagGuild); copied++; } else toast(`Their profile has no server tag to copy (Discord sent: ${JSON.stringify(user.primary_guild ?? user.clan ?? null).slice(0, 140)}).`, "info");

    if (copied === 0) toast("Nothing to copy from that profile.", "info");
    else toast("Copied. Open your profile editor and press Save to apply the picture, banner, name, bio, colours and server tag.", "success");
}

function SettingsPart() {
    const react = currentReact() as any;
    const h = react.createElement;
    const Input = context?.components.TextInput.get() as any;
    const Button = context?.components.Button.get() as any;
    const Text = context?.components.Text.get() as any;
    const [value, setValue] = react.useState("") as [string, (v: string) => void];
    const [busy, setBusy] = react.useState(false) as [boolean, (v: boolean) => void];
    const submit = async () => {
        const id = resolveTarget(value);
        if (!id) { toast("Type a user ID, or the name of someone Discord already has in memory.", "error"); return; }
        setBusy(true);
        try { await copyProfile(id); } finally { setBusy(false); }
    };
    if (!Input || !Button) return null;
    return h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } },
        Text ? h(Text, { variant: "text-sm/normal" }, "Fills your profile editor with another person's picture, banner, name, pronouns, bio and colours (you still press Save there), and also copies their custom status and game widgets and joins the public server of their server tag.") : null,
        h(Input, { value, onChange: setValue, placeholder: "User ID or name" }),
        h(Button, { variant: "primary", disabled: busy || !value.trim(), onClick: () => { void submit(); } }, busy ? "Copying..." : "Copy profile")) as never;
}

const plugin: PluginCode = {
    settings,
    settingsComponent: SettingsPart as never,

    start(ctx) {
        context = ctx;
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR").get();
        dispatcher = ctx.common.FluxDispatcher.get();
        users = ctx.common.UserStore.get();
        guilds = ctx.common.GuildStore.get();
        presenceFinder = ctx.finders.byStore("PresenceStore");
        permissions = ctx.common.PermissionStore.get();
        ctx.contextMenu.addNative("user-context", (children, props) => {
            const user = (props as { user?: any; } | undefined)?.user;
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!user || !parts || !react || user.id === users?.getCurrentUser?.()?.id) return;
            children.splice(-1, 0, react.createElement(parts.MenuItem as any, {
                id: "amiricord-copy-profile", key: "amiricord-copy-profile", label: "Copy Profile",
                action: () => { toast(`Copying the profile of ${user.username}...`); void copyProfile(user.id); }
            }));
        });
    },

    stop() {
        context = rest = dispatcher = users = guilds = presences = presenceFinder = permissions = undefined;
    }
};

export default plugin;
