/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CancelFriendRequest (author x2b) as found in TestCord. The original changes the disabled Outgoing Friend Request button in the profile; here it is a menu item that appears only for people you have a pending outgoing request to. It uses Discord's own remove-friend function, which also cancels a pending request.

import { userIdFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

/** Relationship type 4 is a request you sent. */
export const OUTGOING_REQUEST = 4;

const plugin: PluginCode = {
    start(ctx) {
        const relationships = ctx.common.RelationshipStore;
        const actions = ctx.finders.byProps<{ removeFriend(userId: string): unknown; }>("removeFriend", "sendFriendRequest");
        ctx.menuItems.add("cancel-friend-request", click => {
            const userId = userIdFromTarget(click.target);
            if (!userId || (relationships.get() as unknown as { getRelationshipType(id: string): number; } | undefined)?.getRelationshipType(userId) !== OUTGOING_REQUEST) return null;
            return {
                label: "Cancel friend request",
                action: () => {
                    try { actions.get()?.removeFriend(userId); ctx.toasts.show("Friend request cancelled.", "success"); } catch (error) { ctx.reportError("CancelFriendRequest", error); ctx.toasts.show("Could not cancel the request.", "failure"); }
                }
            };
        });
    }
};

export default plugin;
