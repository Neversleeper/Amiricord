/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The invisible mark in the person's pronouns that tells other Amiricord users "this person uses Amiricord". This is the one place where Amiricord writes to the
// account by itself (docs/decisions.md, 2026-10-29): it is on by default, shows as "Writes to your account" on the plugin's card, and the switch in the plugin's
// settings takes the mark off again. It uses Discord's own profile request, the same one the profile editor sends, and only when the mark has to change.

import { hasMarker, withMarker, withoutMarker } from "../../shared/badgeList";

export interface RestLike {
    get(request: { url: string; }): Promise<{ body?: unknown; text?: unknown; }>;
    patch?(request: { url: string; body: unknown; }): Promise<unknown>;
}

/** "lost" means Discord took the request but the pronouns it keeps do not carry the mark (it stripped it). */
export type MarkerResult = "added" | "removed" | "unchanged" | "too-long" | "no-patch" | "lost";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The pronouns in the answer to a profile request: Discord nests them under `user_profile`, and older answers had them at the top. */
export function pronounsIn(body: unknown): string {
    if (!isRecord(body)) return "";
    const nested = isRecord(body.user_profile) ? body.user_profile.pronouns : undefined;
    const value = nested ?? body.pronouns;
    return typeof value === "string" ? value : "";
}

/** What an answer holds: Discord's request client leaves `body` null for some answers and keeps the JSON in `text`. */
export function bodyOf(answer: { body?: unknown; text?: unknown; } | undefined): unknown {
    if (!answer) return undefined;
    if (isRecord(answer.body)) return answer.body;
    if (typeof answer.text !== "string") return answer.body;
    try {
        return JSON.parse(answer.text) as unknown;
    } catch {
        return answer.body;
    }
}

/** Make the person's pronouns carry the mark (`wanted`) or not. Reads the profile first and writes only when something has to change. */
export async function syncMarker(rest: RestLike, userId: string, wanted: boolean): Promise<MarkerResult> {
    const current = pronounsIn(bodyOf(await rest.get({ url: `/users/${userId}/profile` })));
    if (wanted === hasMarker(current)) return "unchanged";
    const next = wanted ? withMarker(current) : withoutMarker(current);
    if (next === null) return "too-long";
    if (!rest.patch) return "no-patch";
    await rest.patch({ url: "/users/@me/profile", body: { pronouns: next } });
    // Read it back: what counts is what Discord keeps, not what it accepted.
    const kept = hasMarker(pronounsIn(bodyOf(await rest.get({ url: `/users/${userId}/profile` }))));
    if (wanted && !kept) return "lost";
    return wanted ? "added" : "removed";
}
