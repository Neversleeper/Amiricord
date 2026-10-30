/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin MoreUserTags (authors Cyn, TheSun, RyanCaoDev, LordElias, AutumnVN, Hen and meowabyte) of Equicord. Differences from the original:
//  - the tags show in the MEMBER LIST and next to the name in a PROFILE. Not in chat messages (the original used Vencord's MessageDecorations API, whose patch text no longer
//    exists in Discord's web build 653945, and the new message header was not found), and not in the direct message list. Because of that the WEBHOOK tag (which needs a
//    message) and the "show in chat" choice are not here, and neither are the options "no apps allowed" and "don't show the bot tag";
//  - the settings are one switch and one text per tag (the original drew a window of its own for them);
//  - the three patches were checked against that build: the Tag component's text for unknown types (matches once), the decorators of a member list row (once) and the trailing
//    part of the profile name (once). The permission maths is Discord's own function, found by its text, as in the original.
// Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

/** Discord's permission bits (documented values). */
const PERMISSION = {
    ADMINISTRATOR: 1n << 3n, MANAGE_GUILD: 1n << 5n, MANAGE_CHANNELS: 1n << 4n, MANAGE_ROLES: 1n << 28n,
    MANAGE_MESSAGES: 1n << 13n, KICK_MEMBERS: 1n << 1n, BAN_MEMBERS: 1n << 2n,
    MOVE_MEMBERS: 1n << 24n, MUTE_MEMBERS: 1n << 22n, DEAFEN_MEMBERS: 1n << 23n, MODERATE_MEMBERS: 1n << 40n
} as const;

type PermissionName = keyof typeof PERMISSION;

interface TagDefinition {
    name: string;
    displayName: string;
    description: string;
    permissions?: PermissionName[];
    owner?: true;
}

export const TAGS: readonly TagDefinition[] = [
    { name: "OWNER", displayName: "Owner", description: "Owns the server", owner: true },
    { name: "ADMINISTRATOR", displayName: "Admin", description: "Has the administrator permission", permissions: ["ADMINISTRATOR"] },
    { name: "MODERATOR_STAFF", displayName: "Staff", description: "Can manage the server, channels or roles", permissions: ["MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES"] },
    { name: "MODERATOR", displayName: "Mod", description: "Can manage messages or kick/ban people", permissions: ["MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS"] },
    { name: "VOICE_MODERATOR", displayName: "VC Mod", description: "Can manage voice chats", permissions: ["MOVE_MEMBERS", "MUTE_MEMBERS", "DEAFEN_MEMBERS"] },
    { name: "CHAT_MODERATOR", displayName: "Chat Mod", description: "Can timeout people", permissions: ["MODERATE_MEMBERS"] }
];

/** Discord's own tag types are small numbers (0 and up); ours start at 101 so they never meet. */
const FIRST_TYPE = 101;
const typeOf = (index: number) => FIRST_TYPE + index;

const settings = definePluginSettings({
    dontShowForBots: { type: "boolean", default: false, description: "Don't show these tags on bots." },
    ...Object.fromEntries(TAGS.flatMap(tag => [
        [`show_${tag.name}`, { type: "boolean", default: true, description: `Show the ${tag.displayName} tag (${tag.description}).` }],
        [`text_${tag.name}`, { type: "string", default: tag.displayName, maxLength: 24, description: `The text of the ${tag.displayName} tag.` }]
    ]))
} as const);

const CACHE_TTL_MS = 10_000;
const MAX_CACHE = 500;
const permissionCache = new Map<string, { permissions: bigint; at: number; }>();

let context: EnginePluginContext | undefined;
let Tag: any;
let computePermissions: ((options: Record<string, unknown>) => bigint) | undefined;
let channels: any;
let selectedChannel: any;
let guilds: any;
let dispatcher: any;

const setting = (key: string): unknown => (settings.store as Record<string, unknown>)[key];

function permissionsOf(user: { id: string; }, channel: any): bigint {
    const guild = guilds?.getGuild?.(channel?.guild_id);
    if (!guild || !computePermissions) return 0n;
    const key = `${user.id}:${guild.id}`;
    const cached = permissionCache.get(key);
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.permissions;
    const permissions = computePermissions({ user, context: guild, overwrites: channel.permissionOverwrites });
    if (permissionCache.size >= MAX_CACHE) {
        const first = permissionCache.keys().next().value;
        if (first !== undefined) permissionCache.delete(first);
    }
    permissionCache.set(key, { permissions, at: now });
    return permissions;
}

/** The index in TAGS of the first tag that fits this person in the open conversation, or -1. */
export function tagFor(user: any, channel: any, read: (key: string) => unknown, permissionBits: (user: any, channel: any) => bigint): number {
    if (!user || !channel?.guild_id) return -1;
    if (user.bot && read("dontShowForBots")) return -1;
    const bits = permissionBits(user, channel);
    return TAGS.findIndex(tag => {
        if (!read(`show_${tag.name}`)) return false;
        if (tag.owner) return guilds?.getGuild?.(channel.guild_id)?.ownerId === user.id;
        return (tag.permissions ?? []).some(name => (bits & PERMISSION[name]) !== 0n);
    });
}

function tagElement(user: any): unknown {
    const react = currentReact() as any;
    if (!Tag || !user) return null;
    try {
        const channel = channels?.getChannel?.(selectedChannel?.getChannelId?.());
        const index = tagFor(user, channel, setting, permissionsOf);
        return index < 0 ? null : react.createElement(Tag, { type: typeOf(index), verified: false, key: `amiricord-tag-${index}` });
    } catch (error) {
        context?.reportError("MoreUserTags", error);
        return null;
    }
}

const RETRIES = 6;
const RETRY_MS = 500;

/**
 * A member list row is drawn once, and when that happens before Discord knows the open channel (right after Discord starts or the page is reloaded) it got no tag and kept none until it
 * was drawn again (seen live: the Mod and Admin tags of a whole list missing until the list was scrolled). So the tag has a piece of its own that draws it again when the channel is
 * chosen, and a few times in the first seconds.
 */
function TagSlot(props: { user?: unknown; }): unknown {
    const react = currentReact() as any;
    const [, bump] = react.useReducer((count: number) => count + 1, 0);
    react.useEffect(() => {
        const listener = () => { bump(); };
        dispatcher?.subscribe?.("CHANNEL_SELECT", listener);
        let left = RETRIES;
        const timer = setInterval(() => { bump(); if (--left <= 0) clearInterval(timer); }, RETRY_MS);
        return () => {
            clearInterval(timer);
            dispatcher?.unsubscribe?.("CHANNEL_SELECT", listener);
        };
    }, []);
    return tagElement(props.user);
}

const plugin: PluginCode & {
    customTagText(type: unknown): string | undefined;
    renderMemberListTag(props: { user?: unknown; } | undefined): unknown;
    withProfileTag(props: { user?: unknown; } | undefined, original: unknown): unknown;
} = {
    settings,

    patches: [
        {
            // The Tag component: a type that is not one of Discord's falls to the "app" text. Ours ask for their own.
            find: "STAFF_ONLY_DM:",
            required: false,
            replacements: [{
                match: /(case \i\.\i\.BOT:default:)(\i)=(\i\.intl\.string\(\i\.t\[[^\]]+\]\))/,
                replace: "$1$2=$self.customTagText(arguments[0].type)??$3"
            }]
        },
        {
            // A row of the member list: the decorators (bot tag, crown, boost icon) get ours first.
            find: "lostPermissionTooltipText:",
            required: false,
            replacements: [{
                match: /(\.memo\(function\(\i\)\{let\{user:\i,isOwner:\i,lostPermissionTooltipText:\i,ownerTooltipText:\i,premiumSince:\i,onClickPremiumGuildIcon:\i\}=\i;return\(0,\i\.jsxs\)\(\i\.Fragment,\{children:\[)/,
                replace: "$1$self.renderMemberListTag(arguments[0]),"
            }]
        },
        {
            // The name in a profile: what follows the name (the bot tag) comes with ours.
            find: "onClickDisplayName:",
            required: false,
            replacements: [{
                match: /displayNameTrailing:(\i)\}\)/,
                replace: "displayNameTrailing:$self.withProfileTag(arguments[0],$1)})"
            }]
        }
    ],

    flux: {
        GUILD_ROLE_UPDATE() { permissionCache.clear(); },
        GUILD_ROLE_CREATE() { permissionCache.clear(); },
        GUILD_ROLE_DELETE() { permissionCache.clear(); },
        GUILD_MEMBER_UPDATE(event: unknown) {
            const userId = (event as { member?: { userId?: string; }; } | undefined)?.member?.userId;
            if (userId === null || userId === undefined) return;
            for (const key of [...permissionCache.keys()]) if (key.startsWith(`${userId}:`)) permissionCache.delete(key);
        }
    },

    customTagText(type) {
        if (typeof type !== "number" || type < FIRST_TYPE) return undefined;
        const tag = TAGS[type - FIRST_TYPE];
        if (!tag) return undefined;
        const text = setting(`text_${tag.name}`);
        return typeof text === "string" && text !== "" ? text : tag.displayName;
    },

    renderMemberListTag(props) {
        if (!props?.user) return null;
        return (currentReact() as any).createElement(TagSlot, { user: props.user, key: "amiricord-tag-slot" });
    },

    withProfileTag(props, original) {
        const extra = tagElement(props?.user);
        if (!extra) return original;
        const react = currentReact() as any;
        return react.createElement(react.Fragment, null, original, " ", extra);
    },

    start(ctx) {
        context = ctx;
        Tag = ctx.finders.componentByCode("useRemSizes", "hideIcon", "invertColor").get();
        computePermissions = ctx.finders.byCode<(options: Record<string, unknown>) => bigint>(".getCurrentUser()", ".computeLurkerPermissionsAllowList()").get();
        channels = ctx.common.ChannelStore.get();
        selectedChannel = ctx.common.SelectedChannelStore.get();
        guilds = ctx.common.GuildStore.get();
        dispatcher = ctx.common.FluxDispatcher.get();
    },

    stop() {
        permissionCache.clear();
        context = Tag = computePermissions = channels = selectedChannel = guilds = dispatcher = undefined;
    }
};

export default plugin;
