/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin PlatformIndicators (authors Kyuuhachi, TheSun) as found in TestCord's copy of Vencord's plugins. The original draws coloured icons in the member list, the profile and messages; here only next to the name in messages, as small text marks (🖥 desktop, 📱 mobile, 🌐 web, 🎮 console), read from Discord's presence store. Bots are skipped unless you turn them on. Not seen with a real presence update.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showBots: { type: "boolean", default: false, description: "Show the marks on bots too" }
});

const MARKS: Array<[string, string, string]> = [["desktop", "🖥", "Desktop"], ["mobile", "📱", "Mobile"], ["web", "🌐", "Web"], ["embedded", "🎮", "Console"]];

/** The marks for a presence's client status ({ desktop: "online", mobile: "idle" ... }); offline clients are left out. */
export function platformMarks(status: Record<string, string | undefined> | undefined): { text: string; title: string; } | undefined {
    if (!status) return undefined;
    const found = MARKS.filter(([key]) => status[key] !== undefined && status[key] !== "offline");
    if (found.length === 0) return undefined;
    return { text: found.map(([, mark]) => mark).join(" "), title: found.map(([, , name]) => name).join(", ") };
}

interface Messages { getMessage(channel: string, id: string): { author?: { id: string; bot?: boolean; }; } | undefined; }
interface Presence { getState?(): unknown; getClientStatus?(id: string): Record<string, string | undefined> | undefined; }

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const presence = ctx.common.PresenceStore;
        const markOf = (channelId: string, messageId: string) => {
            const author = (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.author;
            if (!author || (author.bot && !settings.store.showBots)) return undefined;
            return platformMarks((presence.get() as unknown as Presence | undefined)?.getClientStatus?.(author.id));
        };
        ctx.messageDecor.add({
            id: "platform",
            placement: "after-name",
            text: ({ channelId, messageId }) => markOf(channelId, messageId)?.text,
            title: ({ channelId, messageId }) => markOf(channelId, messageId)?.title
        });
    }
};

export default plugin;
