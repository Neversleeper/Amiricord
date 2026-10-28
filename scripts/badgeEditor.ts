/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The edits `pnpm badges` makes to `badges/badges.json`, as functions from text to text so they are tested without touching a disk. Every result is checked by the
// same parser the program uses, so a list written here is one the program reads. The script (`badges.ts`) only reads and writes the files around them.

import { ICON_FILE, ICON_TYPES, parseBadgeList } from "../src/shared/badgeList";

export interface RawList {
    schema: 1;
    badges: Record<string, { tooltip: string; icon: string; }>;
    users: Record<string, string[]>;
}

export const EMPTY_LIST = `${JSON.stringify({ schema: 1, badges: {}, users: {} }, null, 4)}\n`;

const KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const USER_ID = /^\d{15,25}$/;

function read(text: string): RawList | string {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return "badges/badges.json is not valid JSON";
    }
    const parsed = parseBadgeList(value);
    if (typeof parsed === "string") return parsed;
    return { schema: 1, badges: { ...parsed.badges }, users: { ...parsed.users } };
}

function write(list: RawList): string {
    const sorted = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
    return `${JSON.stringify({ schema: 1, badges: sorted(list.badges), users: sorted(list.users) }, null, 4)}\n`;
}

/** The extension of a picture file name if it is one the program accepts (`png`, `webp`, `gif`, `jpg`, `svg`), else null. */
export function pictureExtension(fileName: string): string | null {
    const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
    return ext === "jpeg" ? "jpg" : ext in ICON_TYPES ? ext : null;
}

export type Edit = { text: string; message: string; } | { error: string; };

/** Add or change a badge: its key (letters, digits, - and _), its tooltip and the file name of its picture inside `badges/icons/`. */
export function defineBadge(text: string, key: string, tooltip: string, icon: string): Edit {
    const list = read(text);
    if (typeof list === "string") return { error: list };
    if (!KEY.test(key)) return { error: `"${key}" is not a good badge name: use lowercase letters, digits, - and _ (up to 32)` };
    if (tooltip.trim() === "" || tooltip.length > 60) return { error: "the text shown on the badge must be between 1 and 60 characters" };
    if (!ICON_FILE.test(icon)) return { error: `"${icon}" is not an accepted picture name (letters, digits, - and _, then .png, .webp, .gif, .jpg or .svg)` };
    const existed = key in list.badges;
    list.badges[key] = { tooltip: tooltip.trim(), icon };
    return { text: write(list), message: `${existed ? "Changed" : "Added"} the badge "${key}" (${tooltip.trim()}).` };
}

/** Give a person a badge (it must be defined). The person is a Discord user id: the long number you get with "Copy User ID". */
export function giveBadge(text: string, userId: string, key: string): Edit {
    const list = read(text);
    if (typeof list === "string") return { error: list };
    if (!USER_ID.test(userId)) return { error: `"${userId}" is not a Discord user id (15 to 25 digits; turn on Developer Mode, then right-click the person and choose Copy User ID)` };
    if (!(key in list.badges)) return { error: `there is no badge called "${key}"; define it first (known: ${Object.keys(list.badges).join(", ") || "none"})` };
    const current = list.users[userId] ?? [];
    if (current.includes(key)) return { error: `that person already has "${key}"` };
    list.users[userId] = [...current, key];
    return { text: write(list), message: `${userId} now has "${key}".` };
}

/** Take a badge away from a person. */
export function takeBadge(text: string, userId: string, key: string): Edit {
    const list = read(text);
    if (typeof list === "string") return { error: list };
    const current = list.users[userId] ?? [];
    if (!current.includes(key)) return { error: `${userId} does not have "${key}"` };
    const rest = current.filter(item => item !== key);
    if (rest.length > 0) list.users[userId] = rest;
    else delete list.users[userId];
    return { text: write(list), message: `${userId} no longer has "${key}".` };
}

/** Delete a badge and every person's copy of it. The caller removes the picture file named in `icon`. */
export function removeBadge(text: string, key: string): (Edit & { icon?: string; }) {
    const list = read(text);
    if (typeof list === "string") return { error: list };
    if (!(key in list.badges)) return { error: `there is no badge called "${key}"` };
    const { icon } = list.badges[key];
    delete list.badges[key];
    for (const id of Object.keys(list.users)) {
        const rest = list.users[id].filter(item => item !== key);
        if (rest.length > 0) list.users[id] = rest;
        else delete list.users[id];
    }
    const stillUsed = Object.values(list.badges).some(badge => badge.icon === icon);
    return { text: write(list), message: `Removed the badge "${key}" and everyone's copy of it.`, ...(stillUsed ? {} : { icon }) };
}

/** What `pnpm badges list` prints. */
export function describeList(text: string): string {
    const list = read(text);
    if (typeof list === "string") return list;
    const badgeLines = Object.entries(list.badges).map(([key, badge]) => `  ${key}: "${badge.tooltip}" (${badge.icon})`);
    const userLines = Object.entries(list.users).map(([id, keys]) => `  ${id}: ${keys.join(", ")}`);
    return [`Badges (${badgeLines.length}):`, ...(badgeLines.length ? badgeLines : ["  none"]), `People (${userLines.length}):`, ...(userLines.length ? userLines : ["  none"])].join("\n");
}
