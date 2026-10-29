/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CopyUserMention (authors Cortex and castdrian) as found in Equicord. Adds "Copy User Mention" to the right-click menu of a
// person; it puts `<@id>` on the clipboard. Written against Amiricord's own right-click menu (`ctx.menuItems`), NOT verified in a real Discord:
//  - the person is found from what was right-clicked (an element with the id in `data-user-id` or `data-author-id`, a list item id that ends in the id, or a picture from
//    Discord's avatar address), the same way SaveUserGifs does it; the original got the user from Discord's own menu. When nothing in the clicked place says who the
//    person is, the item does not show;
//  - the item is added at the end of the menu, without the icon of the original.

import type { PluginCode } from "../../renderer/engine";

const SNOWFLAKE = /^\d{15,25}$/;

/** The id of the person whose name, picture or list entry was clicked, or undefined. Looks at the clicked element and the ones around it. */
export function userIdFromTarget(target: unknown): string | undefined {
    let element = target as { getAttribute?(name: string): string | null; parentElement?: unknown; src?: unknown; } | null | undefined;
    for (let level = 0; element && level < 8; level++) {
        for (const value of [element.getAttribute?.("data-user-id"), element.getAttribute?.("data-author-id")]) if (typeof value === "string" && SNOWFLAKE.test(value)) return value;
        const listId = element.getAttribute?.("data-list-item-id");
        const fromList = typeof listId === "string" ? /___(\d{15,25})$/.exec(listId)?.[1] : undefined;
        if (fromList) return fromList;
        const fromPicture = typeof element.src === "string" ? /\/(?:avatars|users)\/(\d{15,25})\//.exec(element.src)?.[1] : undefined;
        if (fromPicture) return fromPicture;
        element = element.parentElement as typeof element;
    }
    return undefined;
}

export const mentionOf = (id: string) => `<@${id}>`;

const plugin: PluginCode = {
    start(ctx) {
        ctx.menuItems.add("copy-user-mention", click => {
            const id = userIdFromTarget(click.target);
            if (!id) return null;
            return {
                label: "Copy User Mention",
                action: async () => {
                    try {
                        await navigator.clipboard.writeText(mentionOf(id));
                        ctx.toasts.show("Mention copied!", "success");
                    } catch (error) {
                        ctx.reportError("CopyUserMention", error);
                        ctx.toasts.show("Could not copy the mention", "failure");
                    }
                }
            };
        });
    }
};

export default plugin;
