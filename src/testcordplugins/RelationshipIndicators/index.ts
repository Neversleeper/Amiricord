/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RelationshipIndicators (author x2b) as found in TestCord. The original also draws icons in the member list and the profile; here only next to the name in messages (the engine's new message decoration), as text marks. Bots are skipped. Not seen in a real message list with a blocked person.

import type { PluginCode } from "../../renderer/engine";

const FRIEND = 1;
const BLOCKED = 2;

/** The mark for a kind of relationship, or nothing. */
export function relationshipMark(type: number | undefined): { text: string; title: string; } | undefined {
    if (type === FRIEND) return { text: "👥", title: "Friend" };
    if (type === BLOCKED) return { text: "🚫", title: "Blocked" };
    return undefined;
}

interface Messages { getMessage(channel: string, id: string): { author?: { id: string; bot?: boolean; }; } | undefined; }
interface Relationships { getRelationshipType(id: string): number; }

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const relationships = ctx.common.RelationshipStore;
        const markOf = (channelId: string, messageId: string) => {
            const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
            if (!author || author.bot) return undefined;
            return relationshipMark((relationships.get() as unknown as Relationships | undefined)?.getRelationshipType(author.id));
        };
        ctx.messageDecor.add({
            id: "relationship",
            placement: "after-name",
            text: ({ channelId, messageId }) => markOf(channelId, messageId)?.text,
            title: ({ channelId, messageId }) => markOf(channelId, messageId)?.title
        });
    }
};

export default plugin;
