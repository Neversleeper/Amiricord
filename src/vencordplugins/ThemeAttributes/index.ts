/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ThemeAttributes (authors Ven, Board) as found in TestCord's copy of Vencord's plugins. Same four patches and same attributes. The current person is read from Discord's user store, found by name when the plugin starts. The patches use the `#{intl::}` key notation. Not checked live.

import type { PluginCode } from "../../renderer/engine";

interface Author { id?: string; username?: string; }

let users: { get(): { getCurrentUser(): { id: string; } | undefined; } | undefined; } | undefined;

/** The CSS variables `--avatar-url-<size>` for an avatar address, one per size Discord serves. */
export function avatarStyles(src: string | null): Record<string, string> {
    if (typeof src !== "string" || src.startsWith("data:")) return {};
    return Object.fromEntries([128, 256, 512, 1024, 2048, 4096].map(size => [`--avatar-url-${size}`, `url(${src.replace(/\d+$/, String(size))})`]));
}

const plugin: PluginCode & { getAvatarStyles(src: string | null): Record<string, string>; getMessageProps(props: { message?: { author?: Author; }; }): Record<string, unknown>; } = {
    patches: [
        {
            // A data-tab-id on every tab bar item, for example in the User and Server settings sidebars
            find: ".tabBarRef",
            lazy: true,
            required: false,
            replacements: [{ match: /style:this\.getStyle\(\),role:\i/, replace: "$&,'data-tab-id':this?.props?.id" }]
        },
        {
            // data-author-id and data-is-self on every message
            find: "Message must not be a thread starter message",
            lazy: true,
            required: false,
            replacements: [{ match: /"aria-setsize":-1,(?=.{0,150}?#{intl::MESSAGE_A11Y_ROLE_DESCRIPTION})/, replace: "...$self.getMessageProps(arguments[0]),$&" }]
        },
        {
            // --avatar-url-<size> on avatar pictures: profile popouts
            find: "#{intl::LABEL_WITH_ONLINE_STATUS}",
            lazy: true,
            required: false,
            replacements: [{ match: /src:(\i)\?\?void 0.{1,50}"aria-hidden":!0/, replace: "$&,style:$self.getAvatarStyles($1)" }]
        },
        {
            // ... and chat avatars
            find: "showCommunicationDisabledStyles",
            lazy: true,
            required: false,
            replacements: [{ match: /src:(\i),"aria-hidden":!0/, replace: "$&,style:$self.getAvatarStyles($1)" }]
        }
    ],

    start(ctx) {
        users = ctx.common.UserStore;
    },
    stop() {
        users = undefined;
    },

    getAvatarStyles(src) {
        return avatarStyles(src);
    },

    getMessageProps(props) {
        try {
            const author = props.message?.author;
            const authorId = author?.id;
            return {
                "data-author-id": authorId,
                "data-author-username": author?.username,
                "data-is-self": authorId && authorId === users?.get()?.getCurrentUser()?.id
            };
        } catch {
            return {};
        }
    }
};

export default plugin;
