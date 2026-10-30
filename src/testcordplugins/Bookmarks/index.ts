/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Bookmarks (author sirphantom89) as found in TestCord. Same idea and same data (author, the first 140 characters, when, where). The button is drawn by the engine on the message bar and the list is a tab in the Amiricord settings (not a window from a header menu). Bookmarks are kept in this computer's storage for the plugin. The jump uses Discord's own jump-to-message function, found by name.

import { addPanelTab } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface Bookmark { messageId: string; channelId: string; guildId: string | null; author: string; content: string; time: number; }

const KEY = "list";
let bookmarks: Bookmark[] = [];
const listeners = new Set<() => void>();

/** The list with the message added, or removed when it is already there. Newest first. */
export function toggleBookmark(list: Bookmark[], mark: Bookmark): Bookmark[] {
    return list.some(entry => entry.messageId === mark.messageId) ? list.filter(entry => entry.messageId !== mark.messageId) : [mark, ...list];
}

/** The bookmarks whose author or text has the words typed. */
export function searchBookmarks(list: Bookmark[], query: string): Bookmark[] {
    const needle = query.trim().toLowerCase();
    return needle === "" ? list : list.filter(entry => entry.author.toLowerCase().includes(needle) || entry.content.toLowerCase().includes(needle));
}

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        bookmarks = Array.isArray(saved) ? saved as unknown as Bookmark[] : [];
        const messages = ctx.common.MessageStore;
        const channels = ctx.common.ChannelStore;
        const actions = ctx.finders.byProps<{ jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; }): void; }>("jumpToMessage");
        const save = async () => {
            await ctx.storage.set(KEY, bookmarks as never);
            for (const listener of listeners) listener();
        };
        ctx.messageButtons.add({
            id: "bookmark",
            label: "Bookmark message",
            icon: { viewBox: "0 0 24 24", path: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" },
            onClick: ({ channelId, messageId }) => {
                const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { content?: string; author?: { username?: string; }; } | undefined; } | undefined)?.getMessage(channelId, messageId);
                bookmarks = toggleBookmark(bookmarks, {
                    messageId, channelId, guildId: channels.get()?.getChannel(channelId)?.guild_id ?? null,
                    author: message?.author?.username ?? "Unknown", content: (message?.content ?? "").slice(0, 140), time: Date.now()
                });
                ctx.toasts.show(bookmarks.some(entry => entry.messageId === messageId) ? "Bookmarked." : "Bookmark removed.", "success");
                save().catch(error => { ctx.reportError("Bookmarks", error); });
            }
        });
        const guilds = ctx.common.GuildStore;
        addPanelTab(ctx, {
            title: "Bookmarks",
            subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            render: (kit, react) => {
                const [query, setQuery] = react.useState("") as [string, (value: string) => void];
                const shown = searchBookmarks(bookmarks, query);
                return kit.panel(
                    kit.card([
                        kit.title(`Bookmarks (${shown.length}/${bookmarks.length})`),
                        kit.input({ value: query, onChange: setQuery, placeholder: "Search by author or text" })
                    ]),
                    bookmarks.length === 0
                        ? kit.card([kit.note("No bookmarks yet. Hover a message and press the bookmark button.")])
                        : kit.card(shown.map(entry => kit.item(entry.messageId, null, entry.author, `${entry.guildId ? guilds.get()?.getGuild(entry.guildId)?.name ?? "A server" : "Direct message"}: ${entry.content || "(no text)"}`, [
                            kit.button("Jump", () => { actions.get()?.jumpToMessage({ channelId: entry.channelId, messageId: entry.messageId, flash: true }); }),
                            kit.button("Remove", () => { bookmarks = bookmarks.filter(other => other.messageId !== entry.messageId); save().catch(() => undefined); }, { variant: "danger" })
                        ])))
                );
            }
        });
    },
    stop() {
        listeners.clear();
        bookmarks = [];
    }
};

export default plugin;
