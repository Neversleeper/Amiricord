/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ChannelGallery (authors x2b, Equicord contributors) as found in TestCord. A smaller version of the original window: it reads a few pages of the channel's messages from Discord (page size and number of pages are settings) and lists every picture it finds as a thumbnail; a click opens the picture in the browser. The original's header button and caption options are not ported. The thumbnails are loaded from Discord's own picture servers, like the chat does.

import { openPanelWindow } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    includeGifs: { type: "boolean", default: true, description: "Include GIFs in the gallery" },
    includeEmbeds: { type: "boolean", default: true, description: "Include the pictures of embeds (links with a preview)" },
    pageSize: { type: "number", default: 100, min: 10, max: 100, integer: true, description: "Messages read per page (Discord allows at most 100)" },
    preloadPages: { type: "number", default: 2, min: 1, max: 5, integer: true, description: "How many pages to read when the gallery opens" }
});

export interface GalleryMessage {
    id: string;
    attachments?: Array<{ id?: string; filename?: string; content_type?: string; url: string; proxy_url?: string; }>;
    embeds?: Array<{ type?: string; url?: string; image?: { url?: string; proxy_url?: string; }; thumbnail?: { url?: string; proxy_url?: string; }; }>;
}
export interface GalleryItem { key: string; name: string; url: string; thumb: string; gif: boolean; }

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)(?:\?|$)/i;
const GIF = /\.gif(?:\?|$)/i;

/** A smaller picture address for Discord's picture servers; others stay as they are. */
export function thumbnailUrl(address: string): string {
    try {
        const url = new URL(address);
        if (url.hostname.endsWith("discordapp.net") || url.hostname.endsWith("discordapp.com")) {
            url.searchParams.set("width", "200");
            url.searchParams.set("height", "200");
            return url.toString();
        }
    } catch { /* keep the address */ }
    return address;
}

/** The pictures found in messages, newest first, without repeats. */
export function galleryItems(messages: GalleryMessage[], options: { includeGifs: boolean; includeEmbeds: boolean; }): GalleryItem[] {
    const items: GalleryItem[] = [];
    const seen = new Set<string>();
    const add = (key: string, name: string, url: string | undefined, proxy: string | undefined, gif: boolean) => {
        if (!url || seen.has(url) || (gif && !options.includeGifs)) return;
        seen.add(url);
        items.push({ key, name, url, thumb: thumbnailUrl(proxy ?? url), gif });
    };
    for (const message of messages) {
        for (const [index, attachment] of (message.attachments ?? []).entries()) {
            const isImage = (attachment.content_type ?? "").startsWith("image/") || IMAGE.test(attachment.filename ?? attachment.url);
            if (isImage) add(`${message.id}-a${index}`, attachment.filename ?? "picture", attachment.url, attachment.proxy_url, (attachment.content_type ?? "") === "image/gif" || GIF.test(attachment.filename ?? attachment.url));
        }
        if (!options.includeEmbeds) continue;
        for (const [index, embed] of (message.embeds ?? []).entries()) {
            const picture = embed.image ?? embed.thumbnail;
            if (picture?.url) add(`${message.id}-e${index}`, embed.url ?? "embed", picture.url, picture.proxy_url, embed.type === "gifv" || GIF.test(picture.url));
        }
    }
    return items;
}

interface Rest { get(request: { url: string; query?: Record<string, unknown>; }): Promise<{ body: GalleryMessage[]; }>; }

const plugin: PluginCode = {
    start(ctx) {
        const selected = ctx.common.SelectedChannelStore;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        ctx.commands.add({
            name: "gallery",
            description: "Show the pictures of this channel",
            async execute() {
                const channelId = selected.get()?.getChannelId();
                if (!channelId) { ctx.toasts.show("Open a channel first.", "failure"); return; }
                const messages: GalleryMessage[] = [];
                let before: string | undefined;
                try {
                    for (let page = 0; page < settings.store.preloadPages; page++) {
                        const batch = (await rest.get()?.get({ url: `/channels/${channelId}/messages`, query: { limit: settings.store.pageSize, ...(before ? { before } : {}) } }))?.body ?? [];
                        if (batch.length === 0) break;
                        messages.push(...batch);
                        before = batch[batch.length - 1].id;
                        if (batch.length < settings.store.pageSize) break;
                    }
                } catch (error) {
                    ctx.reportError("ChannelGallery", error);
                    ctx.toasts.show("Could not read the messages.", "failure");
                    return;
                }
                const items = galleryItems(messages, settings.store);
                if (items.length === 0) { ctx.toasts.show("No pictures found in the latest messages.", "failure"); return; }
                openPanelWindow(ctx, `Gallery (${items.length})`, kit => kit.panel(kit.h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "8px", maxHeight: "60vh", overflowY: "auto" } },
                    items.map(item => kit.h("a", { key: item.key, href: item.url, target: "_blank", rel: "noreferrer", title: item.name, style: { display: "block", borderRadius: "4px", overflow: "hidden", background: "var(--background-secondary, #2b2d31)" } },
                        kit.h("img", { src: item.thumb, alt: item.name, loading: "lazy", draggable: false, style: { width: "100%", height: "120px", objectFit: "cover", display: "block" } }))))));
            }
        });
    }
};

export default plugin;
