/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin DeadMembers (author Kyuuhachi) as found in TestCord. Same patch and same two styles. The name is wrapped with a plain element; the membership is read from Discord's member store, found by name when the plugin starts. Not checked live.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    indicatorStyle: {
        type: "select", default: "strikethrough", description: "How to mark a member who left",
        options: [
            { label: "Strikethrough", value: "strikethrough" },
            { label: "Badge", value: "badge" }
        ]
    }
});

const CSS = `
.c98-author-dead {
    text-decoration: line-through;
    text-decoration-color: var(--status-danger);
    opacity: 0.6;
}

.c98-author-dead-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.c98-author-dead-badge::after {
    content: "✕";
    color: var(--status-danger);
    font-size: 10px;
    font-weight: 700;
    margin-left: 2px;
}
`;

interface Members { isMember(guildId: string, userId: string): boolean; }
interface Channels { getChannel(id: string): { guild_id?: string; } | undefined; }

let members: { get(): Members | undefined; } | undefined;
let channels: { get(): Channels | undefined; } | undefined;

const plugin: PluginCode & { wrapMessageAuthor(props: { message: { channel_id: string; webhookId?: string; author: { id: string; }; }; }, text: unknown): unknown; } = {
    settings,
    patches: [
        {
            find: "\"data-username-has-gradient\"",
            lazy: true,
            required: false,
            replacements: [{ match: /(?<=onContextMenu:\i,children:)(.{0,300}?)(?=,"data-text":)/, replace: "$self.wrapMessageAuthor(arguments[0],$&)" }]
        }
    ],

    start(ctx) {
        ctx.addStyle(CSS, "dead-members");
        members = ctx.common.GuildMemberStore as unknown as typeof members;
        channels = ctx.common.ChannelStore as typeof channels;
    },
    stop() {
        members = undefined;
        channels = undefined;
    },

    wrapMessageAuthor({ message }, text) {
        try {
            if (message.webhookId) return text;
            const guildId = channels?.get()?.getChannel(message.channel_id)?.guild_id;
            if (!guildId || members?.get()?.isMember(guildId, message.author.id) !== false) return text;
            const h = (currentReact() as unknown as { createElement(type: string, props: unknown, ...children: unknown[]): unknown; }).createElement;
            return settings.store.indicatorStyle === "badge" ? h("span", { className: "c98-author-dead-badge" }, text) : h("s", { className: "c98-author-dead" }, text);
        } catch {
            return text;
        }
    }
};

export default plugin;
