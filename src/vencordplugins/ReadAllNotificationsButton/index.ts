/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ReadAllNotificationsButton (authors kemo, KrystalSkull) as found in TestCord's copy of Vencord's plugins. Same method (an acknowledge for every channel with unread messages, in every server, including voice channels and threads you joined). The button is drawn with `ctx.serverList` as a plain text button. Not tried in a real Discord.

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */
import { currentReact } from "../../api/jsxRuntime";
import type { PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;
let guilds: Lazy;
let channelsOf: Lazy;
let threads: Lazy;
let readStates: Lazy;
let dispatcher: Lazy;

/** The acknowledge entries for the channels that have unread messages. */
export function unreadEntries(channelIds: string[], hasUnread: (id: string) => boolean, lastMessageId: (id: string) => string | null | undefined): Array<{ channelId: string; messageId: string | null | undefined; readStateType: number; }> {
    return channelIds.filter(hasUnread).map(channelId => ({ channelId, messageId: lastMessageId(channelId), readStateType: 0 }));
}

function readAll(): void {
    const ids: string[] = [];
    for (const guild of Object.values(guilds?.get()?.getGuilds?.() ?? {}) as Array<{ id: string; }>) {
        const lists = channelsOf?.get()?.getChannels?.(guild.id);
        for (const entry of [...(lists?.SELECTABLE ?? []), ...(lists?.VOCAL ?? [])] as Array<{ channel: { id: string; }; }>) ids.push(entry.channel.id);
        const joined = threads?.get()?.getActiveJoinedThreadsForGuild?.(guild.id) ?? {};
        for (const byParent of Object.values(joined) as Array<Record<string, { channel: { id: string; }; }>>) for (const entry of Object.values(byParent)) ids.push(entry.channel.id);
    }
    const states = readStates?.get();
    const channels = unreadEntries(ids, id => Boolean(states?.hasUnread?.(id)), id => states?.lastMessageId?.(id));
    dispatcher?.get()?.dispatch({ type: "BULK_ACK", context: "APP", channels });
}

function ReadAllButton() {
    const h = (currentReact() as any).createElement;
    return h("div", { style: { display: "flex", justifyContent: "center", margin: "4px 0" } },
        h("div", {
            role: "button", tabIndex: 0, onClick: readAll,
            onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") readAll(); },
            style: { cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--text-muted, #949ba4)", textAlign: "center" }
        }, "Read All"));
}

const plugin: PluginCode = {
    start(ctx) {
        guilds = ctx.common.GuildStore;
        readStates = ctx.common.ReadStateStore;
        dispatcher = ctx.common.FluxDispatcher;
        channelsOf = ctx.finders.byStore("GuildChannelStore");
        threads = ctx.finders.byStore("ActiveJoinedThreadsStore");
        ctx.serverList.add("above", ReadAllButton);
    },
    stop() {
        guilds = channelsOf = threads = readStates = dispatcher = undefined;
    }
};

export default plugin;
