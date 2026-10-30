/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ReactionLogger (author x2b) as found in TestCord. Same rules (your own messages only, your own reactions ignored by default, reactions grouped by emoji over a delay). The notice is the engine's own card inside Discord's window (`ctx.notifications`), not a desktop notification, and pressing it does not jump to the message.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    delay: { type: "number", default: 15, min: 1, max: 600, integer: true, description: "Seconds to wait before showing the notices (the lower, the more notices)" },
    ignoreSelf: { type: "boolean", default: true, description: "Do not log your own reactions" }
});

interface ReactionAdd { optimistic?: boolean; type?: string; messageId: string; channelId: string; userId: string; emoji: { name: string; }; }
interface Person { username?: string; id?: string; avatar?: string | null; }

let reactions: Record<string, Person[]> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let onAdd: ((event: ReactionAdd) => void) | undefined;

/** The text of one notice: how many reactions of an emoji, or who reacted. */
export function reactionBody(emoji: string, users: Array<{ username?: string; }>): string {
    return users.length > 1 ? `You received ${users.length} reactions of ${emoji}` : `${users[0]?.username ?? "Someone"} reacted with ${emoji} to your message`;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const users = ctx.common.UserStore;
        onAdd = ({ optimistic, type, messageId, channelId, userId, emoji }: ReactionAdd) => {
            if (type !== "MESSAGE_REACTION_ADD" && !optimistic) return;
            const me = users.get()?.getCurrentUser();
            const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { author: { id: string; }; } | undefined; } | undefined)?.getMessage(channelId, messageId);
            if (!me || !message || message.author.id !== me.id) return;
            if (settings.store.ignoreSelf && userId === me.id) return;
            const name = emoji.name.toLowerCase();
            reactions[name] = [...(reactions[name] ?? []), (users.get()?.getUser(userId) ?? { id: userId }) as Person];
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                for (const [emojiName, people] of Object.entries(reactions)) {
                    const first = people[0];
                    ctx.notifications.show({
                        title: "Reaction Logger",
                        body: reactionBody(emojiName, people),
                        icon: first?.id && first.avatar ? `https://cdn.discordapp.com/avatars/${first.id}/${first.avatar}.png?size=64` : undefined
                    });
                }
                reactions = {};
                timer = undefined;
            }, settings.store.delay * 1000);
        };
    },

    flux: {
        MESSAGE_REACTION_ADD(event: ReactionAdd) {
            onAdd?.(event);
        }
    },

    stop() {
        if (timer) clearTimeout(timer);
        timer = undefined;
        reactions = {};
        onAdd = undefined;
    }
};

export default plugin;
