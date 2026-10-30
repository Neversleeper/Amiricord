/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SplitLargeMessages (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. The original catches a message that is too long when you press send; the engine cannot cancel a send, so the long text is given to the command instead. Pieces are cut at line breaks, spaces or strictly by length (a setting) and sent through Discord's own send function, one every few seconds (a setting, and never faster than the channel's slowmode). The limit is 2000 characters, or 4000 if the account has Nitro (read from the account). Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    delay: { type: "number", default: 1.5, min: 0.5, max: 10, description: "Seconds between pieces" },
    mode: { type: "select", default: "newlines", description: "Where to cut", options: [{ label: "Line breaks", value: "newlines" }, { label: "Spaces", value: "spaces" }, { label: "Strictly by length", value: "characters" }] }
});

export type SplitMode = "characters" | "spaces" | "newlines";

/** The text cut into pieces of at most `limit` characters, at the boundary of `mode` when there is one. */
export function splitMessage(content: string, limit: number, mode: SplitMode): string[] {
    if (limit < 1) return [];
    const chunks: string[] = [];
    let rest = content;
    while (rest.length > limit) {
        let index = limit;
        if (mode !== "characters") {
            const boundary = mode === "newlines" ? "\n" : " ";
            const at = rest.lastIndexOf(boundary, limit - 1);
            const space = rest.lastIndexOf(" ", limit - 1);
            if (at > 0) index = at + 1;
            else if (mode === "newlines" && space > 0) index = space + 1;
        }
        chunks.push(rest.slice(0, index));
        rest = rest.slice(index);
    }
    if (rest) chunks.push(rest);
    return chunks;
}

interface Actions { sendMessage(channelId: string, message: { content: string; }, waitForChannelReady?: boolean): Promise<unknown>; }

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const actions = ctx.finders.byProps<Actions>("sendMessage", "editMessage", "deleteMessage");
        const selected = ctx.common.SelectedChannelStore;
        const users = ctx.common.UserStore;
        const channels = ctx.common.ChannelStore;
        ctx.commands.add({
            name: "split",
            description: "Send a long text in several messages",
            options: [{ name: "text", description: "The long text", required: true }],
            async execute(args) {
                const text = String(args.find(arg => arg.name === "text")?.value ?? "");
                const channelId = selected.get()?.getChannelId();
                const send = actions.get();
                if (!channelId || !send || !text.trim()) return;
                const nitro = (users.get()?.getCurrentUser() as { premiumType?: number; } | undefined)?.premiumType === 2;
                const slowmode = ((channels.get()?.getChannel(channelId) as { rateLimitPerUser?: number; } | undefined)?.rateLimitPerUser ?? 0) * 1000;
                const pause = Math.max(settings.store.delay * 1000, slowmode ? slowmode + 250 : 0);
                const chunks = splitMessage(text, nitro ? 4000 : 2000, settings.store.mode as SplitMode);
                let sent = 0;
                try {
                    for (const chunk of chunks) {
                        await send.sendMessage(channelId, { content: chunk }, true);
                        sent++;
                        if (sent < chunks.length) await new Promise(resolve => setTimeout(resolve, pause));
                    }
                } catch (error) {
                    ctx.reportError("SplitLargeMessages", error);
                    ctx.toasts.show(`Stopped after ${sent} of ${chunks.length} pieces.`, "failure");
                }
            }
        });
    }
};

export default plugin;
