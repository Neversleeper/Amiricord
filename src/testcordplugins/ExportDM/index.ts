/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ExportDM (author x2b) as found in TestCord. A smaller version of the original, which also downloads the pictures, videos and sounds and has more formats and filters. This one reads up to 1000 of the latest messages from Discord, writes their text, attachment links, embed titles and reactions in the format you choose, and saves the file through the browser's download. Nothing is sent anywhere else.

import type { PluginCode } from "../../renderer/engine";

export interface DmMessage {
    id: string;
    timestamp: string;
    content?: string;
    author?: { username?: string; global_name?: string | null; };
    attachments?: Array<{ filename: string; url: string; }>;
    embeds?: Array<{ title?: string; url?: string; }>;
    reactions?: Array<{ emoji: { name?: string | null; }; count: number; }>;
}

export const FORMATS = ["txt", "json", "csv", "md"] as const;
export type Format = typeof FORMATS[number];
export const MAX_EXPORT = 1000;

const nameOf = (message: DmMessage) => message.author?.global_name ?? message.author?.username ?? "unknown";
const quote = (text: string) => `"${text.replace(/"/g, "\"\"")}"`;

/** The messages (oldest first) as a file of the given format. */
export function formatMessages(messages: DmMessage[], format: Format): string {
    switch (format) {
        case "json": return JSON.stringify(messages.map(message => ({
            id: message.id, timestamp: message.timestamp, author: nameOf(message), content: message.content ?? "",
            attachments: (message.attachments ?? []).map(attachment => attachment.url), embeds: (message.embeds ?? []).map(embed => embed.title ?? embed.url ?? ""),
            reactions: (message.reactions ?? []).map(reaction => `${reaction.emoji.name ?? "?"} x${reaction.count}`)
        })), null, 2);
        case "csv": return ["id,timestamp,author,content,attachments", ...messages.map(message => [message.id, message.timestamp, quote(nameOf(message)), quote(message.content ?? ""), quote((message.attachments ?? []).map(attachment => attachment.url).join(" "))].join(","))].join("\n");
        case "md": return messages.map(message => `**${nameOf(message)}** (${new Date(message.timestamp).toLocaleString()})\n\n${message.content ?? ""}${(message.attachments ?? []).map(attachment => `\n\n[${attachment.filename}](${attachment.url})`).join("")}`).join("\n\n---\n\n");
        default: return messages.map(message => {
            let line = `[${new Date(message.timestamp).toLocaleString()}] ${nameOf(message)}: ${message.content ?? ""}`;
            for (const attachment of message.attachments ?? []) line += `\n  Attachment: ${attachment.filename} (${attachment.url})`;
            for (const embed of message.embeds ?? []) if (embed.title ?? embed.url) line += `\n  Embed: ${embed.title ?? embed.url}`;
            if (message.reactions?.length) line += `\n  Reactions: ${message.reactions.map(reaction => `${reaction.emoji.name ?? "?"} x${reaction.count}`).join(", ")}`;
            return line;
        }).join("\n\n");
    }
}

/** A format name from what was typed; "txt" when it is empty or unknown. */
export function parseFormat(text: string): Format {
    const found = text.trim().toLowerCase();
    return (FORMATS as readonly string[]).includes(found) ? found as Format : "txt";
}

function save(filename: string, text: string, type: string): void {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([text], { type }));
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}

interface Rest { get(request: { url: string; query?: Record<string, unknown>; }): Promise<{ body: DmMessage[]; }>; }

const plugin: PluginCode = {
    start(ctx) {
        const selected = ctx.common.SelectedChannelStore;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        ctx.commands.add({
            name: "exportdm",
            description: "Save the latest messages of this conversation as a file",
            options: [
                { name: "format", description: "txt, json, csv or md (txt when empty)" },
                { name: "count", description: `How many messages (up to ${MAX_EXPORT}, 200 when empty)`, type: "integer" }
            ],
            async execute(args) {
                const channel = selected.get()?.getChannelId();
                if (!channel) { ctx.toasts.show("Open a conversation first.", "failure"); return; }
                const format = parseFormat(String(args.find(arg => arg.name === "format")?.value ?? ""));
                const wanted = Math.max(1, Math.min(MAX_EXPORT, Number(args.find(arg => arg.name === "count")?.value ?? 200)));
                const all: DmMessage[] = [];
                let before: string | undefined;
                try {
                    while (all.length < wanted) {
                        const page = (await rest.get()?.get({ url: `/channels/${channel}/messages`, query: { limit: Math.min(100, wanted - all.length), ...(before ? { before } : {}) } }))?.body ?? [];
                        if (page.length === 0) break;
                        all.push(...page);
                        before = page[page.length - 1].id;
                        if (page.length < 100) break;
                    }
                } catch (error) {
                    ctx.reportError("ExportDM", error);
                    ctx.toasts.show("Could not read the messages.", "failure");
                    return;
                }
                const types: Record<Format, string> = { txt: "text/plain", json: "application/json", csv: "text/csv", md: "text/markdown" };
                save(`conversation-${channel}-${new Date().toISOString().split("T")[0]}.${format}`, formatMessages(all.reverse(), format), types[format]);
                ctx.toasts.show(`Exported ${all.length} messages as ${format}.`, "success");
            }
        });
    }
};

export default plugin;
