/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Written for Amiricord (2026) with the new `ctx.memberDecor`: shows how old each person's account is, next to the name in the member list ("9y", "3mo", "12d"), and the
// exact date when the pointer is over it. It is read from the person's id (an id carries the moment it was made), so nothing is asked of any server. A new account is easy to
// see: a number of days is shown in red up to the limit in the settings. Seen live? See the owner's log: the first plugin that uses `ctx.memberDecor`.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    newAccountDays: { type: "number", default: 30, min: 0, max: 365, integer: true, description: "Mark accounts younger than this many days (0 marks none)" }
});

const DISCORD_EPOCH = 1420070400000n;
const DAY = 86400000;

/** The moment an id was made, in milliseconds since 1970. */
export function createdAt(id: string): number {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/** A short age: "12d" under 60 days, "8mo" under two years, otherwise "3y". */
export function shortAge(created: number, now: number): string {
    const days = Math.max(0, Math.floor((now - created) / DAY));
    if (days < 60) return `${days}d`;
    if (days < 730) return `${Math.floor(days / 30)}mo`;
    return `${Math.floor(days / 365)}y`;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const text = (user: { id: string; }): string | undefined => {
            try {
                const created = createdAt(user.id);
                const age = shortAge(created, Date.now());
                const limit = settings.store.newAccountDays;
                return limit > 0 && Date.now() - created < limit * DAY ? `${age} new` : age;
            } catch {
                return undefined;
            }
        };
        const title = (user: { id: string; }): string | undefined => {
            try { return `Account created ${new Date(createdAt(user.id)).toLocaleDateString()}`; } catch { return undefined; }
        };
        ctx.memberDecor.add({ id: "account-age", text, title });
    }
};

export default plugin;
