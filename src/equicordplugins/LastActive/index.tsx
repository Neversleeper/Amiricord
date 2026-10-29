/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and menu pieces have no types */

// Adapted for Amiricord (2026) from the plugin LastActive (author Crxa) of Equicord. Differences from the original: the entries are added with `ctx.contextMenu.addNative`
// (menu names of Vencord: `channel-context`, `user-context`, `thread-context`; they are NOT in the readable part of Discord's build, so if an entry never shows, that is the first
// place to look) and they have no custom icon. The search request is the one of the original. Not tried in a real Discord at the time of writing.

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

let context: EnginePluginContext | undefined;
// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
let rest: { get(): any; } | undefined;
let router: { get(): ((path: string) => void) | undefined; } | undefined;
let users: { get(): any; } | undefined;

/** Discord's search answer groups each hit with its neighbours: the first message of the person in the answer is the last one they wrote. */
export function firstMessageOf(answer: any, userId: string): string | null {
    const found = (answer?.body?.messages as any[] | undefined)?.flat?.().find((message: any) => message?.author?.id === userId);
    return typeof found?.id === "string" ? found.id : null;
}

async function findLastMessageFromUser(guildId: string, channelId: string, userId: string): Promise<string | null> {
    const ctx = context;
    try {
        const answer = await rest?.get()?.get({
            url: guildId === "@me" ? `/channels/${channelId}/messages/search` : `/guilds/${guildId}/messages/search`,
            query: { author_id: userId, channel_id: channelId, sort_by: "timestamp", sort_order: "desc", offset: 0 },
            rejectWithError: true
        });
        const id = firstMessageOf(answer, userId);
        if (id) return id;
    } catch (error) {
        ctx?.reportError("LastActive", error);
        ctx?.toasts.show("Failed to find messages.", "failure");
        return null;
    }
    ctx?.toasts.show("Couldn't find any recent messages from this user.", "failure");
    return null;
}

async function jumpToLastActive(channel: any, targetUserId?: string): Promise<void> {
    const ctx = context;
    if (!channel?.id) { ctx?.toasts.show("Channel information not available.", "failure"); return; }
    const userId = targetUserId ?? users?.get()?.getCurrentUser?.()?.id;
    if (!userId) return;
    const guildId = channel.guild_id ?? "@me";
    const messageId = await findLastMessageFromUser(guildId, channel.id, userId);
    if (messageId) router?.get()?.(`/channels/${guildId}/${channel.id}/${messageId}`);
}

function item(ctx: EnginePluginContext, id: string, label: string, action: () => void): unknown {
    const parts = ctx.contextMenu.parts();
    const react = ctx.components.react.get() as any;
    if (!parts || !react) return null;
    return react.createElement(parts.MenuItem as any, { id, key: id, label, action });
}

const plugin: PluginCode = {
    start(ctx) {
        context = ctx;
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        // Discord's own navigation function, found by its log text: its module has no readable property names in this build.
        router = ctx.finders.byCode("transitionTo - Transitioning to");
        users = ctx.common.UserStore;

        const channelEntry = (children: unknown[], props: unknown) => {
            const channel = (props as { channel?: any; } | undefined)?.channel;
            const entry = channel ? item(ctx, "last-active", "Your Last Message", () => { void jumpToLastActive(channel); }) : null;
            if (entry) children.push(entry);
        };
        ctx.contextMenu.addNative("channel-context", channelEntry);
        ctx.contextMenu.addNative("thread-context", channelEntry);
        ctx.contextMenu.addNative("user-context", (children, props) => {
            const { user, channel } = (props ?? {}) as { user?: any; channel?: any; };
            if (!channel || !user?.id) return;
            const entry = item(ctx, "last-active", "User's Last Message", () => { void jumpToLastActive(channel, user.id); });
            if (entry) children.push(entry);
        });
    },

    stop() {
        context = rest = router = users = undefined;
    }
};

export default plugin;
