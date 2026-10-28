/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the plugin window shows for an author who has a Discord id in the manifest: the name Discord shows for that person now and the picture they use now
// (an animated one when it is a GIF). Pure; the lookup itself is in `index.tsx`, which asks Discord's own store and, only if the person is not there, Discord's own API.

/** What the window shows next to an author. */
export interface AuthorInfo {
    /** The name Discord shows for the person (display name, else user name). */
    displayName: string;
    username: string;
    /** The picture in use, or null when the person has none. */
    avatarUrl: string | null;
}

/** The parts of a Discord user the lookup needs. Both Discord's store and its API give these names (the API says `global_name`). */
export interface RawDiscordUser {
    id?: unknown;
    username?: unknown;
    globalName?: unknown;
    global_name?: unknown;
    avatar?: unknown;
}

const SNOWFLAKE = /^\d{15,25}$/;
const AVATAR_HASH = /^(a_)?[0-9a-f]{16,40}$/;

export const isDiscordId = (value: unknown): value is string => typeof value === "string" && SNOWFLAKE.test(value);

/** The address of a profile picture on Discord's own image host. A hash that starts with `a_` is an animated picture, so it is a GIF. */
export function avatarUrl(id: string, hash: unknown): string | null {
    if (!isDiscordId(id) || typeof hash !== "string" || !AVATAR_HASH.test(hash)) return null;
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=64`;
}

/** The author's information from what Discord gave, or null when it did not give a user name. */
export function authorInfo(id: string, user: RawDiscordUser | null | undefined): AuthorInfo | null {
    if (!user || typeof user.username !== "string" || user.username === "") return null;
    const global = typeof user.globalName === "string" && user.globalName !== "" ? user.globalName : typeof user.global_name === "string" && user.global_name !== "" ? user.global_name : "";
    return { displayName: global || user.username, username: user.username, avatarUrl: avatarUrl(id, user.avatar) };
}
