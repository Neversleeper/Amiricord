/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CopyStickerLinks (authors Ven, Byeoon) as found in TestCord's copy of Vencord's plugins. The original adds the items to Discord's own menus and gets the sticker from their props; here they go in Amiricord's right-click menu and the sticker is read from the clicked picture (its address `/stickers/<id>.<ext>`) or, in the picker, from `data-id` and Discord's sticker store (found by name). The link is the same one (512 pixels, lossless). Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

/** Sticker format numbers Discord uses: 1 PNG, 2 APNG, 3 Lottie, 4 GIF. */
const EXTENSION: Record<number, string> = { 1: "png", 2: "png", 3: "json", 4: "gif" };

/** The link of a sticker's picture, by its id and format number. */
export function stickerUrl(id: string, format: number): string {
    return `https://cdn.discordapp.com/stickers/${id}.${EXTENSION[format] ?? "png"}?size=512&lossless=true`;
}

/** The id and format number of a sticker from the address of its picture, when it is one. */
export function stickerFromSrc(src: string | undefined): { id: string; format: number; } | undefined {
    const found = /\/stickers\/(\d{15,25})\.(png|gif|json|webp)/.exec(src ?? "");
    if (!found) return undefined;
    return { id: found[1], format: found[2] === "gif" ? 4 : found[2] === "json" ? 3 : 1 };
}

const plugin: PluginCode = {
    start(ctx) {
        const stickers = ctx.finders.byStore<{ getStickerById(id: string): { id: string; format_type: number; } | undefined; }>("StickersStore");
        ctx.menuItems.add("sticker-links", click => {
            let sticker = stickerFromSrc(click.src ?? (click.target as HTMLImageElement | null)?.src);
            if (!sticker) {
                const element = (click.target as Element).closest?.("[data-type=\"sticker\"]") as HTMLElement | null | undefined;
                const found = element?.dataset.id ? stickers.get()?.getStickerById(element.dataset.id) : undefined;
                if (found) sticker = { id: found.id, format: found.format_type };
            }
            if (!sticker) return null;
            const url = stickerUrl(sticker.id, sticker.format);
            return [
                {
                    label: "Copy Sticker Link",
                    action: async () => {
                        try {
                            await navigator.clipboard.writeText(url);
                            ctx.toasts.show("Link copied!", "success");
                        } catch (error) {
                            ctx.reportError("CopyStickerLinks", error);
                            ctx.toasts.show("Could not copy the link", "failure");
                        }
                    }
                },
                { label: "Open Sticker Link", action: () => { window.open(url, "_blank"); } }
            ];
        });
    }
};

export default plugin;
