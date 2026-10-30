/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin DownloadAllAttachments (author dhopcs) as found in Equicord's copy of Vencord's plugins. Same idea and same rules (a file name that repeats gets _1, _2...). The original adds the button through Vencord's message popover API; here it uses `ctx.messageButtons`. The files are asked from Discord's own file servers only. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    downloadAllFileTypes: { type: "boolean", default: false, description: "Also download files that are not pictures, videos or audio. Only turn this on if you trust what people send you" }
});

interface Attachment { filename: string; url?: string; proxy_url?: string; }
interface Messages { getMessage(channelId: string, messageId: string): { attachments?: Attachment[]; } | undefined; }

/** The names the files are saved as: the second file called a.png is a_1.png, the third a_2.png. */
export function uniqueNames(filenames: string[]): string[] {
    const used = new Map<string, number>();
    return filenames.map(original => {
        const count = used.get(original) ?? 0;
        used.set(original, count + 1);
        if (count === 0) return original;
        const dot = original.lastIndexOf(".");
        return dot === -1 ? `${original}_${count}` : `${original.slice(0, dot)}_${count}${original.slice(dot)}`;
    });
}

async function save(source: string[], filename: string): Promise<void> {
    let response: Response | undefined;
    for (const address of source) {
        response = await fetch(address).catch(() => undefined);
        if (response?.ok) break;
    }
    if (!response?.ok) throw new Error(response ? `HTTP ${response.status}` : "Network error");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const attachmentsOf = (channelId: string, messageId: string) => (messages.get() as unknown as Messages | undefined)?.getMessage(channelId, messageId)?.attachments ?? [];
        ctx.messageButtons.add({
            id: "download-all",
            label: "Download All Attachments",
            icon: { viewBox: "0 0 24 24", path: "M19 9h-4V3H9v6H5l7 7 7-7ZM5 18v2h14v-2H5Z" },
            shouldShow: ref => attachmentsOf(ref.channelId, ref.messageId).length > 0,
            onClick: async ref => {
                const attachments = attachmentsOf(ref.channelId, ref.messageId);
                const names = uniqueNames(attachments.map(attachment => attachment.filename));
                const results = await Promise.allSettled(attachments.map((attachment, index) => {
                    const sources = [attachment.proxy_url];
                    if (settings.store.downloadAllFileTypes) sources.push(attachment.url);
                    const usable = sources.filter((address): address is string => typeof address === "string" && address.length > 0);
                    if (usable.length === 0) return Promise.reject(new Error("Missing attachment URL"));
                    return save(usable, names[index]);
                }));
                const failed = results.filter(result => result.status === "rejected").length;
                ctx.toasts.show(failed === 0 ? `Downloaded ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}.` : `Downloaded ${attachments.length - failed} of ${attachments.length} attachments. ${failed} failed.`, failed === 0 ? "success" : "failure");
            }
        });
    }
};

export default plugin;
