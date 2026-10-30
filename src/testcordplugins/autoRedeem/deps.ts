/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Part of the Amiricord port of AutoRedeem (original plugin: TestCord, by x2b and irritably).
 */

// Everything AutoRedeem takes from Discord's own code, in one place. The original plugin reached these through global aliases and top-level lazy
// finders (`@webpack/common`, `findStoreLazy`, `findByPropsLazy`); in Amiricord nothing is global: each one is asked from the plugin's own `ctx`
// (`ctx.common` for stores, `ctx.finders` for the rest), so a miss is recorded against this plugin in the health report.
//
// The values are looked up the first time they are read and then kept (same behaviour as a lazy finder). The shapes below are the little of each
// Discord object that AutoRedeem uses; they were written from how Vencord/TestCord use the same objects and have NOT been tried against a real
// Discord build (the engine's own API files say the same about themselves). The finder arguments are the ones Vencord uses for the same objects.

import type { EnginePluginContext } from "../../renderer/engine";

export interface DiscordUser {
    id: string;
    username?: string;
    globalName?: string | null;
    bot?: boolean;
    getAvatarURL?(guildId?: string | null, size?: number, animated?: boolean): string | undefined;
}

export interface DiscordChannel {
    id: string;
    type?: number;
    guild_id?: string;
    name?: string;
}

export interface DiscordMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    content?: string;
    giftCodes?: unknown;
    deleted?: boolean;
    state?: string;
    author?: DiscordUser;
}

export interface MessageGroup {
    hasFetched?: boolean;
    loadingMore?: boolean;
    _array?: DiscordMessage[];
}

export interface RestRequest {
    url: string;
    retries?: number;
    headers?: Record<string, string>;
    body?: unknown;
}

export interface RestResponse {
    body?: unknown;
    status?: number;
}

export interface RestApiLike {
    get(request: RestRequest): Promise<RestResponse>;
    post(request: RestRequest): Promise<RestResponse>;
}

export interface UserStoreLike {
    getCurrentUser(): DiscordUser | undefined;
    getUser(id: string): DiscordUser | undefined;
}

export interface ChannelStoreLike {
    getChannel(id: string): DiscordChannel | undefined;
    getChannelIds(): string[];
    loadAllGuildAndPrivateChannelsFromDisk?(): Promise<unknown>;
}

export interface GuildStoreLike {
    getGuild(id: string): { id: string; name?: string; } | undefined;
}

export interface SelectedChannelStoreLike {
    getChannelId(): string | undefined;
}

export interface MessageStoreLike {
    getMessage(channelId: string, messageId: string): DiscordMessage | undefined;
    getMessages(channelId: string): MessageGroup | undefined;
    isLoadingMessages(channelId: string): boolean;
    whenReady(channelId: string, callback: () => void): void;
}

export interface PermissionStoreLike {
    can(permission: bigint, channel: DiscordChannel): boolean;
}

export interface PermissionsBitsLike {
    VIEW_CHANNEL: bigint;
    READ_MESSAGE_HISTORY: bigint;
}

export interface MessageActionsLike {
    fetchMessages?(request: { channelId: string; limit: number; }): Promise<unknown>;
}

export interface IconUtilsLike {
    getUserAvatarURL(user: DiscordUser, animated: boolean, size: number): string | undefined;
}

export interface NavigationRouterLike {
    transitionTo(path: string): void;
}

export interface AutoRedeemDeps {
    readonly RestAPI: RestApiLike;
    readonly UserStore: UserStoreLike;
    readonly ChannelStore: ChannelStoreLike;
    readonly GuildStore: GuildStoreLike;
    readonly SelectedChannelStore: SelectedChannelStoreLike;
    readonly MessageStore: MessageStoreLike;
    readonly PermissionStore: PermissionStoreLike;
    readonly PermissionsBits: PermissionsBitsLike;
    readonly MessageActions: MessageActionsLike;
    readonly IconUtils: IconUtilsLike;
    readonly NavigationRouter: NavigationRouterLike;
    /**
     * Resolves when the REST client and the stores the queue reads are loaded in Discord. `require()` looks once, at that moment, and does not wait,
     * so `start` awaits this before anything reads them (at `domReady` Discord's modules may not have run yet). Rejects, naming the finder, after the
     * engine's timeout.
     */
    ready(): Promise<void>;
}

/**
 * The Discord pieces of AutoRedeem, asked from `ctx`.
 *
 * Required ones (REST client, the stores the queue reads) throw the engine's `FinderError` when read and not found, like an unresolved lazy finder did.
 * Optional ones degrade instead of throwing, in the direction that does the least harm:
 * - no `MessageActions`: instant-mode warmup does nothing (the original already checked `typeof MessageActions.fetchMessages !== "function"`);
 * - no `PermissionStore`/`PermissionsBits`: guild channels count as not readable, so warmup never fetches a channel it cannot prove it may read;
 * - no `IconUtils`: no avatar in the webhook embed; no `NavigationRouter`: clicking a notification does nothing.
 */
export function createDeps(ctx: EnginePluginContext): AutoRedeemDeps {
    const { common, finders } = ctx;
    const restApi = finders.byProps<RestApiLike>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
    const messageActions = finders.byProps<MessageActionsLike>("fetchMessages", "sendMessage");
    const iconUtils = finders.byProps<IconUtilsLike>("getGuildBannerURL", "getUserAvatarURL");
    const navigationRouter = finders.byProps<NavigationRouterLike>("transitionTo", "replaceWith", "transitionToGuild");
    const permissionStore = common.PermissionStore;
    const permissionsBits = finders.byProps<PermissionsBitsLike>("ADMINISTRATOR", "VIEW_CHANNEL", "READ_MESSAGE_HISTORY");

    // The common stores are typed with the few methods most plugins use; AutoRedeem needs more, so the store types are narrowed here, in one place.
    const required = <T>(read: () => unknown) => {
        let value: T | undefined;
        return () => (value ??= read() as T);
    };
    const userStore = required<UserStoreLike>(() => common.UserStore.require());
    const channelStore = required<ChannelStoreLike>(() => common.ChannelStore.require());
    const guildStore = required<GuildStoreLike>(() => common.GuildStore.require());
    const selectedChannelStore = required<SelectedChannelStoreLike>(() => common.SelectedChannelStore.require());
    const messageStore = required<MessageStoreLike>(() => common.MessageStore.require());
    const rest = required<RestApiLike>(() => restApi.require());

    const deniedPermissions: PermissionStoreLike = { can: () => false };
    const noPermissionBits: PermissionsBitsLike = { VIEW_CHANNEL: 0n, READ_MESSAGE_HISTORY: 0n };
    const noIcons: IconUtilsLike = { getUserAvatarURL: () => undefined };
    const noRouter: NavigationRouterLike = { transitionTo: () => undefined };

    return {
        async ready() {
            await Promise.all([restApi.ready(), common.UserStore.ready(), common.ChannelStore.ready(), common.GuildStore.ready(), common.SelectedChannelStore.ready(), common.MessageStore.ready()]);
        },
        get RestAPI() { return rest(); },
        get UserStore() { return userStore(); },
        get ChannelStore() { return channelStore(); },
        get GuildStore() { return guildStore(); },
        get SelectedChannelStore() { return selectedChannelStore(); },
        get MessageStore() { return messageStore(); },
        // Both pieces are needed to judge a channel: with only one of them, nothing is readable (a missing permission bit would read as 0n and allow everything).
        get PermissionStore() { return permissionsBits.get() ? (permissionStore.get() as unknown as PermissionStoreLike | undefined) ?? deniedPermissions : deniedPermissions; },
        get PermissionsBits() { return permissionsBits.get() ?? noPermissionBits; },
        get MessageActions() { return messageActions.get() ?? {}; },
        get IconUtils() { return iconUtils.get() ?? noIcons; },
        get NavigationRouter() { return navigationRouter.get() ?? noRouter; }
    };
}
