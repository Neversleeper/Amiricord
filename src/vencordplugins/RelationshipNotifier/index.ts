/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */

// Adapted for Amiricord (2026) from the plugin RelationshipNotifier (author nick) as found in TestCord's copy of Vencord's plugins. The three patches are the original's
// (they tell the plugin when YOU remove a friend, leave a server or close a group, so that is not reported as being removed); checked on build 653945, each matches once.
// What it does: it remembers your friends, group chats and servers, and tells you when one of them is gone. Differences: the memory is the plugin's own storage (one entry
// per kind, per account) instead of Vencord's DataStore, the notice card is Amiricord's own notification card, "show a notice at the top of the screen" is a short message
// at the bottom of the page, and a person who is no longer a friend is looked up through Discord's REST object (a request to Discord like any other) when they are not in
// the user store. Not tried in a real Discord: the notices, and the offline removals at start.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

interface Simple { id: string; name: string; iconURL?: string; }

const FRIEND = 1;
const BLOCKED = 2;
const INCOMING = 3;
const OUTGOING = 4;
const GROUP_DM = 3;

const settings = definePluginSettings({
    notices: { type: "boolean", default: false, description: "Also show a message at the bottom of your screen when removed (use this if you don't want to miss any notifications)." },
    offlineRemovals: { type: "boolean", default: true, description: "Notify you when starting discord if you were removed while offline." },
    friends: { type: "boolean", default: true, description: "Notify when a friend removes you" },
    friendRequestCancels: { type: "boolean", default: true, description: "Notify when a friend request is cancelled" },
    servers: { type: "boolean", default: true, description: "Notify when removed from a server" },
    groups: { type: "boolean", default: true, description: "Notify when removed from a group chat" }
} as const);

let context: EnginePluginContext | undefined;
let generation = 0;
let users: Lazy;
let guildStore: Lazy;
let members: Lazy;
let channels: Lazy;
let relationships: Lazy;
let availability: Lazy;
let rest: Lazy;
let profileActions: Lazy;

const guilds = new Map<string, Simple>();
const groups = new Map<string, Simple>();
const friends = { friends: [] as string[], requests: [] as string[] };

let manuallyRemovedFriend: string | undefined;
let manuallyRemovedGuild: string | undefined;
let manuallyRemovedGroup: string | undefined;

const me = (): string | undefined => users?.get()?.getCurrentUser?.()?.id;

async function load<T>(kind: string): Promise<T | undefined> {
    const id = me();
    if (!id || !context) return undefined;
    return await context.storage.get(`${kind}-${id}`) as T | undefined;
}

async function save(kind: string, value: unknown): Promise<void> {
    const id = me();
    if (!id || !context) return;
    await context.storage.set(`${kind}-${id}`, value as never);
}

function notify(text: string, icon?: string, onClick?: () => void): void {
    if (!context) return;
    if (settings.store.notices) context.toasts.show(text, "info");
    context.notifications.show({ title: "Relationship Notifier", body: text, icon, onClick });
}

function avatarOf(user: any): string | undefined {
    if (typeof user?.getAvatarURL === "function") return user.getAvatarURL(undefined, undefined, false);
    return user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : undefined;
}

const uniqueName = (user: any): string => user.discriminator && user.discriminator !== "0" ? `${user.username}#${user.discriminator}` : `@${user.username}`;

async function userOf(id: string): Promise<any | null> {
    const known = users?.get()?.getUser?.(id);
    if (known) return known;
    try {
        const response = await rest?.get()?.get?.({ url: `/users/${id}` });
        return response?.body ?? null;
    } catch {
        return null;
    }
}

function openProfile(id: string): () => void {
    return () => profileActions?.get()?.openUserProfileModal?.({ userId: id });
}

async function syncGuilds(): Promise<void> {
    guilds.clear();
    const mine = me();
    if (!mine) return;
    for (const [id, guild] of Object.entries<any>(guildStore?.get()?.getGuilds?.() ?? {})) {
        if (members?.get()?.isMember?.(id, mine)) {
            guilds.set(id, { id, name: guild.name, iconURL: guild.icon ? `https://cdn.discordapp.com/icons/${id}/${guild.icon}.png` : undefined });
        }
    }
    await save("guilds", [...guilds.entries()]);
}

async function syncGroups(): Promise<void> {
    groups.clear();
    for (const channel of channels?.get()?.getSortedPrivateChannels?.() ?? []) {
        if (channel.type !== GROUP_DM) continue;
        groups.set(channel.id, {
            id: channel.id,
            name: channel.name || (channel.rawRecipients ?? []).map((r: any) => r.username).join(", "),
            iconURL: channel.icon ? `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png` : undefined
        });
    }
    await save("groups", [...groups.entries()]);
}

async function syncFriends(): Promise<void> {
    friends.friends = [];
    friends.requests = [];
    for (const [id, type] of relationships?.get()?.getMutableRelationships?.() ?? []) {
        if (type === FRIEND) friends.friends.push(id);
        else if (type === INCOMING) friends.requests.push(id);
    }
    await save("friends", friends);
}

async function syncAndRunChecks(): Promise<void> {
    const mine = generation;
    if (!me()) return;
    const [oldGuilds, oldGroups, oldFriends] = await Promise.all([
        load<Array<[string, Simple]>>("guilds"), load<Array<[string, Simple]>>("groups"), load<{ friends: string[]; requests: string[]; }>("friends")
    ]);
    await Promise.all([syncGuilds(), syncGroups(), syncFriends()]);
    if (mine !== generation || !settings.store.offlineRemovals) return;

    if (settings.store.groups) {
        for (const [id, group] of oldGroups ?? []) if (!groups.has(id)) notify(`You are no longer in the group ${group.name}.`, group.iconURL);
    }
    if (settings.store.servers) {
        for (const [id, guild] of oldGuilds ?? []) {
            if (!guilds.has(id) && !availability?.get()?.isUnavailable?.(id)) notify(`You are no longer in the server ${guild.name}.`, guild.iconURL);
        }
    }
    if (settings.store.friends) {
        for (const id of oldFriends?.friends ?? []) {
            if (friends.friends.includes(id)) continue;
            const user = await userOf(id);
            if (user) notify(`You are no longer friends with ${uniqueName(user)}.`, avatarOf(user), openProfile(user.id));
        }
    }
    if (settings.store.friendRequestCancels) {
        for (const id of oldFriends?.requests ?? []) {
            const type = relationships?.get()?.getRelationshipType?.(id);
            if (friends.requests.includes(id) || [FRIEND, BLOCKED, OUTGOING].includes(type)) continue;
            const user = await userOf(id);
            if (user) notify(`Friend request from ${uniqueName(user)} has been revoked.`, avatarOf(user), openProfile(user.id));
        }
    }
}

async function onRelationshipRemove(event: any): Promise<void> {
    const id = event?.relationship?.id;
    const type = event?.relationship?.type;
    if (typeof id !== "string") return;
    if (manuallyRemovedFriend === id) {
        manuallyRemovedFriend = undefined;
        return;
    }
    const user = await userOf(id);
    if (!user) return;
    if (type === FRIEND && settings.store.friends) notify(`${uniqueName(user)} removed you as a friend.`, avatarOf(user), openProfile(user.id));
    else if (type === INCOMING && settings.store.friendRequestCancels) notify(`A friend request from ${uniqueName(user)} has been removed.`, avatarOf(user), openProfile(user.id));
}

function onGuildDelete(event: any): void {
    const id = event?.guild?.id;
    if (!settings.store.servers || typeof id !== "string") return;
    if (event.guild.unavailable || availability?.get()?.isUnavailable?.(id)) return;
    const guild = guilds.get(id);
    guilds.delete(id);
    void syncGuilds();
    if (manuallyRemovedGuild === id) {
        manuallyRemovedGuild = undefined;
        return;
    }
    if (guild) notify(`You were removed from the server ${guild.name}.`, guild.iconURL);
}

function onChannelDelete(event: any): void {
    const id = event?.channel?.id;
    if (!settings.store.groups || event?.channel?.type !== GROUP_DM || typeof id !== "string") return;
    const group = groups.get(id);
    groups.delete(id);
    void syncGroups();
    if (manuallyRemovedGroup === id) {
        manuallyRemovedGroup = undefined;
        return;
    }
    if (group) notify(`You were removed from the group ${group.name}.`, group.iconURL);
}

const plugin: PluginCode & {
    removeFriend(id: string): void;
    removeGroup(id: string): void;
    removeGuild(id: string): void;
} = {
    settings,

    patches: [
        {
            find: "removeRelationship:(",
            lazy: true,
            replacements: [{ match: /(removeRelationship:\((\i),\i,\i\)=>)/, replace: "$1($self.removeFriend($2),0)||" }]
        },
        {
            find: "async leaveGuild(",
            lazy: true,
            replacements: [{ match: /(leaveGuild\((\i)\){)/, replace: "$1$self.removeGuild($2);" }]
        },
        {
            find: "},closePrivateChannel(",
            lazy: true,
            replacements: [{ match: /(closePrivateChannel\((\i)\){)/, replace: "$1$self.removeGroup($2);" }]
        }
    ],

    flux: {
        GUILD_CREATE: () => { void syncGuilds(); },
        GUILD_DELETE: onGuildDelete,
        CHANNEL_CREATE: () => { void syncGroups(); },
        CHANNEL_DELETE: onChannelDelete,
        RELATIONSHIP_ADD: () => { void syncFriends(); },
        RELATIONSHIP_UPDATE: () => { void syncFriends(); },
        RELATIONSHIP_REMOVE: (event: any) => { void onRelationshipRemove(event).then(syncFriends); },
        CONNECTION_OPEN: () => { void syncAndRunChecks(); }
    },

    start(ctx) {
        context = ctx;
        generation++;
        users = ctx.common.UserStore;
        guildStore = ctx.common.GuildStore;
        members = ctx.common.GuildMemberStore;
        channels = ctx.common.ChannelStore;
        relationships = ctx.common.RelationshipStore;
        availability = ctx.finders.byStore("GuildAvailabilityStore");
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        profileActions = ctx.finders.byProps("openUserProfileModal");
        const mine = generation;
        setTimeout(() => { if (mine === generation) void syncAndRunChecks(); }, 5000);
    },

    stop() {
        generation++;
        context = users = guildStore = members = channels = relationships = availability = rest = profileActions = undefined;
        guilds.clear();
        groups.clear();
    },

    removeFriend(id) { manuallyRemovedFriend = id; },
    removeGroup(id) { manuallyRemovedGroup = id; },
    removeGuild(id) { manuallyRemovedGuild = id; }
};

export default plugin;
