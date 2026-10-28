/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the Badges plugin's two sides share: the list of custom badges the owners keep in the repository (`badges/badges.json`), the check of every field in it
// (it comes from the network), and the invisible mark that says "this person uses Amiricord". Plain data and small functions, so both are tested without Discord.
// Badges are drawn only on the screen of someone who runs Amiricord; Discord has no idea of them (docs/analysis-03-badges.md).

/** The invisible mark kept at the end of a person's pronouns: a zero-width non-joiner and a word joiner. It is not TestCord's (a zero-width space), so the two mods do not mistake each other. */
export const MARKER = "‌⁠";
/** Discord's limit for pronouns. */
export const MAX_PRONOUNS = 40;

export const hasMarker = (pronouns: unknown): boolean => typeof pronouns === "string" && pronouns.includes(MARKER);

/** The pronouns with the mark added, or null when they would be longer than Discord allows. Pronouns that already carry the mark come back as they are. */
export function withMarker(pronouns: string): string | null {
    if (hasMarker(pronouns)) return pronouns;
    return pronouns.length + MARKER.length <= MAX_PRONOUNS ? pronouns + MARKER : null;
}

export const withoutMarker = (pronouns: string): string => pronouns.split(MARKER).join("");

export const MAX_BADGE_LIST_BYTES = 256 * 1024;
export const MAX_ICON_BYTES = 150 * 1024;
export const MAX_BADGES = 60;
export const MAX_USERS = 2000;
export const MAX_BADGES_PER_USER = 6;

/** An icon file name inside `badges/icons/`: a plain name and one of the picture types below. Nothing with a slash, a dot-dot or a query. */
export const ICON_FILE = /^[A-Za-z0-9_-]{1,40}\.(png|webp|gif|jpg|svg)$/;
export const ICON_TYPES: Record<string, string> = { png: "image/png", webp: "image/webp", gif: "image/gif", jpg: "image/jpeg", svg: "image/svg+xml" };

const KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const USER_ID = /^\d{15,25}$/;

export interface BadgeDefinition {
    /** The text shown when the pointer is over the badge. */
    tooltip: string;
    /** A file in `badges/icons/`. */
    icon: string;
}

export interface BadgeList {
    badges: Record<string, BadgeDefinition>;
    /** Discord user id -> the keys of the badges that person has, in the order they are shown. */
    users: Record<string, string[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const clean = (value: unknown, limit: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit) : "");

/** The icon file name of a definition, or null when it is not a name this plugin accepts. */
export const iconTypeOf = (file: string): string | null => (ICON_FILE.test(file) ? ICON_TYPES[file.slice(file.lastIndexOf(".") + 1)] : null);

/**
 * The list rebuilt with only the known fields, or a sentence saying what is wrong. A badge that is not valid is dropped, and so is any person's reference to it,
 * so one bad line does not take the others with it; only a file that is not a list at all is refused.
 */
export function parseBadgeList(value: unknown): BadgeList | string {
    if (!isRecord(value)) return "the badge list is not in the expected form";
    if (value.schema !== 1) return "the badge list is of a kind this version does not know";
    const badges: Record<string, BadgeDefinition> = Object.create(null);
    const rawBadges = isRecord(value.badges) ? value.badges : {};
    for (const key of Object.keys(rawBadges).slice(0, MAX_BADGES)) {
        const entry = rawBadges[key];
        if (!KEY.test(key) || !isRecord(entry) || typeof entry.icon !== "string" || iconTypeOf(entry.icon) === null) continue;
        const tooltip = clean(entry.tooltip, 60);
        if (tooltip !== "") badges[key] = { tooltip, icon: entry.icon };
    }
    const users: Record<string, string[]> = Object.create(null);
    const rawUsers = isRecord(value.users) ? value.users : {};
    for (const id of Object.keys(rawUsers).slice(0, MAX_USERS)) {
        const keys = rawUsers[id];
        if (!USER_ID.test(id) || !Array.isArray(keys)) continue;
        const known = [...new Set(keys.filter((key): key is string => typeof key === "string" && key in badges))].slice(0, MAX_BADGES_PER_USER);
        if (known.length > 0) users[id] = known;
    }
    return { badges, users };
}

/** The icon files a list needs, each once: only those a person actually has, so an unused badge costs no download. */
export function iconsNeeded(list: BadgeList): string[] {
    const keys = new Set(Object.values(list.users).flat());
    return [...new Set([...keys].map(key => list.badges[key].icon))];
}

export const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
export const MAX_REGISTRY_IDS = 200_000;

/** The registry's answer (one Discord id per line) as a list of ids. Anything that is not an id is dropped, and so is everything past the limit. */
export function parseRegistry(text: string): string[] {
    const ids = new Set<string>();
    for (const line of text.split("\n")) {
        const id = line.trim();
        if (USER_ID.test(id)) ids.add(id);
        if (ids.size >= MAX_REGISTRY_IDS) break;
    }
    return [...ids];
}
