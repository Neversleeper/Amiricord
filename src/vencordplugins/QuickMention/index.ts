/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin QuickMention (author kemo) as found in TestCord's copy of Vencord's plugins. Same idea. The original adds the button through Vencord's message popover API; here it uses `ctx.messageButtons` (new in the engine). The text is typed into the message box like real typing (`src/api/chatInput.ts`). The button hides in a server channel where you cannot send messages. Not tried in a real Discord.

import { insertIntoChatInput } from "../../api/chatInput";
import type { MessageRef } from "../../api/messageButtons";
import type { PluginCode } from "../../renderer/engine";

const SEND_MESSAGES = 1n << 11n;

interface Messages { getMessage(channelId: string, messageId: string): { author?: { id: string; }; } | undefined; }
interface Channels { getChannel(id: string): { guild_id?: string; } | undefined; }
interface Permissions { can(permission: bigint, channel: unknown): boolean; }

export const mentionText = (userId: string) => `<@${userId}> `;

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const channels = ctx.common.ChannelStore;
        const permissions = ctx.common.PermissionStore;
        const canSend = (ref: MessageRef) => {
            const channel = (channels.get() as Channels | undefined)?.getChannel(ref.channelId);
            if (!channel?.guild_id) return true;
            return (permissions.get() as unknown as Permissions | undefined)?.can(SEND_MESSAGES, channel) !== false;
        };
        ctx.messageButtons.add({
            id: "quick-mention",
            label: "Quick Mention",
            icon: {
                viewBox: "0 0 24 24",
                path: "M12 2C6.486 2 2 6.486 2 12C2 17.515 6.486 22 12 22C14.039 22 15.993 21.398 17.652 20.259L16.521 18.611C15.195 19.519 13.633 20 12 20C7.589 20 4 16.411 4 12C4 7.589 7.589 4 12 4C16.411 4 20 7.589 20 12V12.782C20 14.17 19.402 15 18.4 15L18.398 15.018C18.338 15.005 18.273 15 18.209 15H18C17.437 15 16.6 14.182 16.6 13.631V12C16.6 9.464 14.537 7.4 12 7.4C9.463 7.4 7.4 9.463 7.4 12C7.4 14.537 9.463 16.6 12 16.6C13.234 16.6 14.35 16.106 15.177 15.313C15.826 16.269 16.93 17 18 17L18.002 16.981C18.064 16.994 18.129 17 18.195 17H18.4C20.552 17 22 15.306 22 12.782V12C22 6.486 17.514 2 12 2ZM12 14.599C10.566 14.599 9.4 13.433 9.4 11.999C9.4 10.565 10.566 9.399 12 9.399C13.434 9.399 14.6 10.565 14.6 11.999C14.6 13.433 13.434 14.599 12 14.599Z"
            },
            shouldShow: canSend,
            onClick: ref => {
                const author = (messages.get() as unknown as Messages | undefined)?.getMessage(ref.channelId, ref.messageId)?.author;
                if (!author) return;
                const text = mentionText(author.id);
                if (!insertIntoChatInput(document, text)) ctx.toasts.show("There is no message box open to write in", "failure");
            }
        });
    }
};

export default plugin;
