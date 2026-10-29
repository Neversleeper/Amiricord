/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin ExpressionCloner (authors Ven, Nuckyz and scattagain) as found in TestCord's copy of Vencord's plugins. Right click an emoji or a
// sticker (in a message, or in the expression picker), press "Clone Emoji" / "Clone Sticker", pick a name and press the server you want it in. Differences from the original:
//  - the picture is downloaded from Discord's own addresses (cdn.discordapp.com for emoji, media.discordapp.net for stickers), declared in the manifest; it tries sizes from
//    4096 down until the file is small enough (256 kB for emoji, 512 kB for stickers), as the original did;
//  - the window is plain: a name box and one round button per server where you may add it (the original used Discord's text input check and tooltips);
//  - the server pictures are the CDN addresses of the icons, the short messages are Amiricord's toasts, and Discord's emoji upload function is found by its code
//    (`.GUILD_EMOJIS(` with `EMOJI_UPLOAD_START`; that text exists once in build 653945);
//  - lottie stickers cannot be cloned (as in the original).
// NOT checked on a live page: that Discord's two menus ("message" and "expression-picker") can be reached by `addNative` (their ids are not written as text in the main
// file, so they may live in code Discord loads later), the sticker store name, and the whole flow. If the menus cannot be reached, nothing is added.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

interface Clone { type: "Emoji" | "Sticker"; id: string; name: string; isAnimated?: boolean; format?: number; tags?: string; description?: string; }

const CDN = "https://cdn.discordapp.com";
const MEDIA = "https://media.discordapp.net";
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const CREATE_EXPRESSIONS = 1n << 43n;
const MANAGE_EXPRESSIONS = 1n << 30n;
const EXTENSION: Record<number, string> = { 1: "png", 2: "png", 3: "json", 4: "gif" };
const STICKER_SLOTS: Record<number, number> = { 0: 5, 1: 15, 2: 30, 3: 60 };
const NAME = /^\w+$/;

let context: EnginePluginContext | undefined;
let guildStore: Lazy;
let permissions: Lazy;
let users: Lazy;
let emojis: Lazy;
let stickers: Lazy;
let uploadEmoji: Lazy;
let rest: Lazy;
let dispatcher: Lazy;

const urlOf = (data: Clone, size: number): string => data.type === "Emoji"
    ? `${CDN}/emojis/${data.id}.webp?size=${size}&lossless=true&animated=true`
    : `${MEDIA}/stickers/${data.id}.${EXTENSION[data.format ?? 1] ?? "png"}?size=${size}&lossless=true&animated=true`;

function stickerSlots(guild: any): number {
    if (guild.features?.has?.("MORE_STICKERS") && guild.premiumTier === 3) return 120;
    return STICKER_SLOTS[guild.premiumTier] ?? STICKER_SLOTS[0];
}

function emojiSlots(guild: any): number {
    return Math.max(guild.features?.has?.("MORE_EMOJI") ? 200 : 50, 50 + (guild.premiumFeatures?.additionalEmojiSlots ?? 0));
}

function candidates(data: Clone): any[] {
    const mine = users?.get()?.getCurrentUser?.()?.id;
    return (Object.values(guildStore?.get()?.getGuilds?.() ?? {}) as any[]).filter(guild => {
        const may = guild.ownerId === mine || permissions?.get()?.can?.(CREATE_EXPRESSIONS, guild) || permissions?.get()?.can?.(MANAGE_EXPRESSIONS, guild);
        if (!may) return false;
        if (data.type === "Sticker") {
            const have = stickers?.get()?.getStickersByGuildId?.(guild.id);
            return !have || have.length < stickerSlots(guild);
        }
        let count = 0;
        for (const emoji of emojis?.get()?.getGuildEmoji?.(guild.id) ?? []) if (emoji.animated === data.isAnimated && !emoji.managed) count++;
        return count < emojiSlots(guild);
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function download(data: Clone): Promise<Blob> {
    const limit = data.type === "Sticker" ? MAX_STICKER_BYTES : MAX_EMOJI_BYTES;
    for (let size = 4096; size >= 16; size /= 2) {
        const url = urlOf(data, size);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url} - ${response.status}`);
        const blob = await response.blob();
        if (blob.size <= limit) return blob;
    }
    throw new Error(`Failed to fetch ${data.type} within size limit of ${limit / 1000}kB`);
}

async function cloneEmoji(guildId: string, data: Clone): Promise<void> {
    const blob = await download(data);
    const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("the picture could not be read"));
        reader.readAsDataURL(blob);
    });
    const upload = uploadEmoji?.get();
    if (typeof upload !== "function") throw new Error("Discord's emoji upload function was not found");
    await upload({ guildId, name: data.name.split("~")[0], image });
}

async function cloneSticker(guildId: string, data: Clone): Promise<void> {
    const form = new FormData();
    form.append("name", data.name);
    form.append("tags", data.tags ?? "");
    form.append("description", data.description ?? "");
    form.append("file", await download(data));
    const { body } = await rest?.get()?.post({ url: `/guilds/${guildId}/stickers`, body: form });
    dispatcher?.get()?.dispatch({ type: "GUILD_STICKERS_CREATE_SUCCESS", guildId, sticker: { ...body, user: users?.get()?.getCurrentUser?.() } });
}

async function doClone(guildId: string, data: Clone): Promise<void> {
    const where = guildStore?.get()?.getGuild?.(guildId)?.name ?? "your server";
    try {
        await (data.type === "Sticker" ? cloneSticker(guildId, data) : cloneEmoji(guildId, data));
        context?.toasts.show(`Successfully cloned ${data.name} to ${where}!`, "success");
    } catch (error: any) {
        let message = "Something went wrong";
        try { message = JSON.parse(error.text).message; } catch { /* not a message from Discord */ }
        context?.reportError("ExpressionCloner", error);
        context?.toasts.show(`Failed to clone: ${message}`, "failure");
    }
}

function openWindow(ctx: EnginePluginContext, data: Clone): void {
    const react = currentReact() as any;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) {
        ctx.toasts.show("The window could not be opened.", "failure");
        return;
    }
    const h = react.createElement;
    function Body({ onClose }: { onClose(): void; }) {
        const [busy, setBusy] = react.useState(false) as [boolean, (value: boolean) => void];
        const [name, setName] = react.useState(data.name) as [string, (value: string) => void];
        const [round, again] = react.useReducer((n: number) => n + 1, 0) as [number, () => void];
        const guilds = react.useMemo(() => candidates(data), [data.id, round]) as any[];
        const valid = data.type === "Emoji" ? name.length > 2 && name.length < 32 && NAME.test(name) : name.length > 2 && name.length < 30;
        return h("div", { style: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 } }, h("img", { alt: "", src: urlOf(data, 64), width: 24, height: 24 }), `Clone ${data.name}`),
            h("label", null, "Custom name",
                h("input", {
                    value: name,
                    style: { display: "block", width: "100%", marginTop: "4px", padding: "8px", borderRadius: "4px", border: valid ? "1px solid transparent" : "1px solid var(--status-danger, #f23f43)" },
                    onChange: (event: { target: { value: string; }; }) => { data.name = event.target.value; setName(event.target.value); }
                })),
            valid ? null : h("div", { style: { color: "var(--status-danger, #f23f43)", fontSize: 12 } }, "Name must be between 2 and 32 characters and only contain letters, numbers and underscores"),
            h("div", { style: { display: "flex", flexWrap: "wrap", gap: "1em", padding: "1em 0.5em", justifyContent: "center", alignItems: "center" } },
                guilds.length === 0 ? h("div", null, "There is no server where you can add it.") : guilds.map(guild => h("div", {
                    key: guild.id,
                    role: "button",
                    title: guild.name,
                    "aria-label": `Clone to ${guild.name}`,
                    "aria-disabled": busy || !valid,
                    style: {
                        borderRadius: "50%", backgroundColor: "var(--background-base-lower, rgba(128,128,128,0.3))", display: "inline-flex", justifyContent: "center", alignItems: "center",
                        width: "4em", height: "4em", overflow: "hidden", cursor: busy || !valid ? "not-allowed" : "pointer", filter: busy || !valid ? "brightness(50%)" : "none"
                    },
                    onClick: busy || !valid ? undefined : () => {
                        setBusy(true);
                        void doClone(guild.id, data).finally(() => { again(); setBusy(false); });
                    }
                }, guild.icon
                    ? h("img", { alt: guild.name, "aria-hidden": true, style: { width: "100%", height: "100%" }, src: `${CDN}/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith("a_") ? "gif" : "png"}?size=128` })
                    : h("span", { style: { fontSize: 14 } }, String(guild.name).split(/\s+/).map(word => word[0]).join("").slice(0, 4))))),
            Close ? h(Close, { onClick: onClose }) : null);
    }
    ctx.modals.open(props => h(Root, { size: "small", onClose: props.onClose, label: `Clone ${data.type}` }, h(Content, null, h(Body, { onClose: props.onClose }))));
}

async function fetchSticker(id: string): Promise<any> {
    const cached = stickers?.get()?.getStickerById?.(id);
    if (cached) return cached;
    const { body } = await rest?.get()?.get({ url: `/stickers/${id}` });
    dispatcher?.get()?.dispatch({ type: "STICKER_FETCH_SUCCESS", sticker: body });
    return body;
}

function isGif(url: string | undefined): boolean {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.pathname.endsWith(".gif") || parsed.searchParams.get("animated") === "true";
    } catch {
        return false;
    }
}

function emojiName(id: string, message: any): string | null {
    const known = emojis?.get()?.getCustomEmojiById?.(id);
    if (known) return known.name;
    const reaction = message?.reactions?.find((r: any) => r.emoji?.id === id);
    if (reaction) return reaction.emoji.name;
    const found = String(message?.content ?? "").match(new RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>`));
    if (found) return found[1];
    for (const embed of message?.embeds ?? []) {
        const inEmbed = JSON.stringify(embed).match(new RegExp(`<a?:(\\w+)(?:~\\d+)?:${id}>`));
        if (inEmbed) return inEmbed[1];
    }
    return null;
}

function menuItem(ctx: EnginePluginContext, type: "Emoji" | "Sticker", load: () => Promise<Clone> | Clone): unknown {
    const parts = ctx.contextMenu.parts();
    if (!parts) return null;
    return (currentReact() as any).createElement(parts.MenuItem as never, {
        id: "emote-cloner",
        key: "emote-cloner",
        label: `Clone ${type}`,
        action: () => {
            Promise.resolve(load()).then(data => openWindow(ctx, data), error => ctx.reportError("ExpressionCloner", error));
        }
    });
}

const plugin: PluginCode = {
    start(ctx) {
        context = ctx;
        guildStore = ctx.common.GuildStore;
        permissions = ctx.common.PermissionStore;
        users = ctx.common.UserStore;
        emojis = ctx.finders.byStore("EmojiStore");
        stickers = ctx.finders.byStore("StickersStore");
        uploadEmoji = ctx.finders.byCode(".GUILD_EMOJIS(", "EMOJI_UPLOAD_START");
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        dispatcher = ctx.common.FluxDispatcher;

        ctx.contextMenu.addNative("message", (children, props: any) => {
            const { favoriteableId, itemHref, itemSrc, favoriteableType, message } = props ?? {};
            if (!favoriteableId) return;
            let item: unknown = null;
            if (favoriteableType === "emoji") {
                item = menuItem(ctx, "Emoji", () => ({ type: "Emoji", id: favoriteableId, name: emojiName(favoriteableId, message) ?? "FakeNitroEmoji", isAnimated: isGif(itemHref ?? itemSrc) }));
            } else if (favoriteableType === "sticker") {
                const sticker = message?.stickerItems?.find((s: any) => s.id === favoriteableId);
                if (sticker?.format_type !== 3) item = menuItem(ctx, "Sticker", async () => stickerFormat(await fetchSticker(favoriteableId)));
            }
            if (item) children.push(item);
        });

        ctx.contextMenu.addNative("expression-picker", (children, props: any) => {
            const { id, name, type } = props?.target?.dataset ?? {};
            if (!id) return;
            let item: unknown = null;
            if (type === "emoji") {
                const picture = props.target.firstChild as HTMLImageElement | null;
                item = menuItem(ctx, "Emoji", () => ({
                    type: "Emoji", id,
                    name: name || props.target?.alt?.replace(/^:|:$/g, "") || "FakeNitroEmoji",
                    isAnimated: !!picture && isGif(picture.src)
                }));
            } else if (type === "sticker" && !String(props.target.className ?? "").includes("lottieCanvas")) {
                item = menuItem(ctx, "Sticker", async () => stickerFormat(await fetchSticker(id)));
            }
            if (item) children.push(item);
        });
    },

    stop() {
        context = guildStore = permissions = users = emojis = stickers = uploadEmoji = rest = dispatcher = undefined;
    }
};

/** Discord names the sticker's kind `format_type`; the window wants it as `format`, and the other fields as they are. */
function stickerFormat(sticker: any): Clone {
    return { type: "Sticker", id: sticker.id, name: sticker.name, tags: sticker.tags, description: sticker.description, format: sticker.format_type };
}

export default plugin;
