/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the window is built with React's createElement, which has no types here (as in ProfilePresets) */

// Adapted for Amiricord (2026) from the plugin GuildCopier (by Neversleeper, who posted it in TestCord as nnenaza; it is also in her own repository Mixi-Plugins)
// as found in TestCord. "Copy Guild" makes a NEW server with the roles, channels, categories, permissions, emojis and stickers of one you are in, and "Transfer To"
// puts them into a server you already have by FIRST DELETING every role and channel of that one. It is for copying a server that is yours.
// Differences, NOT verified in a real Discord:
//  - both ask first: the copy says what it will create, the transfer says which server will lose its roles and channels (the original did not ask);
//  - roles and channel overrides are sent with their permission numbers written as text (Discord's store keeps them as huge numbers that cannot be sent as they are);
//  - an emoji is uploaded with Discord's own request for it (`POST /guilds/<id>/emojis`) instead of finding Discord's upload function by its code;
//  - the server is found from what was right-clicked (the `data-list-item-id="guildsnav___<id>"` of its icon, seen in the code of build 653945), or with
//    `/guild-copy` and `/guild-transfer` for the server you are in; `/guild-copy-stop` stops a run that is going on (the original had no way to stop);
//  - the console is not filled with a line for every step; what happens shows in small notices.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

export const PERMISSIONS = {
    ADMINISTRATOR: 1n << 3n,
    MANAGE_CHANNELS: 1n << 4n,
    MANAGE_ROLES: 1n << 28n,
    MANAGE_GUILD_EXPRESSIONS: 1n << 30n
} as const;

export interface CopyOptions { copyRoles: boolean; copyChannels: boolean; copyEmojis: boolean; copyStickers: boolean; copyBots: boolean; }

/** What you need to be allowed to do in the server you copy into, given what you asked to copy. */
export function requiredPermissions(options: CopyOptions): bigint {
    let required = 0n;
    if (options.copyRoles) required |= PERMISSIONS.MANAGE_ROLES;
    if (options.copyChannels || options.copyBots) required |= PERMISSIONS.MANAGE_CHANNELS;
    if (options.copyEmojis || options.copyStickers) required |= PERMISSIONS.MANAGE_GUILD_EXPRESSIONS;
    return required;
}

/** Whether a server can receive a transfer: you own it, you are an administrator, or you hold every permission the copy needs. */
export function canWriteTo(permissions: bigint, owner: boolean, required: bigint): boolean {
    if (owner) return true;
    if ((permissions & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR) return true;
    return (permissions & required) === required;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? value as Record<string, unknown> : {});
const SNOWFLAKE = /^\d{15,25}$/;

/** The permission overrides of a channel as Discord wants them: the role ids changed to the roles of the new server, the numbers written as text. */
export function mapOverwrites(list: unknown, roleMapping: Readonly<Record<string, string>>): Array<{ id: string; type: number; allow: string; deny: string; }> {
    const out: Array<{ id: string; type: number; allow: string; deny: string; }> = [];
    for (const item of Array.isArray(list) ? list : []) {
        const overwrite = record(item);
        const id = typeof overwrite.id === "string" ? overwrite.id : "";
        if (id === "") continue;
        out.push({ id: roleMapping[id] ?? id, type: Number(overwrite.type) || 0, allow: String(overwrite.allow ?? "0"), deny: String(overwrite.deny ?? "0") });
    }
    return out;
}

export interface BackupChannel {
    id: string; name: string; type: number; position: number; nsfw?: boolean; topic?: string | null; parent_id?: string | null; permission_overwrites: unknown;
    rate_limit_per_user?: number; bitrate?: number; user_limit?: number; default_auto_archive_duration?: number; rtc_region?: string | null; video_quality_mode?: number; default_thread_rate_limit_per_user?: number;
}

/** What to send to create a copy of this channel in the new server: only the fields that have a value, with the defaults the original used for voice and announcement channels. */
export function channelBody(channel: BackupChannel, roleMapping: Readonly<Record<string, string>>, channelMapping: Readonly<Record<string, string>>): Record<string, unknown> {
    const body: Record<string, unknown> = { name: channel.name, type: channel.type, permission_overwrites: mapOverwrites(channel.permission_overwrites, roleMapping) };
    if (channel.type === 4) return body;
    body.parent_id = (channel.parent_id ? channelMapping[channel.parent_id] : undefined) ?? null;
    if (channel.topic) body.topic = channel.topic;
    if (channel.nsfw !== undefined) body.nsfw = channel.nsfw;
    if (channel.rate_limit_per_user) body.rate_limit_per_user = channel.rate_limit_per_user;
    if (channel.bitrate) body.bitrate = channel.bitrate; else if (channel.type === 2) body.bitrate = 96000;
    if (channel.user_limit) body.user_limit = channel.user_limit;
    if (channel.default_auto_archive_duration) body.default_auto_archive_duration = channel.default_auto_archive_duration; else if (channel.type === 5) body.default_auto_archive_duration = 1440;
    if (channel.rtc_region) body.rtc_region = channel.rtc_region;
    if (channel.video_quality_mode) body.video_quality_mode = channel.video_quality_mode;
    if (channel.default_thread_rate_limit_per_user) body.default_thread_rate_limit_per_user = channel.default_thread_rate_limit_per_user;
    return body;
}

/** The order the channels are created in: the categories first (so the others can say which one they are in), then the others by position, forums last. */
export function creationOrder(channels: readonly BackupChannel[]): BackupChannel[] {
    const byPosition = (a: BackupChannel, b: BackupChannel) => a.position - b.position;
    const categories = channels.filter(channel => channel.type === 4).sort(byPosition);
    const others = channels.filter(channel => channel.type !== 4);
    const groups = new Map<string, BackupChannel[]>();
    for (const channel of others) {
        const key = channel.parent_id ?? "none";
        groups.set(key, [...(groups.get(key) ?? []), channel]);
    }
    const ordered: BackupChannel[] = [];
    for (const group of groups.values()) {
        ordered.push(...group.filter(channel => channel.type !== 15).sort(byPosition), ...group.filter(channel => channel.type === 15).sort(byPosition));
    }
    return [...categories, ...ordered];
}

/** How long to wait before trying again after Discord said "too many requests": what Discord asked for (at most 15 seconds), or 10 seconds when it did not say. */
export function retryAfterMs(error: unknown): number {
    const failure = record(error);
    const asked = Number(record(failure.body).retry_after ?? (typeof failure.text === "string" ? /"retry_after":\s*([\d.]+)/.exec(failure.text)?.[1] : undefined));
    return Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, 15_000) : 10_000;
}

/** The server id of the icon that was clicked in the server list, or undefined. */
export function guildIdFromTarget(target: { closest?(selector: string): { getAttribute(name: string): string | null; } | null; } | null | undefined): string | undefined {
    const id = target?.closest?.("[data-list-item-id^=\"guildsnav___\"]")?.getAttribute("data-list-item-id")?.split("___")[1];
    return id !== undefined && SNOWFLAKE.test(id) ? id : undefined;
}

const STICKER_EXTENSIONS: Readonly<Record<number, string>> = { 1: "png", 2: "png", 3: "json", 4: "gif" };
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;

const settings = definePluginSettings({
    copyRoles: { type: "boolean", default: true, description: "Copy roles from the original server" },
    copyChannels: { type: "boolean", default: true, description: "Copy channels and categories from the original server" },
    copyEmojis: { type: "boolean", default: true, description: "Copy emojis from the original server" },
    copyStickers: { type: "boolean", default: true, description: "Copy stickers from the original server" },
    copyBots: { type: "boolean", default: true, description: "Create a #bots-list channel with invite links for the bots of the original server" },
    emojiCount: { type: "number", default: 50, min: 1, max: 250, integer: true, description: "Most emojis to copy (of each kind: still and animated)" },
    stickerCount: { type: "number", default: 5, min: 0, max: 60, integer: true, description: "Most stickers to copy (picked at random)" }
});

interface Rest {
    get(request: { url: string; rejectWithError?: boolean; }): Promise<{ body?: unknown; }>;
    post(request: { url: string; body: unknown; rejectWithError?: boolean; }): Promise<{ body?: unknown; }>;
    patch(request: { url: string; body: unknown; rejectWithError?: boolean; }): Promise<unknown>;
    del(request: { url: string; rejectWithError?: boolean; }): Promise<unknown>;
}

let running = false;
let stopRequested = false;
let generation = 0;

const plugin: PluginCode = {
    settings,

    start(ctx: EnginePluginContext) {
        const mine = ++generation;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const roles = ctx.finders.byStore<{ getSortedRoles(guildId: string): unknown[]; }>("GuildRoleStore");
        const emojis = ctx.finders.byStore<{ getGuildEmoji(guildId: string): unknown[]; }>("EmojiStore");
        const stickers = ctx.finders.byStore<{ getStickersByGuildId(guildId: string): unknown[]; }>("StickersStore");
        const channels = ctx.finders.byStore<{ getMutableGuildChannelsForGuild(guildId: string): Record<string, unknown>; }>("ChannelStore");
        const permissionStore = ctx.finders.byStore<{ getGuildPermissions(guild: unknown): bigint; }>("PermissionStore");
        const members = ctx.common.GuildMemberStore;
        const guildStore = ctx.common.GuildStore;
        const users = ctx.common.UserStore;
        const toast = (text: string, kind: "info" | "success" | "failure" = "info") => { ctx.toasts.show(text, kind); };
        const confirm = (text: string) => (globalThis as unknown as { confirm(question: string): boolean; }).confirm(text);
        const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
        const halt = () => { if (stopRequested || mine !== generation) throw new Error("Stopped."); };
        const wait = async (ms: number) => { await pause(ms); halt(); };
        const guildOf = (id: string) => record(guildStore.get()?.getGuild(id));
        const yourGuilds = (): Array<{ id: string; name: string; ownerId: string; }> => Object.values(record((guildStore.get() as unknown as { getGuilds?(): unknown; } | undefined)?.getGuilds?.())).map(item => {
            const guild = record(item);
            return { id: String(guild.id), name: String(guild.name), ownerId: String(guild.ownerId) };
        }).sort((a, b) => a.name.localeCompare(b.name));
        const options = (): CopyOptions => ({ copyRoles: settings.store.copyRoles, copyChannels: settings.store.copyChannels, copyEmojis: settings.store.copyEmojis, copyStickers: settings.store.copyStickers, copyBots: settings.store.copyBots });
        const bodyOf = (answer: unknown) => record(record(answer).body);

        async function fetchBlob(url: string, maxSize: number): Promise<Blob> {
            for (let size = 4096; size >= 16; size /= 2) {
                const answer = await fetch(`${url}?size=${size}&lossless=true&animated=true`);
                if (!answer.ok) throw new Error(`Could not fetch ${url} (${answer.status})`);
                const blob = await answer.blob();
                if (blob.size <= maxSize) return blob;
            }
            throw new Error(`Could not fetch it within the limit of ${maxSize / 1000} kB`);
        }

        async function deleteChannels(api: Rest, guildId: string) {
            const list = (await api.get({ url: `/guilds/${guildId}/channels`, rejectWithError: true })).body;
            const all = (Array.isArray(list) ? list : []).map(record);
            for (const channel of [...all.filter(c => c.type !== 4), ...all.filter(c => c.type === 4)]) {
                await api.del({ url: `/channels/${String(channel.id)}`, rejectWithError: true });
                await wait(500);
            }
        }

        async function deleteRoles(api: Rest, guildId: string) {
            const list = (await api.get({ url: `/guilds/${guildId}/roles`, rejectWithError: true })).body;
            const all = (Array.isArray(list) ? list : []).map(record).filter(role => role.id !== guildId).sort((a, b) => Number(b.position ?? 0) - Number(a.position ?? 0));
            for (const role of all) {
                try { await api.del({ url: `/guilds/${guildId}/roles/${String(role.id)}`, rejectWithError: true }); } catch { /* a role that cannot be deleted (a bot's own role) is left */ }
                await wait(500);
            }
        }

        async function createBotsChannel(api: Rest, sourceGuildId: string, newGuildId: string) {
            const known = (members.get() as unknown as { getMembers?(guildId: string): unknown[]; } | undefined)?.getMembers?.(sourceGuildId) ?? [];
            const bots = known
                .map(member => record(member).userId)
                .filter((id): id is string => typeof id === "string")
                .map(id => ({ id, user: record(users.get()?.getUser(id)) }))
                .filter(entry => entry.user.bot === true);
            if (bots.length === 0) { toast("No bots found in memory. Open the member list of the server first.", "info"); return; }
            const channel = bodyOf(await api.post({ url: `/guilds/${newGuildId}/channels`, body: { name: "bots-list", type: 0 }, rejectWithError: true }));
            await wait(800);
            for (const bot of bots) {
                try {
                    await api.post({ url: `/channels/${String(channel.id)}/messages`, body: { content: `**${String(bot.user.username ?? bot.id)}**\nhttps://discord.com/oauth2/authorize?client_id=${bot.id}&scope=bot&permissions=0` }, rejectWithError: true });
                } catch { /* one invite that does not go through does not stop the others */ }
                await wait(600);
            }
            toast(`Created #bots-list with ${bots.length} bots.`, "success");
        }

        async function copyGuild(sourceId: string, targetId?: string): Promise<void> {
            const api = rest.get();
            const source = guildOf(sourceId);
            if (!api || typeof source.name !== "string") { toast("Discord's request function or the server was not found.", "failure"); return; }
            if (running) { toast("A copy is already running. Use /guild-copy-stop to stop it.", "failure"); return; }
            const chosen = options();
            const target = targetId ? guildOf(targetId) : undefined;
            if (targetId && typeof target?.name !== "string") { toast("The server to transfer into was not found.", "failure"); return; }
            const question = targetId
                ? `TRANSFER "${source.name}" INTO "${String(target?.name)}"?\n\nThis DELETES ${chosen.copyRoles ? "every role" : ""}${chosen.copyRoles && chosen.copyChannels ? " and " : ""}${chosen.copyChannels ? "every channel and category" : ""}${!chosen.copyRoles && !chosen.copyChannels ? "nothing (roles and channels are not being copied)" : ""} of "${String(target?.name)}" first. It cannot be undone.`
                : `Make a new server that is a copy of "${source.name}"?\n\nIt will be created on your account, with ${[chosen.copyRoles && "roles", chosen.copyChannels && "channels", chosen.copyEmojis && "emojis", chosen.copyStickers && "stickers", chosen.copyBots && "a #bots-list"].filter(Boolean).join(", ") || "nothing else"}. This takes a few minutes.`;
            if (!confirm(question)) return;

            running = true;
            stopRequested = false;
            try {
                const roleList = (roles.get()?.getSortedRoles(sourceId) ?? []).map(record).filter(role => role.name !== "@everyone");
                const channelMap = channels.get()?.getMutableGuildChannelsForGuild(sourceId) ?? {};
                const backupChannels: BackupChannel[] = Object.values(channelMap).map(record).filter(channel => channel.guild_id === sourceId).map(channel => ({
                    id: String(channel.id), name: String(channel.name), type: channel.type === 5 ? 0 : Number(channel.type), position: Number(channel.position ?? 0), nsfw: channel.nsfw === true ? true : undefined,
                    topic: typeof channel.topic === "string" ? channel.topic : undefined, parent_id: typeof channel.parent_id === "string" ? channel.parent_id : undefined,
                    permission_overwrites: channel.permissionOverwrites ? Object.values(record(channel.permissionOverwrites)) : [],
                    rate_limit_per_user: Number(channel.rateLimitPerUser) || undefined, bitrate: Number(channel.bitrate) || undefined, user_limit: Number(channel.userLimit) || undefined,
                    default_auto_archive_duration: Number(channel.defaultAutoArchiveDuration) || undefined, rtc_region: typeof channel.rtcRegion === "string" ? channel.rtcRegion : undefined,
                    video_quality_mode: Number(channel.videoQualityMode) || undefined, default_thread_rate_limit_per_user: Number(channel.defaultThreadRateLimitPerUser) || undefined
                }));
                const allEmojis = (emojis.get()?.getGuildEmoji(sourceId) ?? []).map(record);
                const emojiCount = settings.store.emojiCount;
                const emojiList = [...allEmojis.filter(e => !e.animated).slice(0, emojiCount), ...allEmojis.filter(e => e.animated).slice(0, emojiCount)];
                const stickerList = [...(stickers.get()?.getStickersByGuildId(sourceId) ?? [])].map(record).sort(() => 0.5 - Math.random()).slice(0, settings.store.stickerCount);

                let destination = targetId;
                if (destination) {
                    toast(`Transferring into ${String(target?.name)}...`);
                    if (chosen.copyRoles) await deleteRoles(api, destination);
                    if (chosen.copyChannels) { try { await deleteChannels(api, destination); } catch (error) { if (mine !== generation || stopRequested) throw error; } }
                } else {
                    toast("Creating the new server...");
                    const made = bodyOf(await api.post({ url: "/guilds", body: { name: `${source.name} (Copy)`, icon: source.icon, description: source.description }, rejectWithError: true }));
                    destination = String(made.id);
                    try { await deleteChannels(api, destination); } catch (error) { if (mine !== generation || stopRequested) throw error; }
                }
                const into = destination;

                const roleMapping: Record<string, string> = { [sourceId]: into };
                if (chosen.copyRoles) {
                    toast(`Copying ${roleList.length} roles...`);
                    for (const role of roleList) {
                        try {
                            const made = bodyOf(await api.post({ url: `/guilds/${into}/roles`, body: { name: role.name, permissions: String(role.permissions ?? "0"), color: role.color, hoist: role.hoist, mentionable: role.mentionable }, rejectWithError: true }));
                            roleMapping[String(role.id)] = String(made.id);
                        } catch { /* a role that fails is skipped */ }
                        await wait(500);
                    }
                    const positions = roleList.map(role => ({ id: roleMapping[String(role.id)], position: Number(role.position ?? 0) })).filter(entry => typeof entry.id === "string");
                    if (positions.length > 0) { try { await api.patch({ url: `/guilds/${into}/roles`, body: positions, rejectWithError: true }); } catch { /* the order is a nicety */ } }
                }

                const channelMapping: Record<string, string> = {};
                if (chosen.copyChannels) {
                    toast(`Copying ${backupChannels.length} channels...`);
                    for (const channel of creationOrder(backupChannels)) {
                        try {
                            const made = bodyOf(await api.post({ url: `/guilds/${into}/channels`, body: channelBody(channel, roleMapping, channelMapping), rejectWithError: true }));
                            channelMapping[channel.id] = String(made.id);
                        } catch { /* a channel that fails is skipped */ }
                        await wait(500);
                    }
                }

                if (chosen.copyBots) await createBotsChannel(api, sourceId, into);

                if (chosen.copyEmojis) {
                    toast(`Copying ${emojiList.length} emojis (slowly, Discord limits it)...`);
                    for (const emoji of emojiList) {
                        const upload = async () => {
                            const blob = await fetchBlob(`https://cdn.discordapp.com/emojis/${String(emoji.id)}.${emoji.animated ? "gif" : "png"}`, MAX_EMOJI_BYTES);
                            const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { resolve(String(reader.result)); }; reader.onerror = () => { reject(new Error("Could not read the picture")); }; reader.readAsDataURL(blob); });
                            await api.post({ url: `/guilds/${into}/emojis`, body: { name: emoji.name, image }, rejectWithError: true });
                        };
                        try {
                            await upload();
                        } catch (error) {
                            if (record(error).status === 429) {
                                await wait(retryAfterMs(error));
                                try { await upload(); } catch { /* skipped after the retry */ }
                            }
                        }
                        await wait(2500);
                    }
                }

                if (chosen.copyStickers) {
                    toast(`Copying ${stickerList.length} stickers...`);
                    for (const sticker of stickerList) {
                        try {
                            const form = new FormData();
                            form.append("name", String(sticker.name));
                            form.append("tags", String(sticker.tags ?? ""));
                            form.append("description", String(sticker.description ?? ""));
                            form.append("file", await fetchBlob(`https://media.discordapp.net/stickers/${String(sticker.id)}.${STICKER_EXTENSIONS[Number(sticker.format_type)] ?? "png"}`, MAX_STICKER_BYTES));
                            await api.post({ url: `/guilds/${into}/stickers`, body: form, rejectWithError: true });
                        } catch { /* a sticker that fails is skipped */ }
                        await wait(1000);
                    }
                }
                toast(targetId ? "Server transfer finished." : "Server copy finished.", "success");
            } catch (error) {
                toast(error instanceof Error && error.message === "Stopped." ? "Stopped. What was already created or deleted stays that way." : `Could not finish: ${error instanceof Error ? error.message : "something went wrong"}`, "failure");
            } finally {
                running = false;
            }
        }

        function openPicker(sourceId: string) {
            const react = currentReact() as any;
            const h = react.createElement;
            const Root = ctx.components.ModalRoot.get() as any;
            const Content = ctx.components.ModalContent.get() as any;
            const Close = ctx.components.ModalCloseButton.get() as any;
            if (!Root || !Content) { toast("The window could not be opened.", "failure"); return; }
            const me = users.get()?.getCurrentUser()?.id;
            const required = requiredPermissions(options());
            const candidates = yourGuilds().filter(guild => guild.id !== sourceId && canWriteTo(permissionStore.get()?.getGuildPermissions(guildOf(guild.id)) ?? 0n, guild.ownerId === me, required));
            function Picker(props: { onClose(): void; }) {
                const [query, setQuery] = react.useState("") as [string, (v: string) => void];
                const shown = candidates.filter(guild => guild.name.toLowerCase().includes(query.trim().toLowerCase()));
                return h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px", color: "var(--text-default, var(--text-normal, #dbdee1))" } },
                    h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: 0 } }, "Transfer to"),
                    h("span", { style: { fontSize: "13px", opacity: 0.85 } }, "Only servers where you may do it are listed. The server you pick loses its roles and channels first; you are asked once more before anything is deleted."),
                    h("input", { value: query, placeholder: "Search servers", onChange: (e: any) => setQuery(e.target.value), style: { padding: "4px 8px" } }),
                    h("div", { style: { maxHeight: "320px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" } },
                        shown.length === 0 ? h("span", { style: { opacity: 0.7 } }, "No servers found where you have the needed permissions.")
                            : shown.map(guild => h("div", { key: guild.id, style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" } },
                                h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, guild.name),
                                h("button", { type: "button", style: { cursor: "pointer", padding: "4px 10px" }, onClick: () => { props.onClose(); void copyGuild(sourceId, guild.id); } }, "Transfer")))));
            }
            ctx.modals.open(props => h(Root, { size: "medium", onClose: props.onClose, label: "Transfer to" }, h(Content, null, h(Picker, { onClose: props.onClose })), Close ? h(Close, { onClick: props.onClose }) : null));
        }

        ctx.menuItems.add("guild-copier", click => {
            const id = guildIdFromTarget(click.target as unknown as Parameters<typeof guildIdFromTarget>[0]);
            if (!id) return null;
            return [{ label: "Copy Guild", action: () => { void copyGuild(id); } }, { label: "Transfer To", action: () => { openPicker(id); } }];
        });
        const currentGuild = () => ctx.common.SelectedGuildStore.get()?.getGuildId();
        ctx.commands.add({ name: "guild-copy", description: "Make a new server that is a copy of the one you are in", execute() { const id = currentGuild(); if (id) void copyGuild(id); else toast("Open a server first.", "failure"); } });
        ctx.commands.add({ name: "guild-transfer", description: "Put the one you are in into another server of yours (deletes its roles and channels)", execute() { const id = currentGuild(); if (id) openPicker(id); else toast("Open a server first.", "failure"); } });
        ctx.commands.add({ name: "guild-copy-stop", description: "Stop a server copy that is going on", execute() { if (!running) { toast("No copy is running.", "info"); return; } stopRequested = true; toast("Stopping...", "info"); } });
    },

    stop() {
        generation++;
        stopRequested = true;
    }
};

export default plugin;
