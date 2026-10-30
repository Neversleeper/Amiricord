/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What was right-clicked, found from the page itself: the menu items of `ctx.menuItems` get the clicked element, and these read from it who or what it is. Discord's own
// menus know this from their React props; Amiricord's menu is built from the page, so it looks at the element and the ones around it. Reads names Discord puts in the
// page (`chat-messages-<channel>-<message>` on a message, `data-user-id`, `data-list-item-id="guildsnav___<id>"`...). Checked on Discord build 655747 for messages
// and server icons; a place Discord does not label gives nothing, and the plugin then adds no item.

const ID = String.raw`\d{15,25}`;
const SNOWFLAKE = new RegExp(`^${ID}$`);
const LEVELS = 10;

interface ElementLike {
    getAttribute?(name: string): string | null;
    parentElement?: unknown;
    src?: unknown;
    id?: unknown;
}

/** The clicked element and the ones above it, nearest first. */
function chain(target: unknown): ElementLike[] {
    const out: ElementLike[] = [];
    let element = target as ElementLike | null | undefined;
    for (let level = 0; element && level < LEVELS; level++) {
        out.push(element);
        element = element.parentElement as ElementLike | null | undefined;
    }
    return out;
}

const attribute = (element: ElementLike, name: string): string | undefined => {
    const value = element.getAttribute?.(name);
    return typeof value === "string" ? value : undefined;
};

/** The id of the person whose name, picture or list entry was clicked. */
export function userIdFromTarget(target: unknown): string | undefined {
    for (const element of chain(target)) {
        for (const name of ["data-user-id", "data-author-id"]) {
            const value = attribute(element, name);
            if (value !== undefined && SNOWFLAKE.test(value)) return value;
        }
        const fromList = new RegExp(`___(${ID})$`).exec(attribute(element, "data-list-item-id") ?? "")?.[1];
        if (fromList) return fromList;
        const fromPicture = typeof element.src === "string" ? new RegExp(`/(?:avatars|users)/(${ID})/`).exec(element.src)?.[1] : undefined;
        if (fromPicture) return fromPicture;
    }
    return undefined;
}

export interface MessageRef { channelId: string; messageId: string; }

/** The channel and message of the message that was clicked. */
export function messageFromTarget(target: unknown): MessageRef | undefined {
    for (const element of chain(target)) {
        const found = new RegExp(`^chat-messages-(?:\\d+-)?(${ID})-(${ID})$`).exec(typeof element.id === "string" ? element.id : "");
        if (found) return { channelId: found[1], messageId: found[2] };
    }
    return undefined;
}

/** The id of the server whose icon in the server list was clicked. */
export function guildIdFromTarget(target: unknown): string | undefined {
    for (const element of chain(target)) {
        const found = new RegExp(`^guildsnav___(${ID})$`).exec(attribute(element, "data-list-item-id") ?? "");
        if (found) return found[1];
    }
    return undefined;
}

/** The id of the channel whose entry in the channel list was clicked. */
export function channelIdFromTarget(target: unknown): string | undefined {
    for (const element of chain(target)) {
        const found = new RegExp(`^channels___(${ID})$`).exec(attribute(element, "data-list-item-id") ?? "");
        if (found) return found[1];
    }
    return undefined;
}
