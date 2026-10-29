/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and menu pieces have no types */

// Adapted for Amiricord (2026) from the plugin CancelFriendRequest (author omaw) of Equicord. Differences from the original: the original also patched the "Add friend" button of
// a profile and the friends list through texts of Discord's translations (`#{intl::...}`), which Amiricord's patcher cannot look for; here the only entry is in the right-click menu
// of a user (`user-context`, Vencord's name; it is NOT in the readable part of Discord's build, so if the entry never shows, that is the first place to look).
// Not tried in a real Discord at the time of writing.

import type { PluginCode } from "../../renderer/engine";

/** Discord's number for "a request you sent". */
export const OUTGOING_REQUEST = 4;

// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
let relationships: { get(): any; } | undefined;
let actions: { get(): any; } | undefined;

const plugin: PluginCode = {
    start(ctx) {
        relationships = ctx.common.RelationshipStore;
        actions = ctx.finders.byProps("cancelFriendRequest", "addRelationship");
        ctx.contextMenu.addNative("user-context", (children, props) => {
            const user = (props as { user?: any; } | undefined)?.user;
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!user?.id || !parts || !react || relationships?.get()?.getRelationshipType?.(user.id) !== OUTGOING_REQUEST) return;
            children.push(react.createElement(parts.MenuItem as any, {
                id: "cancel-outgoing-friend-request",
                key: "cancel-outgoing-friend-request",
                label: "Cancel Outgoing Friend Request",
                action: () => {
                    if (relationships?.get()?.getRelationshipType?.(user.id) === OUTGOING_REQUEST) actions?.get()?.cancelFriendRequest?.(user.id);
                }
            }));
        });
    },

    stop() {
        relationships = actions = undefined;
    }
};

export default plugin;
