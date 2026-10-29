/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and menu pieces have no types */

// Adapted for Amiricord (2026) from the plugin ViewIcons (authors Vendicated, TheKodeToad, Nuckyz and nyx) of Vencord. Differences from the original:
//  - the image opens in a window of Amiricord's own (the original used a Vencord helper that reuses Discord's picture viewer), with a link to the full size;
//  - only the banner patch is kept. The four patches for avatars (profile picture, group chat icon, the two icons at the top of a direct message) no longer find their text in
//    Discord's web build 653945: that build opens a profile picture by itself (`onOpenAvatar`) and moved the rest. The banner patch was checked against that build (module with
//    `"--custom-cutout-radius":`) and matches once;
//  - the entries of the right-click menus use `ctx.contextMenu.addNative` with Vencord's menu names (`user-context`, `guild-context`, `gdm-context`). Those names are NOT in the
//    readable part of the build (Discord builds them at run time), so if an entry never shows, that is the first place to look. Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const SIZES = ["128", "256", "512", "1024", "2048", "4096"];

const settings = definePluginSettings({
    format: {
        type: "select", default: "webp", description: "The image format for pictures that do not move. Pictures that move always use webp.",
        options: [{ label: "webp", value: "webp" }, { label: "png", value: "png" }, { label: "jpg", value: "jpg" }]
    },
    imgSize: {
        type: "select", default: "1024", description: "The size to ask Discord for.",
        options: SIZES.map(n => ({ label: n, value: n }))
    }
});

let context: EnginePluginContext | undefined;
let icons: any;
let members: any;

/** The address to show and the address of the full size, from one of Discord's picture addresses. */
export function viewUrls(url: string, base: string, format: string, size: string): { shown: string; original: string; } {
    const u = new URL(url, base);
    const chosen = url.startsWith("/") ? "png" : u.searchParams.get("animated") === "true" ? "webp" : format;
    u.searchParams.set("size", size);
    u.pathname = u.pathname.replace(/\.(png|jpe?g|webp)$/, `.${chosen}`);
    const shown = u.toString();
    u.searchParams.set("size", "4096");
    return { shown, original: u.toString() };
}

type Clickable = { stopPropagation?(): void; };

function openImage(url: string | null | undefined, event?: Clickable) {
    event?.stopPropagation?.();
    const ctx = context;
    if (!ctx || !url) return;
    const { shown, original } = viewUrls(url, window.location.href, String(settings.store.format), String(settings.store.imgSize));
    const react = currentReact() as any;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) return;
    const h = react.createElement;
    ctx.modals.open(props => h(Root, { size: "large", onClose: props.onClose, label: "Image" },
        h(Content, null,
            h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px" } },
                h("img", { src: shown, alt: "", style: { maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" } }),
                h("a", { href: original, target: "_blank", rel: "noreferrer noopener", style: { color: "var(--text-link, #00a8fc)" } }, "Open the full size"))),
        Close ? h(Close, { onClick: props.onClose }) : null));
}

const openAvatar = (url: string, event?: Clickable) => { openImage(url, event); };
const openBanner = (url: string, event?: Clickable) => { openImage(url, event); };

function makeItem(ctx: EnginePluginContext, id: string, label: string, action: () => void): unknown {
    const parts = ctx.contextMenu.parts();
    const react = ctx.components.react.get() as any;
    if (!parts || !react) return null;
    return react.createElement(parts.MenuItem as any, { id, key: id, label, action });
}

function addGroup(ctx: EnginePluginContext, children: unknown[], items: unknown[]): void {
    const parts = ctx.contextMenu.parts();
    const react = ctx.components.react.get() as any;
    const live = items.filter(Boolean);
    if (!parts || !react || live.length === 0) return;
    children.splice(-1, 0, react.createElement(parts.MenuGroup as any, { key: "amiricord-view-icons" }, ...live));
}

const plugin: PluginCode & { openAvatar: typeof openAvatar; openBanner: typeof openBanner; } = {
    settings,
    openAvatar,
    openBanner,

    patches: [
        {
            // The profile banner. The click opens it large, and the pointer shows it can be clicked.
            find: '"--custom-cutout-radius":',
            replacements: [{
                match: /style:\{(?=\.\.\.\i,backgroundImage:null!=(\i)&&""!==\1\?`url\(\$\{\1\}\)`)/,
                replace: (_: string, src: string) => `onClick:vcEvent=>${src}!=null&&""!==${src}&&$self.openBanner(${src},vcEvent),style:{cursor:${src}!=null&&""!==${src}?"pointer":void 0,`
            }]
        }
    ],

    start(ctx) {
        context = ctx;
        icons = ctx.finders.byProps("getUserAvatarURL", "getGuildIconURL");
        members = ctx.common.GuildMemberStore;

        ctx.contextMenu.addNative("user-context", (children, props) => {
            const { user, guildId } = (props ?? {}) as { user?: any; guildId?: string; };
            const utils = icons.get();
            if (!user || !utils) return;
            const memberAvatar = guildId ? members.get()?.getMember?.(guildId, user.id)?.avatar || null : null;
            const decoration = user.avatarDecorationData ?? user.avatarDecoration;
            addGroup(ctx, children, [
                makeItem(ctx, "view-avatar", "View Avatar", () => openAvatar(utils.getUserAvatarURL(user, true))),
                memberAvatar ? makeItem(ctx, "view-server-avatar", "View Server Avatar", () => openAvatar(utils.getGuildMemberAvatarURLSimple({ userId: user.id, avatar: memberAvatar, guildId, canAnimate: true }))) : null,
                decoration ? makeItem(ctx, "view-avatar-decoration", "View Avatar Decoration", () => openAvatar(utils.getAvatarDecorationURL({ avatarDecoration: decoration, size: 1024, canAnimate: true }))) : null
            ]);
        });

        ctx.contextMenu.addNative("guild-context", (children, props) => {
            const guild = (props as { guild?: any; } | undefined)?.guild;
            const utils = icons.get();
            if (!guild || !utils || (!guild.icon && !guild.banner)) return;
            addGroup(ctx, children, [
                guild.icon ? makeItem(ctx, "view-icon", "View Icon", () => openAvatar(utils.getGuildIconURL({ id: guild.id, icon: guild.icon, canAnimate: true }))) : null,
                guild.banner ? makeItem(ctx, "view-banner", "View Banner", () => openBanner(utils.getGuildBannerURL(guild, true))) : null
            ]);
        });

        ctx.contextMenu.addNative("gdm-context", (children, props) => {
            const channel = (props as { channel?: any; } | undefined)?.channel;
            const utils = icons.get();
            if (!channel || !utils) return;
            addGroup(ctx, children, [makeItem(ctx, "view-group-channel-icon", "View Icon", () => openAvatar(utils.getChannelIconURL(channel)))]);
        });
    },

    stop() {
        context?.modals.closeAll();
        context = icons = members = undefined;
    }
};

export default plugin;
