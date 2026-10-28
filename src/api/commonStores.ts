/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's stores and event dispatcher by name, for plugins: `ctx.common.UserStore.ready()` instead of a finder written by hand each time.
// A name becomes a finder the first time it is read, so a plugin pays only for the names it uses. Design: docs/analysis-26-common.md.

import type { Finder } from "../webpack/finders";

/** The finders a plugin may ask for. The plugin's own finders back it, so a miss is recorded against that plugin. */
export interface CommonFinders {
    byProps<T = unknown>(...props: string[]): Finder<T>;
    byStore<T = unknown>(name: string): Finder<T>;
}

/** Shapes of the methods plugins call most. Not checked against a real Discord; a plugin that needs another method states its own type. */
export interface UserStoreLike { getCurrentUser(): { id: string; username?: string; } | undefined; getUser(id: string): { id: string; username?: string; } | undefined; }
export interface ChannelStoreLike { getChannel(id: string): { id: string; guild_id?: string; name?: string; } | undefined; }
export interface GuildStoreLike { getGuild(id: string): { id: string; name?: string; } | undefined; }
export interface SelectedChannelStoreLike { getChannelId(): string | undefined; getVoiceChannelId(): string | undefined; }
export interface SelectedGuildStoreLike { getGuildId(): string | undefined; }
export interface DispatcherLike {
    dispatch(event: { type: string; [key: string]: unknown; }): void;
    subscribe(type: string, callback: (event: unknown) => void): void;
    unsubscribe(type: string, callback: (event: unknown) => void): void;
}

/** Stores with no typed shape yet: their methods are `unknown` until a plugin says what it expects. */
export interface StoreLike { [method: string]: unknown; }

/** Property name -> Discord's store name. The names are Discord's own, as Vencord uses them. */
export const STORE_NAMES = [
    "UserStore", "ChannelStore", "GuildStore", "GuildMemberStore", "SelectedChannelStore", "SelectedGuildStore",
    "RelationshipStore", "PresenceStore", "MessageStore", "PermissionStore", "ReadStateStore", "VoiceStateStore"
] as const;

export type StoreName = typeof STORE_NAMES[number];

export interface PluginCommon {
    readonly UserStore: Finder<UserStoreLike>;
    readonly ChannelStore: Finder<ChannelStoreLike>;
    readonly GuildStore: Finder<GuildStoreLike>;
    readonly SelectedChannelStore: Finder<SelectedChannelStoreLike>;
    readonly SelectedGuildStore: Finder<SelectedGuildStoreLike>;
    readonly GuildMemberStore: Finder<StoreLike>;
    readonly RelationshipStore: Finder<StoreLike>;
    readonly PresenceStore: Finder<StoreLike>;
    readonly MessageStore: Finder<StoreLike>;
    readonly PermissionStore: Finder<StoreLike>;
    readonly ReadStateStore: Finder<StoreLike>;
    readonly VoiceStateStore: Finder<StoreLike>;
    readonly FluxDispatcher: Finder<DispatcherLike>;
}

export function buildCommon(finders: CommonFinders): PluginCommon {
    const common = {} as Record<string, unknown>;
    const define = (name: string, make: () => Finder<unknown>) => {
        let finder: Finder<unknown> | undefined;
        Object.defineProperty(common, name, { enumerable: true, get: () => (finder ??= make()) });
    };
    for (const name of STORE_NAMES) define(name, () => finders.byStore(name));
    define("FluxDispatcher", () => finders.byProps("dispatch", "subscribe"));
    return common as unknown as PluginCommon;
}
