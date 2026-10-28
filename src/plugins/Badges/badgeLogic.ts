/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which badges a profile gets. Pure: the profile, the list the main process read and the owners' ids go in, and a list of badges in Discord's own shape comes out
// (an id, a text and a picture; Discord draws any badge that has an `iconSrc`).

import { hasMarker } from "../../shared/badgeList";
import { OWNER_ICON, USER_ICON } from "./art";
import type { LoadedList } from "./native";

export interface ProfileBadge {
    id: string;
    description: string;
    iconSrc: string;
}

export interface BadgeProfile {
    userId?: unknown;
    pronouns?: unknown;
}

export interface BadgeSources {
    /** Discord ids of the project's owners. */
    owners: ReadonlySet<string>;
    /** The owners' list as the main process last read it, or null when there is none (yet, or the repository could not be reached). */
    list: LoadedList | null;
    /** The ids the registry says use Amiricord, or null when it has not been read (yet, or it could not be reached). */
    registered?: ReadonlySet<string> | null;
    /** Whether a profile that uses Amiricord (in the registry, or carrying the mark in its pronouns) gets the user badge. */
    showUsers: boolean;
}

/** The badges of one profile, in the order they are shown: owner, the ones from the list, then "uses Amiricord". Never throws; a profile it cannot read gets none. */
export function badgesOf(profile: BadgeProfile | null | undefined, sources: BadgeSources): ProfileBadge[] {
    const userId = typeof profile?.userId === "string" ? profile.userId : null;
    if (userId === null) return [];
    const result: ProfileBadge[] = [];
    if (sources.owners.has(userId)) result.push({ id: "amiricord_owner", description: "Amiricord Owner", iconSrc: OWNER_ICON });
    for (const key of sources.list?.users[userId] ?? []) {
        const badge = sources.list?.badges[key];
        if (badge) result.push({ id: `amiricord_badge_${key}`, description: badge.tooltip, iconSrc: badge.src });
    }
    if (sources.showUsers && (sources.registered?.has(userId) === true || hasMarker(profile?.pronouns))) result.push({ id: "amiricord_user", description: "Amiricord User", iconSrc: USER_ICON });
    return result;
}
