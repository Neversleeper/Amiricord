/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RepeatMessages (authors Tolgchu, thororen) as found in Equicord's copy of Vencord's plugins. Same behaviour (the text, the file links and the stickers go again; mentions are not triggered). The original also adds an entry to the right-click menu; this port has only the button. Uses ctx.messageButtons and the plain send request, like QuickMsg. Not tried in a real Discord.

import type { PluginCode } from "../../renderer/engine";

interface Attachment { filename: string; url: string; }
interface StoredMessage {
    content?: string;
    attachments?: Attachment[];
    messageSnapshots?: Array<{ message?: { attachments?: Attachment[]; }; }>;
    stickerItems?: Array<{ id: string; }>;
}
interface Messages { getMessage(channelId: string, messageId: string): StoredMessage | undefined; }
interface Rest { post(request: { url: string; body: unknown; }): Promise<unknown>; }

/** The text to send again: the content, then a list of the files with their addresses (the message's own and the ones in forwarded copies). */
export function repeatContent(message: StoredMessage): string {
    const all: Attachment[] = [...(message.attachments ?? [])];
    for (const snapshot of message.messageSnapshots ?? []) all.push(...(snapshot.message?.attachments ?? []));
    let content = message.content ?? "";
    if (all.length > 0) {
        content += "\nAttachments:";
        for (const attachment of all) content += `\n - ${attachment.filename} (${attachment.url})`;
    }
    return content;
}

let shift = false;
const onKey = (event: KeyboardEvent) => { if (event.key === "Shift") shift = event.type === "keydown"; };

const plugin: PluginCode = {
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const messages = ctx.common.MessageStore;
        document.addEventListener("keydown", onKey);
        document.addEventListener("keyup", onKey);
        ctx.onDispose(() => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("keyup", onKey);
            shift = false;
        });
        ctx.messageButtons.add({
            id: "repeat",
            label: "Repeat (click) / Repeat and reply (Shift + click)",
            icon: { viewBox: "0 -960 960 960", path: "m274-200 34 34q12 12 11.5 28T308-110q-12 12-28.5 12.5T251-109L148-212q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l103-103q12-12 28.5-11.5T308-370q11 12 11.5 28T308-314l-34 34h406v-120q0-17 11.5-28.5T720-440q17 0 28.5 11.5T760-400v120q0 33-23.5 56.5T680-200H274Zm412-480H280v120q0 17-11.5 28.5T240-520q-17 0-28.5-11.5T200-560v-120q0-33 23.5-56.5T280-760h406l-34-34q-12-12-11.5-28t11.5-28q12-12 28.5-12.5T709-851l103 103q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L709-589q-12 12-28.5 11.5T652-590q-11-12-11.5-28t11.5-28l34-34Z" },
            onClick: async ref => {
                const message = (messages.get() as unknown as Messages | undefined)?.getMessage(ref.channelId, ref.messageId);
                if (!message) return;
                try {
                    await rest.get()?.post({
                        url: `/channels/${ref.channelId}/messages`,
                        body: {
                            content: repeatContent(message),
                            nonce: String(Date.now()),
                            tts: false,
                            allowed_mentions: { parse: [], replied_user: false },
                            message_reference: shift ? { channel_id: ref.channelId, message_id: ref.messageId } : undefined,
                            sticker_ids: (message.stickerItems ?? []).map(sticker => sticker.id)
                        }
                    });
                } catch (error) {
                    ctx.reportError("RepeatMessages", error);
                    ctx.toasts.show("Could not repeat the message", "failure");
                }
            }
        });
    }
};

export default plugin;
