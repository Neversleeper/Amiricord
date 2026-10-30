/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RecentChannelSwitcher (author x2b) as found in TestCord. A smaller version of the original: it keeps the most recent channels (the number is a setting) and shows them in a window; pressing one goes there. The jump uses the engine's new ctx.navigate (the page history, so Discord's own router opens the channel). The list is kept in this plugin's storage. Not tried with a long list.

import { openPanelWindow } from "../../api/panelHost";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    maxRecent: { type: "number", default: 10, min: 2, max: 50, integer: true, description: "How many recent channels to keep" }
});

export interface Recent { channelId: string; guildId: string | null; }

const KEY = "recent";

/** The list with the channel put first (and no copy of it further down), cut to `max`. */
export function remember(list: Recent[], entry: Recent, max: number): Recent[] {
    return [entry, ...list.filter(other => other.channelId !== entry.channelId)].slice(0, Math.max(1, max));
}

/** The address of a channel for the router. */
export function channelPath(entry: Recent): string {
    return `/channels/${entry.guildId ?? "@me"}/${entry.channelId}`;
}

let recent: Recent[] = [];

const plugin: PluginCode = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        recent = Array.isArray(saved) ? (saved as unknown as Recent[]).filter(entry => entry && typeof entry.channelId === "string") : [];
        const channels = ctx.common.ChannelStore;
        const guilds = ctx.common.GuildStore;
        const users = ctx.common.UserStore;
        const selected = ctx.common.SelectedChannelStore;
        const nameOf = (entry: Recent) => {
            const channel = channels.get()?.getChannel(entry.channelId) as { name?: string; recipients?: string[]; } | undefined;
            if (!channel) return { title: entry.channelId, sub: "Not loaded" };
            const people = (channel.recipients ?? []).map(id => (users.get()?.getUser(id) as { globalName?: string; username?: string; } | undefined)).map(user => user?.globalName ?? user?.username ?? "?");
            return entry.guildId
                ? { title: `#${channel.name ?? entry.channelId}`, sub: guilds.get()?.getGuild(entry.guildId)?.name ?? "A server" }
                : { title: channel.name || people.join(", ") || "Direct message", sub: "Direct messages" };
        };
        const open = () => {
            const shown = recent.filter(entry => entry.channelId !== selected.get()?.getChannelId());
            const done = openPanelWindow(ctx, "Recent channels", (kit, _react) => kit.panel(shown.length === 0
                ? kit.card([kit.note("No recent channels yet.")])
                : kit.card(shown.map(entry => { const name = nameOf(entry); return kit.item(entry.channelId, null, name.title, name.sub, [kit.button("Go", () => { ctx.navigate(channelPath(entry)); })]); }))));
            if (!done) ctx.toasts.show("The window could not be opened.", "failure");
        };
        (plugin as { onSelect?: (event: { channelId?: string | null; guildId?: string | null; }) => void; }).onSelect = ({ channelId, guildId }) => {
            if (!channelId) return;
            recent = remember(recent, { channelId, guildId: guildId ?? null }, settings.store.maxRecent);
            ctx.storage.set(KEY, recent as never).catch(() => undefined);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === "r") { event.preventDefault(); open(); }
        };
        document.addEventListener("keydown", onKey);
        ctx.onDispose(() => { document.removeEventListener("keydown", onKey); });
        ctx.commands.add({ name: "recent", description: "Show your recent channels", execute() { open(); } });
    },
    flux: {
        CHANNEL_SELECT(event: { channelId?: string | null; guildId?: string | null; }) {
            (plugin as { onSelect?: (event: { channelId?: string | null; guildId?: string | null; }) => void; }).onSelect?.(event);
        }
    },
    stop() {
        (plugin as { onSelect?: unknown; }).onSelect = undefined;
        recent = [];
    }
};

export default plugin;
