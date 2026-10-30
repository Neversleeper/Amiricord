/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin IconExport (author x2b) as found in TestCord. Same three formats. The emoji and sticker lists come from Discord's own stores for the current server (only what Discord has loaded, which is everything for a server you are in). The text goes to the clipboard, so the permission to use the clipboard is declared. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

export interface IconEntry { kind: "emoji" | "sticker"; id: string; name: string; url: string; }

const STICKER_EXTENSION: Record<number, string> = { 1: "png", 2: "png", 3: "json", 4: "gif" };

/** The entries for a server's emojis and stickers. */
export function iconEntries(emojis: Array<{ id: string; name: string; animated?: boolean; }>, stickers: Array<{ id: string; name: string; format_type?: number; }>): IconEntry[] {
    return [
        ...emojis.map((emoji): IconEntry => ({ kind: "emoji", id: emoji.id, name: emoji.name, url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?size=128` })),
        ...stickers.map((sticker): IconEntry => ({ kind: "sticker", id: sticker.id, name: sticker.name, url: `https://cdn.discordapp.com/stickers/${sticker.id}.${STICKER_EXTENSION[sticker.format_type ?? 1] ?? "png"}?size=160` }))
    ];
}

/** The entries as text in one of the formats: "markdown", "json" or "urls". */
export function formatIcons(entries: IconEntry[], format: string): string {
    switch (format.trim().toLowerCase()) {
        case "json": return JSON.stringify(entries, null, 2);
        case "urls": case "url": return entries.map(entry => entry.url).join("\n");
        default: return ["| Type | Name | Id | Link |", "| --- | --- | --- | --- |", ...entries.map(entry => `| ${entry.kind} | ${entry.name.replace(/\|/g, "\\|")} | ${entry.id} | ${entry.url} |`)].join("\n");
    }
}

const plugin: PluginCode = {
    start(ctx) {
        const selectedGuild = ctx.common.SelectedGuildStore;
        const emojis = ctx.finders.byStore<{ getGuildEmoji(guildId: string): Array<{ id: string; name: string; animated?: boolean; }>; }>("EmojiStore");
        const stickers = ctx.finders.byStore<{ getStickersByGuildId(guildId: string): Array<{ id: string; name: string; format_type?: number; }> | undefined; }>("StickersStore");
        ctx.commands.add({
            name: "icons",
            description: "Copy every emoji and sticker of this server",
            options: [{ name: "format", description: "markdown, json or urls (markdown when empty)" }],
            async execute(args) {
                const guildId = selectedGuild.get()?.getGuildId();
                if (!guildId) { ctx.toasts.show("Use this inside a server.", "failure"); return; }
                const entries = iconEntries(emojis.get()?.getGuildEmoji(guildId) ?? [], stickers.get()?.getStickersByGuildId(guildId) ?? []);
                if (entries.length === 0) { ctx.toasts.show("This server has no emojis or stickers.", "failure"); return; }
                try {
                    await navigator.clipboard.writeText(formatIcons(entries, String(args.find(arg => arg.name === "format")?.value ?? "markdown")));
                    ctx.toasts.show(`Copied ${entries.length} emojis and stickers.`, "success");
                } catch (error) {
                    ctx.reportError("IconExport", error);
                    ctx.toasts.show("Could not copy.", "failure");
                }
            }
        });
    }
};

export default plugin;
