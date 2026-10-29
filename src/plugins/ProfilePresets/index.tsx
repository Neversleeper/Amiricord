/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and answers have no types */

// Profile presets (Neversleeper, 2026-10-29): save the profile you have now (picture, banner, display name, pronouns, bio, colours, custom status with its emoji, game widgets and
// server tag) under a name, and put any saved preset back later from this plugin's settings, from the window of `/profile-preset`, or with `/profile-preset name:<preset>`.
// The shapes of the requests come from ProfileCopyButton (custom status as a settings message, widgets as `PUT /users/@me/widgets`, the editor's pending fields), which read them in
// Discord's build 653945; the direct profile requests (`PATCH /users/@me` and `PATCH /users/@me/profile`) are Discord's public ones and were NOT tried against this build.
// Where things are kept: presets live in this plugin's storage (IndexedDB inside this Discord, per Discord, 1 MB per value), the pictures as data addresses in values of their own.
// Nothing leaves the machine except the requests to Discord itself. Applying a preset changes the real profile, so before it does, the profile you have is saved as a preset called
// "Backup before the last change" (a setting, on by default). The Amiricord badge mark in the pronouns is never saved into a preset and is kept on the account when the pronouns change.
// Not verified in a real Discord at the time of writing. Not covered: profile effects and name styles (as in ProfileCopyButton), clearing a banner or the game widgets when the preset
// has none (a preset without them leaves yours as they are), and a server tag in the direct mode (the tag only goes through the profile editor).

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { hasMarker, withMarker, withoutMarker } from "../../shared/badgeList";
import type { JsonValue } from "../../shared/settings";

const CDN = "https://cdn.discordapp.com";
/** Stay under the storage limit (1 MB of text per value) with room for the JSON quotes. */
const CHUNK_CHARS = 900_000;
/** A picture may span several storage values (a moving banner is often over 1 MB). */
const MAX_CHUNKS = 5;
const MAX_IMAGE_CHARS = CHUNK_CHARS * MAX_CHUNKS;
const MAX_PRESETS = 20;
const BACKUP_NAME = "Backup before the last change";
const INDEX_KEY = "index";

const settings = definePluginSettings({
    applyStraightAway: { type: "boolean", default: true, description: "Send the profile changes to Discord at once when you apply a preset. When off, they only fill your profile editor and wait for your Save (the status and games are always sent at once)." },
    backupBeforeApply: { type: "boolean", default: true, description: "Before applying a preset, save the profile you have now as the preset \"Backup before the last change\"." }
});

interface Entry { id: string; name: string; savedAt: number; }

interface Status { text: string; emojiId: string; emojiName: string; }

interface Preset {
    id: string;
    name: string;
    savedAt: number;
    globalName: string | null;
    pronouns: string | null;
    bio: string | null;
    themeColors: number[] | null;
    accentColor: number | null;
    /** `null` when the account had no custom status, so applying the preset clears it. */
    status: Status | null;
    /** `false` when the status could not be read, so applying the preset leaves the status alone. */
    statusKnown: boolean;
    widgets: JsonValue[];
    primaryGuildId: string | null;
    hasAvatar: boolean;
    avatarAnimated: boolean;
    hasBanner: boolean;
    /** The display name style (font, effect, colours). Missing in a preset saved before this existed; `null` when the account had none (applying then leaves the style alone). */
    nameStyle?: NameStyle | null;
    /** The profile effect and the nameplate, by the id of the item (`sku_id`). Missing in a preset saved before; `null` when the account had none. */
    effectSkuId?: string | null;
    nameplateSkuId?: string | null;
    /** The avatar decoration and the profile frame, by `sku_id` (the frame is the profile's collectible of type 3, the effect is type 1). */
    decorationSkuId?: string | null;
    frameSkuId?: string | null;
}

interface NameStyle {
    fontId: number;
    effectId: number;
    colors: number[];
}

/** `display_name_styles` as the profile answer holds it (`{font_id, effect_id, colors}`), or null when there is none or it is not in that shape. */
function readNameStyle(value: unknown): NameStyle | null {
    if (!isRecord(value)) return null;
    const { font_id: fontId, effect_id: effectId, colors } = value;
    if (typeof fontId !== "number" || typeof effectId !== "number" || !Array.isArray(colors) || !colors.every(c => typeof c === "number")) return null;
    return { fontId, effectId, colors: colors as number[] };
}

/** The fields Discord's own save sends for the style in `PATCH /users/@me`. */
const nameStyleBody = (style: NameStyle) => ({ display_name_font_id: style.fontId, display_name_effect_id: style.effectId, display_name_colors: style.colors });

const PARTS = [
    ["avatar", "Picture"], ["banner", "Banner"], ["name", "Display name"], ["nameStyle", "Name style"], ["nameplate", "Nameplate"], ["effect", "Profile effect"], ["decoration", "Avatar decoration"], ["frame", "Profile frame"], ["pronouns", "Pronouns"], ["bio", "Bio"],
    ["colours", "Colours"], ["tag", "Server tag"], ["status", "Status"], ["games", "Games"]
] as const;
type PartId = typeof PARTS[number][0];

let context: EnginePluginContext | undefined;
let rest: any;
let dispatcher: any;
let users: any;
let guilds: any;

const toast = (message: string, kind: "info" | "success" | "failure" = "info") => { context?.toasts.show(message, kind); };

const isRecord = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
const asText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function describe(error: unknown): string {
    const e = error as { status?: number; body?: { message?: string; }; message?: string; } | undefined;
    if (e?.status) return `error ${e.status}${e.body?.message ? `: ${e.body.message}` : ""}`;
    return String(e?.message ?? error).slice(0, 140);
}

function bodyOf(answer: any): any {
    if (isRecord(answer?.body)) return answer.body;
    if (typeof answer?.text === "string") {
        try { return JSON.parse(answer.text); } catch { return undefined; }
    }
    return undefined;
}

function setPending(changes: Record<string, unknown>) {
    dispatcher?.dispatch({ type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES", ...changes });
}

// ---- reading the profile ------------------------------------------------------------------------------------------------------------------------------------------------

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

/** The biggest copy of the picture that fits in one storage value, or `null` when none does. */
async function fitImage(kind: "avatars" | "banners", id: string, hash: string, sizes: number[]): Promise<string | null> {
    // A still picture is tried as PNG and then as WebP (much smaller for a photo); a moving one only as GIF.
    const formats = hash.startsWith("a_") ? ["gif"] : ["png", "webp"];
    for (const ext of formats) {
        for (const size of sizes) {
            const uri = await toDataUri(`${CDN}/${kind}/${id}/${hash}.${ext}?size=${size}`);
            if (uri && uri.length <= MAX_IMAGE_CHARS) return uri;
        }
    }
    return null;
}

/** The custom status as Discord's settings hold it, or `undefined` when no store could be read. */
async function readStatus(me: string): Promise<Status | null | undefined> {
    try {
        const proto: any = await context?.finders.byStore("UserSettingsProtoStore").ready();
        const custom = proto?.settings?.status?.customStatus;
        if (proto?.settings?.status) {
            const expires = Number(custom?.expiresAtMs ?? 0);
            if (!custom || (!custom.text && (!custom.emojiId || custom.emojiId === "0")) || (expires > 0 && expires < Date.now())) return null;
            return { text: String(custom.text ?? ""), emojiId: String(custom.emojiId ?? "0"), emojiName: String(custom.emojiName ?? "") };
        }
    } catch { /* fall through to the presence */ }
    try {
        const presences: any = await context?.finders.byStore("PresenceStore").ready();
        const activities = presences?.getActivities?.(me);
        if (!Array.isArray(activities)) return undefined;
        const found = activities.find((a: any) => a.type === 4);
        if (!found || (!found.state && !found.emoji)) return null;
        return { text: String(found.state ?? ""), emojiId: found.emoji?.id ? String(found.emoji.id) : "0", emojiName: String(found.emoji?.name ?? "") };
    } catch {
        return undefined;
    }
}

/** The widgets in the shape Discord's own save sends (same reading as ProfileCopyButton's). */
function sanitizeWidgets(widgets: any[]): JsonValue[] {
    const out: JsonValue[] = [];
    for (const w of widgets) {
        const data = w?.data ?? w;
        const type = data?.type ?? w?.type;
        if (typeof type !== "number" && typeof type !== "string") continue;
        if (Array.isArray(data?.games)) {
            const games = data.games
                .map((g: any) => ({ game_id: g.game_id ?? g.application_id ?? g.applicationId ?? g.gameId, comment: g.comment ?? null, tags: g.tags ?? [] }))
                .filter((g: any) => g.game_id !== undefined && g.game_id !== null);
            if (games.length > 0) out.push({ id: w.id ?? null, data: { type, games } });
        } else if (data?.application_id ?? data?.applicationId) {
            out.push({ id: w.id ?? null, data: { type, application_id: data.application_id ?? data.applicationId } });
        }
    }
    return out;
}

async function loadOwnProfile(me: string): Promise<{ user: any; profile: any; widgets: any[]; }> {
    const answer = await rest.get({ url: `/users/${me}/profile`, query: { type: "popout", with_mutual_guilds: false, with_mutual_friends: false }, rejectWithError: true });
    const body = bodyOf(answer);
    if (!body?.user) throw new Error("Discord did not send your profile");
    return { user: body.user, profile: body.user_profile ?? {}, widgets: Array.isArray(body.widgets) ? body.widgets : [] };
}

// ---- storage ----------------------------------------------------------------------------------------------------------------------------------------------------------

async function readIndex(): Promise<Entry[]> {
    const value = await context?.storage.get(INDEX_KEY);
    if (!Array.isArray(value)) return [];
    const entries: Entry[] = [];
    for (const item of value as unknown[]) {
        if (isRecord(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.savedAt === "number") entries.push({ id: item.id, name: item.name, savedAt: item.savedAt });
    }
    return entries;
}

const writeIndex = async (entries: Entry[]) => { await context?.storage.set(INDEX_KEY, entries as unknown as JsonValue); };

async function readPreset(id: string): Promise<Preset | undefined> {
    const value = await context?.storage.get(`p-${id}`);
    const record: unknown = value;
    if (!isRecord(record) || typeof record.name !== "string") return undefined;
    return { ...record, widgets: unpackWidgets(record.widgets) } as unknown as Preset;
}

/**
 * Game widgets nest deeper (preset, widgets, widget, data, games, game, tags) than a storage value may (6 levels), so they are kept as one text and read back here.
 * A list is accepted too, for a preset saved before this.
 */
function packWidgets(widgets: JsonValue[]): string {
    return JSON.stringify(widgets);
}

function unpackWidgets(stored: unknown): JsonValue[] {
    if (Array.isArray(stored)) return stored as JsonValue[];
    if (typeof stored !== "string") return [];
    try {
        const parsed: unknown = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed as JsonValue[] : [];
    } catch {
        return [];
    }
}

/** The picture is the value `<kind>-<id>`, followed by `<kind>-<id>.1`, `.2`... when it was too long for one value. */
async function readImage(kind: "a" | "b", id: string): Promise<string | undefined> {
    const first = await context?.storage.get(`${kind}-${id}`);
    if (typeof first !== "string") return undefined;
    let text = first;
    for (let i = 1; i < MAX_CHUNKS; i++) {
        const more = await context?.storage.get(`${kind}-${id}.${i}`);
        if (typeof more !== "string") break;
        text += more;
    }
    return text;
}

async function writeImage(kind: "a" | "b", id: string, uri: string): Promise<void> {
    const storage = context?.storage;
    if (!storage) return;
    for (let i = 0; i < MAX_CHUNKS; i++) {
        const key = i === 0 ? `${kind}-${id}` : `${kind}-${id}.${i}`;
        const part = uri.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
        if (part) await storage.set(key, part); else await storage.delete(key);
    }
}

async function clearImage(kind: "a" | "b", id: string): Promise<void> {
    const storage = context?.storage;
    if (!storage) return;
    for (let i = 0; i < MAX_CHUNKS; i++) await storage.delete(i === 0 ? `${kind}-${id}` : `${kind}-${id}.${i}`);
}

/** Reads the profile the account has now and keeps it as a preset (new, or `id` replaced). Resolves to a sentence for the person. */
async function saveCurrent(name: string, id?: string): Promise<string> {
    if (!context || !rest) throw new Error("Discord's functions for this were not found");
    const me = users?.getCurrentUser?.();
    if (!me) throw new Error("your account is not loaded yet");
    const { user, profile, widgets } = await loadOwnProfile(me.id);
    const status = await readStatus(me.id);
    const notes: string[] = [];

    const avatarUri = user.avatar ? await fitImage("avatars", me.id, user.avatar, [512, 256, 128]) : null;
    if (user.avatar && !avatarUri) notes.push("your picture was too big to keep");
    const bannerHash = profile.banner ?? user.banner;
    const bannerUri = bannerHash ? await fitImage("banners", me.id, bannerHash, [1024, 600, 480, 320, 240]) : null;
    if (bannerHash && !bannerUri) notes.push("your banner was too big to keep");
    if (status === undefined) notes.push("your custom status could not be read");

    const presetId = id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const preset: Preset = {
        id: presetId,
        name,
        savedAt: Date.now(),
        globalName: asText(user.global_name),
        nameStyle: readNameStyle(user.display_name_styles),
        effectSkuId: asText(profile.profile_effect?.sku_id),
        nameplateSkuId: asText(user.collectibles?.nameplate?.sku_id),
        decorationSkuId: asText(user.avatar_decoration_data?.sku_id),
        frameSkuId: asText((Array.isArray(profile.collectibles) ? profile.collectibles : []).find((c: any) => c?.type === 3)?.sku_id),
        pronouns: asText(withoutMarker(String(profile.pronouns ?? ""))),
        bio: asText(profile.bio),
        themeColors: Array.isArray(profile.theme_colors) ? profile.theme_colors.filter((c: unknown) => typeof c === "number") : null,
        accentColor: typeof profile.accent_color === "number" ? profile.accent_color : null,
        status: status ?? null,
        statusKnown: status !== undefined,
        widgets: sanitizeWidgets(widgets),
        primaryGuildId: asText(user.primary_guild?.identity_guild_id ?? user.clan?.identity_guild_id),
        hasAvatar: Boolean(avatarUri),
        avatarAnimated: Boolean(user.avatar?.startsWith("a_")),
        hasBanner: Boolean(bannerUri)
    };
    const storage = context.storage;
    await storage.set(`p-${presetId}`, JSON.parse(JSON.stringify({ ...preset, widgets: packWidgets(preset.widgets) })) as JsonValue);
    if (avatarUri) await writeImage("a", presetId, avatarUri); else await clearImage("a", presetId);
    if (bannerUri) await writeImage("b", presetId, bannerUri); else await clearImage("b", presetId);
    const entries = (await readIndex()).filter(entry => entry.id !== presetId);
    entries.push({ id: presetId, name, savedAt: preset.savedAt });
    await writeIndex(entries);
    return notes.length > 0 ? `Saved "${name}", but ${notes.join(" and ")}.` : `Saved "${name}".`;
}

async function removePreset(id: string): Promise<void> {
    const storage = context?.storage;
    if (!storage) return;
    await storage.delete(`p-${id}`);
    await clearImage("a", id);
    await clearImage("b", id);
    await writeIndex((await readIndex()).filter(entry => entry.id !== id));
}

// ---- applying a preset --------------------------------------------------------------------------------------------------------------------------------------------

const utf8 = (text: string) => new TextEncoder().encode(text);

function varint(value: number): number[] {
    const out: number[] = [];
    let left = value;
    while (left >= 0x80) { out.push((left & 0x7f) | 0x80); left = Math.floor(left / 128); }
    out.push(left);
    return out;
}

const field = (number: number, bytes: ArrayLike<number>) => [(number << 3) | 2, ...varint(bytes.length), ...Array.from(bytes)];

function fixed64(number: number, value: bigint): number[] {
    const out = [(number << 3) | 1];
    for (let i = 0n; i < 8n; i++) out.push(Number((value >> (8n * i)) & 0xffn));
    return out;
}

/** The settings message Discord saves a custom status with, as base64 (same as ProfileCopyButton's, read in build 653945). Every field is written so an old value is replaced. */
function customStatusSettings(text: string, emojiId: string, emojiName: string, createdAtMs: number): string {
    const custom = [...field(1, utf8(text)), ...fixed64(2, BigInt(emojiId)), ...field(3, utf8(emojiName)), ...fixed64(4, 0n), ...fixed64(5, BigInt(createdAtMs))];
    return btoa(String.fromCharCode(...field(11, field(2, custom))));
}

async function applyStatus(status: Status | null): Promise<string | null> {
    const now = Date.now();
    const text = status?.text ?? "";
    let emojiId = status?.emojiId && /^\d+$/.test(status.emojiId) ? status.emojiId : "0";
    let emojiName = status?.emojiName ?? "";
    let note = "";
    if (emojiId !== "0") {
        const owned = Object.values(guilds?.getGuilds?.() ?? {}).some((guild: any) => (guild.emojis ?? []).some((e: any) => e.id === emojiId));
        if (!owned) { emojiId = "0"; emojiName = ""; note = " (its emoji is from a server you are not in any more, so it was left out)"; }
    }
    try {
        dispatcher?.dispatch({ type: "USER_SETTINGS_PROTO_UPDATE", settings: { type: 1, proto: { status: { customStatus: { text, emojiId, emojiName, expiresAtMs: "0", createdAtMs: `${now}` } } } }, partial: true, local: true });
        await rest.patch({ url: "/users/@me/settings-proto/1", body: { settings: customStatusSettings(text, emojiId, emojiName, now) }, rejectWithError: true });
        return status ? `status set${note}` : "status cleared";
    } catch (error) {
        return `status failed (${describe(error)})`;
    }
}

/** Applies the chosen parts of a preset. Resolves to the sentences to tell the person, one per part. */
async function applyPreset(id: string, parts: ReadonlySet<PartId>): Promise<string[]> {
    if (!context || !rest || !dispatcher) return ["Discord's functions for this were not found."];
    const preset = await readPreset(id);
    if (!preset) return ["That preset could not be read."];
    const me = users?.getCurrentUser?.();
    if (!me) return ["Your account is not loaded yet."];
    const nitro = (me.premiumType ?? 0) >= 1;
    const direct = settings.store.applyStraightAway;
    const done: string[] = [];

    if (settings.store.backupBeforeApply && preset.name !== BACKUP_NAME) {
        try {
            const entries = await readIndex();
            const old = entries.find(entry => entry.name === BACKUP_NAME);
            await saveCurrent(BACKUP_NAME, old?.id);
            done.push("backup saved");
        } catch (error) {
            return [`Nothing was changed: the backup of your current profile failed (${describe(error)}). Turn off "backup before apply" to go on without it.`];
        }
    }

    // What the account carries now, only for the pronouns: the Amiricord mark stays on the account.
    let pronouns = preset.pronouns;
    if (parts.has("pronouns") && pronouns !== null) {
        try {
            const current = await loadOwnProfile(me.id);
            if (hasMarker(String(current.profile.pronouns ?? ""))) pronouns = withMarker(pronouns) ?? pronouns;
        } catch { /* the pronouns go without the mark; the Badges plugin puts it back at the next start */ }
    }

    const avatar = parts.has("avatar") && preset.hasAvatar ? await readImage("a", id) : undefined;
    const banner = parts.has("banner") && preset.hasBanner ? await readImage("b", id) : undefined;
    if (avatar && preset.avatarAnimated && !nitro) done.push("picture skipped (it is animated and needs Nitro)");
    const useAvatar = avatar && !(preset.avatarAnimated && !nitro) ? avatar : undefined;
    if (banner && !nitro) done.push("banner skipped (needs Nitro)");
    const useBanner = banner && nitro ? banner : undefined;
    const useColours = parts.has("colours") && nitro && (preset.themeColors || preset.accentColor !== null);
    if (parts.has("colours") && !nitro && (preset.themeColors || preset.accentColor !== null)) done.push("colours skipped (need Nitro)");

    if (direct) {
        const userBody: Record<string, unknown> = {};
        if (useAvatar) userBody.avatar = useAvatar;
        if (parts.has("name") && preset.globalName) userBody.global_name = preset.globalName;
        if (parts.has("nameStyle") && preset.nameStyle) Object.assign(userBody, nameStyleBody(preset.nameStyle));
        if (parts.has("nameplate") && preset.nameplateSkuId) userBody.nameplate_sku_id = preset.nameplateSkuId;
        if (parts.has("decoration") && preset.decorationSkuId) userBody.avatar_decoration_sku_id = preset.decorationSkuId;
        const profileBody: Record<string, unknown> = {};
        if (parts.has("pronouns") && pronouns !== null) profileBody.pronouns = pronouns;
        if (parts.has("bio") && preset.bio !== null) profileBody.bio = nitro ? preset.bio : preset.bio.replace(/<a?:[A-Za-z0-9_~]+:\d+>/g, "").trim();
        if (useBanner) profileBody.banner = useBanner;
        if (useColours) {
            if (preset.themeColors) profileBody.theme_colors = preset.themeColors;
            if (preset.accentColor !== null) profileBody.accent_color = preset.accentColor;
        }
        if (Object.keys(userBody).length > 0) {
            try { await rest.patch({ url: "/users/@me", body: userBody, rejectWithError: true }); done.push(`account updated (${Object.keys(userBody).join(", ")})`); } catch (error) { done.push(`account update failed (${describe(error)})`); }
        }
        if (Object.keys(profileBody).length > 0) {
            try { await rest.patch({ url: "/users/@me/profile", body: profileBody, rejectWithError: true }); done.push(`profile updated (${Object.keys(profileBody).join(", ")})`); } catch (error) { done.push(`profile update failed (${describe(error)})`); }
        }
    } else {
        // The editor has no pending field for the name style, so (like the status and the games) it is sent at once.
        const own: Record<string, unknown> = {};
        if (parts.has("nameStyle") && preset.nameStyle) Object.assign(own, nameStyleBody(preset.nameStyle));
        if (parts.has("nameplate") && preset.nameplateSkuId) own.nameplate_sku_id = preset.nameplateSkuId;
        if (parts.has("decoration") && preset.decorationSkuId) own.avatar_decoration_sku_id = preset.decorationSkuId;
        if (Object.keys(own).length > 0) {
            try { await rest.patch({ url: "/users/@me", body: own, rejectWithError: true }); done.push(`account updated (${Object.keys(own).join(", ")})`); } catch (error) { done.push(`account update failed (${describe(error)})`); }
        }
        if (useAvatar) setPending({ pendingAvatar: { assetOrigin: "NEW_ASSET", imageUri: useAvatar, description: `profile-preset-${id}` } });
        if (useBanner) setPending({ pendingBanner: useBanner });
        if (parts.has("name") && preset.globalName) setPending({ pendingGlobalName: preset.globalName });
        if (parts.has("pronouns") && pronouns !== null) setPending({ pendingPronouns: pronouns });
        if (parts.has("bio") && preset.bio !== null) setPending({ pendingBio: nitro ? preset.bio : preset.bio.replace(/<a?:[A-Za-z0-9_~]+:\d+>/g, "").trim() });
        if (useColours) {
            if (preset.themeColors) setPending({ pendingThemeColors: [...preset.themeColors] });
            if (preset.accentColor !== null) setPending({ pendingAccentColor: preset.accentColor });
        }
        done.push("profile editor filled (open it and press Save)");
    }

    // The profile effect goes through the editor's pending field (Discord saves it together with the other collectibles, and sending it alone could drop one the account has).
    if (parts.has("effect") && preset.effectSkuId) {
        if (nitro) { setPending({ pendingProfileEffect: { skuId: preset.effectSkuId } }); done.push("profile effect put in the profile editor (press Save there)"); } else done.push("profile effect skipped (needs Nitro)");
    }
    if (parts.has("frame") && preset.frameSkuId) {
        if (nitro) { setPending({ pendingProfileFrame: { skuId: preset.frameSkuId } }); done.push("profile frame put in the profile editor (press Save there)"); } else done.push("profile frame skipped (needs Nitro)");
    }
    if (parts.has("tag") && preset.primaryGuildId) {
        if (guilds?.getGuild?.(preset.primaryGuildId)) { setPending({ pendingPrimaryGuildId: preset.primaryGuildId }); done.push("server tag put in the profile editor (press Save there)"); } else done.push("server tag skipped (you are not in that server)");
    }
    if (parts.has("status") && preset.statusKnown) {
        const result = await applyStatus(preset.status);
        if (result) done.push(result);
    }
    if (parts.has("games") && preset.widgets.length > 0) {
        try {
            await rest.put({ url: "/users/@me/widgets", body: { widgets: preset.widgets }, oldFormErrors: true, rejectWithError: true });
            done.push("games applied");
        } catch (error) {
            done.push(`games failed (${describe(error)})`);
        }
    }
    return done;
}

// ---- the window ---------------------------------------------------------------------------------------------------------------------------------------------------------

const ALL_PARTS = new Set<PartId>(PARTS.map(part => part[0]));

function summary(preset: Preset | undefined): string {
    if (!preset) return "";
    const bits: string[] = [];
    if (preset.hasAvatar) bits.push("picture");
    if (preset.hasBanner) bits.push("banner");
    if (preset.globalName) bits.push("name");
    if (preset.nameStyle) bits.push("name style");
    if (preset.nameplateSkuId) bits.push("nameplate");
    if (preset.effectSkuId) bits.push("effect");
    if (preset.decorationSkuId) bits.push("decoration");
    if (preset.frameSkuId) bits.push("frame");
    if (preset.pronouns) bits.push("pronouns");
    if (preset.bio) bits.push("bio");
    if (preset.themeColors || preset.accentColor !== null) bits.push("colours");
    if (preset.primaryGuildId) bits.push("tag");
    if (preset.statusKnown) bits.push(preset.status ? "status" : "no status");
    if (preset.widgets.length > 0) bits.push("games");
    return bits.join(", ");
}

function Thumb({ id, version }: { id: string; version: number; }) {
    const react = currentReact() as any;
    const [src, setSrc] = react.useState(undefined) as [string | undefined, (v: string | undefined) => void];
    react.useEffect(() => {
        let alive = true;
        void readImage("a", id).then(uri => { if (alive) setSrc(uri); }, () => { /* no picture shown */ });
        return () => { alive = false; };
    }, [id, version]);
    return react.createElement("div", { style: { width: "40px", height: "40px", borderRadius: "50%", background: "var(--background-modifier-accent, #4e5058)", overflow: "hidden", flex: "none" } },
        src ? react.createElement("img", { src, width: 40, height: 40, style: { objectFit: "cover", display: "block" }, alt: "" }) : null);
}

function PresetsPanel() {
    const react = currentReact() as any;
    const h = react.createElement;
    const [entries, setEntries] = react.useState([]) as [Entry[], (v: Entry[]) => void];
    const [details, setDetails] = react.useState({}) as [Record<string, Preset | undefined>, (v: Record<string, Preset | undefined>) => void];
    const [name, setName] = react.useState("") as [string, (v: string) => void];
    const [busy, setBusy] = react.useState(false) as [boolean, (v: boolean) => void];
    const [parts, setParts] = react.useState(ALL_PARTS) as [Set<PartId>, (v: Set<PartId>) => void];
    const [sure, setSure] = react.useState(null) as [string | null, (v: string | null) => void];
    const [version, setVersion] = react.useState(0) as [number, (v: number) => void];

    const reload = react.useCallback(async () => {
        const list = (await readIndex()).sort((a, b) => b.savedAt - a.savedAt);
        const loaded: Record<string, Preset | undefined> = {};
        for (const entry of list) loaded[entry.id] = await readPreset(entry.id);
        setEntries(list);
        setDetails(loaded);
        setVersion(Date.now());
    }, []);
    react.useEffect(() => { void reload().catch((error: unknown) => { toast(`Could not read your presets (${describe(error)}).`, "failure"); }); }, []);

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try { await work(); } catch (error) { toast(describe(error), "failure"); } finally { setBusy(false); }
    };

    const save = () => run(async () => {
        const wanted = name.trim().slice(0, 40);
        if (!wanted) { toast("Give the preset a name.", "failure"); return; }
        if (entries.some(entry => entry.name.toLowerCase() === wanted.toLowerCase())) { toast("A preset with that name exists. Press Update on it to replace it.", "failure"); return; }
        if (entries.length >= MAX_PRESETS) { toast(`You can keep ${MAX_PRESETS} presets. Delete one first.`, "failure"); return; }
        toast(await saveCurrent(wanted), "success");
        setName("");
        await reload();
    });

    const apply = (entry: Entry) => run(async () => {
        if (parts.size === 0) { toast("Tick at least one thing to apply.", "failure"); return; }
        toast(`Applying "${entry.name}"...`);
        const result = await applyPreset(entry.id, parts);
        toast(`${entry.name}: ${result.join("; ")}.`, result.some(line => line.includes("failed") || line.startsWith("Nothing")) ? "failure" : "success");
        await reload();
    });

    const style = { display: "flex", flexDirection: "column", gap: "10px", color: "var(--text-default, var(--text-normal, #dbdee1))" } as const;
    const button = (label: string, onClick: () => void, extra?: Record<string, unknown>) => h("button", { type: "button", disabled: busy, onClick, style: { cursor: busy ? "default" : "pointer", padding: "4px 10px" }, ...extra }, label);

    return h("div", { style },
        h("span", { style: { fontSize: "13px", opacity: 0.85 } }, "A preset keeps the profile you have right now. Applying one changes your real profile (a backup is saved first unless you turned that off in the settings)."),
        h("div", { style: { display: "flex", gap: "8px" } },
            h("input", { value: name, placeholder: "Name of the new preset", maxLength: 40, onChange: (e: any) => setName(e.target.value), style: { flex: 1, padding: "4px 8px" } }),
            button(busy ? "Working..." : "Save current profile", () => { void save(); })),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "13px" } },
            h("span", { style: { opacity: 0.7 } }, "Apply:"),
            ...PARTS.map(([partId, label]) => h("label", { key: partId, style: { display: "flex", gap: "4px", alignItems: "center", cursor: "pointer" } },
                h("input", { type: "checkbox", checked: parts.has(partId), onChange: (e: any) => { const next = new Set(parts); if (e.target.checked) next.add(partId); else next.delete(partId); setParts(next); } }), label))),
        entries.length === 0
            ? h("span", { style: { opacity: 0.7 } }, "No presets yet.")
            : entries.map(entry => h("div", { key: entry.id, style: { display: "flex", gap: "10px", alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--background-modifier-accent, #4e5058)" } },
                h(Thumb, { id: entry.id, version }),
                h("div", { style: { flex: 1, minWidth: 0 } },
                    h("div", { style: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, entry.name),
                    h("div", { style: { fontSize: "12px", opacity: 0.7 } }, `${new Date(entry.savedAt).toLocaleString()} - ${summary(details[entry.id]) || "empty"}`)),
                button("Apply", () => { void apply(entry); }),
                button("Update", () => { void run(async () => { toast(await saveCurrent(entry.name, entry.id), "success"); await reload(); }); }),
                sure === entry.id
                    ? button("Sure?", () => { setSure(null); void run(async () => { await removePreset(entry.id); await reload(); }); })
                    : button("Delete", () => { setSure(entry.id); }))));
}

function openWindow(ctx: EnginePluginContext): void {
    const react = currentReact() as any;
    const h = react.createElement;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) { toast("The window could not be opened.", "failure"); return; }
    ctx.modals.open(props => h(Root, { size: "medium", onClose: props.onClose, label: "Profile presets" }, h(Content, null,
        h("div", { style: { padding: "16px" } }, h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: "0 0 8px" } }, "Profile presets"), h(PresetsPanel))),
    Close ? h(Close, { onClick: props.onClose }) : null));
}

const plugin: PluginCode = {
    settings,
    settingsComponent: (() => (currentReact() as any).createElement("div", { style: { marginTop: "12px" } }, (currentReact() as any).createElement(PresetsPanel))) as never,

    start(ctx) {
        context = ctx;
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR").get();
        dispatcher = ctx.common.FluxDispatcher.get();
        users = ctx.common.UserStore.get();
        guilds = ctx.common.GuildStore.get();
        const added = ctx.commands.add({
            name: "profile-preset",
            description: "Open your profile presets, or apply one by name.",
            options: [{ name: "name", description: "The preset to apply (leave empty to open the window)", type: "string", required: false }],
            execute: args => {
                const wanted = String(args.find(arg => arg.name === "name")?.value ?? "").trim().toLowerCase();
                if (!wanted) { openWindow(ctx); return; }
                void (async () => {
                    const entry = (await readIndex()).find(item => item.name.toLowerCase() === wanted);
                    if (!entry) { toast(`There is no preset called "${wanted}".`, "failure"); return; }
                    const result = await applyPreset(entry.id, ALL_PARTS);
                    toast(`${entry.name}: ${result.join("; ")}.`, result.some(line => line.includes("failed") || line.startsWith("Nothing")) ? "failure" : "success");
                })().catch(error => { toast(describe(error), "failure"); });
            }
        });
        if (!added) throw new Error("the command /profile-preset could not be added (the name is taken or the commands API refused it)");
    },

    stop() {
        context = rest = dispatcher = users = guilds = undefined;
    }
};

export default plugin;
