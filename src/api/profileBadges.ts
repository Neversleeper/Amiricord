/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Badges a plugin adds to a person's profile (the card and the popout): `ctx.profileBadges.add({ id, badge: userId => ({ description, iconSrc }) })`.
// This is what Vencord's `addProfileBadge` is used for; written from scratch for Amiricord. The core plugin Badges patches the profile's `getBadges` (it already does for its own
// badges) and asks this hub for the rest, so Discord draws them like its own: the picture is the badge's `iconSrc` and the hover text its `description`. A plugin's badges go when it
// stops, and a provider that throws is skipped (and written in the plugin's health report) so it cannot break the profile. No permission is needed: a badge is drawn from what the
// profile already has (the person's id). Not tried in a real Discord until the first plugin used it.

export const MAX_PROFILE_BADGES_PER_PLUGIN = 3;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/i;
const MAX_TEXT_CHARS = 120;

export interface ProfileBadgeInfo {
    /** The hover text. */
    description: string;
    /** The picture: a data address or a link Discord may show. */
    iconSrc: string;
}

/** What a plugin gives for one badge. */
export interface ProfileBadgeProvider {
    /** 1 to 32 letters, digits or dashes. */
    id: string;
    /** The badge for this person, or undefined when the person gets none. */
    badge(userId: string): ProfileBadgeInfo | undefined;
}

export interface PluginProfileBadges {
    /** Add a badge provider. Returns false when it is refused (a bad id, a repeated id, more than three). It goes by itself when the plugin stops. */
    add(provider: ProfileBadgeProvider): boolean;
}

/** A badge as the profile lists it. */
export interface ListedBadge { id: string; description: string; iconSrc: string; }

interface Entry { plugin: string; provider: ProfileBadgeProvider; }

export interface ProfileBadgeHub {
    add(plugin: string, provider: ProfileBadgeProvider): boolean;
    removeAll(plugin: string): void;
    /** The badges for this person, in the order the providers were added. */
    forUser(userId: string, onError?: (plugin: string, error: unknown) => void): ListedBadge[];
}

export function createProfileBadgeHub(): ProfileBadgeHub {
    let entries: Entry[] = [];
    return {
        add(plugin, provider) {
            if (typeof provider?.id !== "string" || !KEY_PATTERN.test(provider.id) || typeof provider.badge !== "function") return false;
            if (entries.some(entry => entry.plugin === plugin && entry.provider.id === provider.id)) return false;
            if (entries.filter(entry => entry.plugin === plugin).length >= MAX_PROFILE_BADGES_PER_PLUGIN) return false;
            entries = [...entries, { plugin, provider }];
            return true;
        },
        removeAll(plugin) {
            entries = entries.filter(entry => entry.plugin !== plugin);
        },
        forUser(userId, onError) {
            const result: ListedBadge[] = [];
            for (const entry of entries) {
                try {
                    const info = entry.provider.badge(userId);
                    if (!info || typeof info.description !== "string" || typeof info.iconSrc !== "string" || info.iconSrc === "") continue;
                    result.push({ id: `${entry.plugin}_${entry.provider.id}`, description: info.description.slice(0, MAX_TEXT_CHARS), iconSrc: info.iconSrc });
                } catch (error) {
                    onError?.(entry.plugin, error);
                }
            }
            return result;
        }
    };
}

/** The hub the engine and the core plugin Badges share. */
export const profileBadges: ProfileBadgeHub = createProfileBadgeHub();

export function buildProfileBadges(hub: ProfileBadgeHub, plugin: string, onDispose: (callback: () => void) => void): PluginProfileBadges {
    onDispose(() => { hub.removeAll(plugin); });
    return { add: provider => hub.add(plugin, provider) };
}
