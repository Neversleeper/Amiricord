/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ExportMessages (author Equicord contributors) as found in Equicord's copy of Vencord's plugins. Same text format for one message (time, name, text, attachment links, embed titles). The command is new in this port and saves up to 500 of the latest messages read from Discord; the original's friends-list export is not ported. The file is made in the page and saved through the browser's download, so the app may ask where to put it.

import { messageFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

export interface ExportedMessage {
    id: string;
    timestamp: string | number | Date;
    content?: string;
    author?: { username?: string; discriminator?: string; };
    attachments?: Array<{ filename: string; url: string; }>;
    embeds?: Array<{ rawTitle?: string; title?: string; rawDescription?: string; description?: string; url?: string; }>;
}

/** One message as text lines. */
export function formatMessage(message: ExportedMessage): string {
    const author = message.author ?? {};
    const when = new Date(message.timestamp.toString()).toLocaleString();
    let text = `[${when}] ${author.username ?? "unknown"}`;
    if (author.discriminator && author.discriminator !== "0") text += `#${author.discriminator}`;
    text += `: ${message.content ?? ""}`;
    if (message.attachments?.length) {
        text += "\n  Attachments:";
        for (const attachment of message.attachments) text += `\n    - ${attachment.filename} (${attachment.url})`;
    }
    if (message.embeds?.length) {
        text += "\n  Embeds:";
        for (const embed of message.embeds) {
            const title = embed.rawTitle ?? embed.title;
            const description = embed.rawDescription ?? embed.description;
            if (title) text += `\n    Title: ${title}`;
            if (description) text += `\n    Description: ${description}`;
            if (embed.url) text += `\n    URL: ${embed.url}`;
        }
    }
    return text;
}

export const MAX_EXPORT = 500;
const PAGE = 100;

function save(filename: string, text: string): void {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}

interface Rest { get(request: { url: string; query?: Record<string, unknown>; }): Promise<{ body: ExportedMessage[]; }>; }

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const selected = ctx.common.SelectedChannelStore;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        ctx.menuItems.add("export-message", click => {
            const ref = messageFromTarget(click.target);
            if (!ref) return null;
            return {
                label: "Export Message",
                action: () => {
                    const message = (messages.get() as unknown as { getMessage(channel: string, id: string): ExportedMessage | undefined; } | undefined)?.getMessage(ref.channelId, ref.messageId);
                    if (!message) { ctx.toasts.show("That message could not be read.", "failure"); return; }
                    save(`message-${message.id}-${new Date(message.timestamp.toString()).toISOString().split("T")[0]}.txt`, formatMessage(message));
                    ctx.toasts.show("Message exported.", "success");
                }
            };
        });
        ctx.commands.add({
            name: "exportchannel",
            description: "Save the latest messages of this channel as a text file",
            options: [{ name: "count", description: `How many messages (up to ${MAX_EXPORT})`, type: "integer" }],
            async execute(args) {
                const channel = selected.get()?.getChannelId();
                if (!channel) { ctx.toasts.show("Open a channel first.", "failure"); return; }
                const wanted = Math.max(1, Math.min(MAX_EXPORT, Number(args.find(arg => arg.name === "count")?.value ?? 100)));
                const all: ExportedMessage[] = [];
                let before: string | undefined;
                try {
                    while (all.length < wanted) {
                        const response = await rest.get()?.get({ url: `/channels/${channel}/messages`, query: { limit: Math.min(PAGE, wanted - all.length), ...(before ? { before } : {}) } });
                        const page = response?.body ?? [];
                        if (page.length === 0) break;
                        all.push(...page);
                        before = page[page.length - 1].id;
                        if (page.length < PAGE) break;
                    }
                } catch (error) {
                    ctx.reportError("ExportMessages", error);
                    ctx.toasts.show("Could not read the messages.", "failure");
                    return;
                }
                save(`channel-${channel}-${new Date().toISOString().split("T")[0]}.txt`, all.reverse().map(formatMessage).join("\n\n"));
                ctx.toasts.show(`Exported ${all.length} messages.`, "success");
            }
        });
    }
};

export default plugin;
