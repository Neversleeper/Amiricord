/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BetterJoinedDate (author x2b) as found in TestCord. The original adds a line to the profile; the profile is not open to plugins yet, so it is a menu item that shows a notice. The time comes from the person's id (Discord's ids carry the moment they were made), so nothing is asked from outside.

import { userIdFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

const DISCORD_EPOCH = 1420070400000n;

/** The moment an id was made, in milliseconds since 1970. */
export function idTimestamp(id: string): number {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/** "29/10/2026, 14:03:00 (Today)", "(Yesterday)" or "(12 days ago)". */
export function accountAge(id: string, now: number): string {
    const created = idTimestamp(id);
    const days = Math.floor((now - created) / 86400000);
    const when = days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
    return `${new Date(created).toLocaleString()} (${when})`;
}

const plugin: PluginCode = {
    start(ctx) {
        const users = ctx.common.UserStore;
        ctx.menuItems.add("account-created", click => {
            const userId = userIdFromTarget(click.target);
            if (!userId || !/^\d{15,25}$/.test(userId)) return null;
            return {
                label: "Account created",
                action: () => {
                    const user = users.get()?.getUser(userId) as { globalName?: string; username?: string; } | undefined;
                    ctx.notifications.show({ title: `${user?.globalName ?? user?.username ?? "Account"} was created`, body: accountAge(userId, Date.now()) });
                }
            };
        });
    }
};

export default plugin;
