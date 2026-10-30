/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and menu pieces have no types */

// Adapted for Amiricord (2026) from the plugin ViewIcons (authors Vendicated, TheKodeToad, Nuckyz and nyx) of Vencord. Differences from the original:
//  - the image opens in Discord's own picture viewer (the function behind "Media Viewer Modal", found by its code), like the original; if that function is not found the
//    picture opens in a window of Amiricord's own, with a Save image button and a link to the full size;
//  - the original's four patches for avatars (profile picture, group chat icon, the two icons at the top of a direct message) no longer find their text in Discord's web build
//    653945. One patch replaces them for the profile picture: Discord's avatar component takes the function that opens the picture (`onOpenAvatar`) and the patch swaps it for the
//    plugin's window, so a click on a person's picture there shows it with a Save button (the right-click "View Avatar" does the same). The group chat icon is only in the right-click menu; The banner patch was checked against that build (module with
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
let mediaViewer: { get(): any; } | undefined;
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
    // A picture that is not in the cache yet left Discord's viewer waiting on its loading screen with nothing drawn (seen live: the same picture opened fine the second time), so it is
    // loaded first and the viewer is opened with the picture's own size.
    void preload(shown).then(size => {
        if (!size) { ctx.toasts.show("Could not load the picture", "failure"); return; }
        display(ctx, shown, original, size);
    });
}

const PRELOAD_LIMIT_MS = 8000;

/** Loads a picture into the browser's cache; its size, or undefined when it did not load in time. */
function preload(url: string): Promise<{ width: number; height: number; } | undefined> {
    return new Promise(resolve => {
        const image = new Image();
        const timer = setTimeout(() => { image.src = ""; resolve(undefined); }, PRELOAD_LIMIT_MS);
        image.onload = () => { clearTimeout(timer); resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 }); };
        image.onerror = () => { clearTimeout(timer); resolve(undefined); };
        image.src = url;
    });
}

function display(ctx: EnginePluginContext, shown: string, original: string, size: { width: number; height: number; }) {
    // Discord's own picture viewer (zoom, right-click to save or copy, open in the browser), the one a picture in a chat opens, like the original plugin.
    const open = mediaViewer?.get();
    if (typeof open === "function") {
        try {
            open({ items: [{ type: "IMAGE", url: shown, proxyUrl: shown, original, width: size.width, height: size.height, spoiler: false, srcIsAnimated: false }], startingIndex: 0, location: "ViewIcons" });
            return;
        } catch {
            // the viewer changed: fall through to the window of the plugin
        }
    }
    const react = currentReact() as any;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    const Button = ctx.components.Button.get() as any;
    if (!Root || !Content) return;
    const h = react.createElement;
    ctx.modals.open(props => h(Root, { size: "large", onClose: props.onClose, label: "Image" },
        h(Content, null,
            h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px" } },
                h("img", { src: shown, alt: "", style: { maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" } }),
                h("div", { style: { display: "flex", alignItems: "center", gap: "16px" } },
                    Button ? h(Button, { variant: "primary", size: "small", onClick: () => { void saveImage(original).then(saved => ctx.toasts.show(saved ? "Image saved" : "Could not save the image", saved ? "success" : "failure")); } }, "Save image") : null,
                    h("a", { href: original, target: "_blank", rel: "noreferrer noopener", style: { color: "var(--text-link, #00a8fc)" } }, "Open the full size")))),
        Close ? h(Close, { onClick: props.onClose }) : null));
}

/** Saves a picture to the disk: fetched as a blob so the browser downloads it instead of opening it. */
async function saveImage(url: string): Promise<boolean> {
    try {
        const response = await fetch(url);
        if (!response.ok) return false;
        const blob = await response.blob();
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
        return true;
    } catch {
        return false;
    }
}

const openAvatar = (url: string, event?: Clickable) => { openImage(url, event); };
const openBanner = (url: string, event?: Clickable) => { openImage(url, event); };

/** The picture of a person, as shown in a server when they have one there. */
function openUserAvatar(user: any, guildId?: string | null): void {
    const utils = icons?.get();
    if (!utils || !user) return;
    const memberAvatar = guildId ? members?.get()?.getMember?.(guildId, user.id)?.avatar || null : null;
    const url = memberAvatar
        ? utils.getGuildMemberAvatarURLSimple({ userId: user.id, avatar: memberAvatar, guildId, canAnimate: true })
        : utils.getUserAvatarURL(user, true);
    openImage(url);
}

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

const plugin: PluginCode & { openAvatar: typeof openAvatar; openBanner: typeof openBanner; openUserAvatar: typeof openUserAvatar; } = {
    settings,
    openAvatar,
    openBanner,
    openUserAvatar,

    patches: [
        {
            // Discord's avatar component: the function that opens a picture on click becomes the plugin's window.
            find: /\{onOpenProfile:[\w$]+,onOpenAvatar:[\w$]+,className:/,
            replacements: [{
                match: /(\i)=null!=(\i)\.user\.avatar\|\|\2\.user\.hasAvatarForGuild\((\i)\)\?\i:void 0/,
                replace: "$1=null!=$2.user.avatar||$2.user.hasAvatarForGuild($3)?()=>$self.openUserAvatar($2.user,$3):void 0"
            }]
        },
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
        mediaViewer = ctx.finders.byCode("markSessionStarted", "numMediaItems");
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
        context = icons = members = mediaViewer = undefined;
    }
};

export default plugin;
