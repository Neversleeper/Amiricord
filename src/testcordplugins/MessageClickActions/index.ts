/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MessageClickActions (author x2b) as found in TestCord. A much smaller version of the original, which has many actions (delete, react, copy, pin...) and modifier keys. This one only does what is most used: a double-click on your own message starts the edit and on someone else's starts a reply, each of which can be turned off. A double-click on a link, picture, button or video does nothing. Uses the same two Discord events as QuickReply. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    editOwn: { type: "boolean", default: true, description: "Double-click your own message to edit it" },
    replyOthers: { type: "boolean", default: true, description: "Double-click someone else's message to reply to it" },
    mention: { type: "boolean", default: true, description: "Ping the person when you reply" }
});

const INTERACTIVE = "a, button, img, video, audio, input, textarea, [role=\"button\"], [role=\"textbox\"], [class*=\"embed\"], [class*=\"reaction\"], [class*=\"attachment\"], [class*=\"spoiler\"]";

/** What a double-click on a message should do: "edit", "reply" or nothing. */
export function clickAction(isOwn: boolean, options: { editOwn: boolean; replyOthers: boolean; }): "edit" | "reply" | undefined {
    if (isOwn) return options.editOwn ? "edit" : undefined;
    return options.replyOthers ? "reply" : undefined;
}

const MESSAGE_ID = /^chat-messages-(?:\d+-)?(\d{15,25})-(\d{15,25})$/;

const plugin: PluginCode = {
    start(ctx) {
        const dispatcher = ctx.common.FluxDispatcher;
        const channels = ctx.common.ChannelStore;
        const users = ctx.common.UserStore;
        const store = ctx.common.MessageStore;
        const onDoubleClick = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
            const row = target.closest("li[id^=\"chat-messages-\"]");
            const found = MESSAGE_ID.exec(row?.id ?? "");
            if (!found || !target.closest("[class*=\"contents\"], [id^=\"message-content-\"]")) return;
            const [, channelId, messageId] = found;
            const message = (store.get() as unknown as { getMessage(channel: string, id: string): { id: string; content?: string; author?: { id: string; }; } | undefined; } | undefined)?.getMessage(channelId, messageId);
            if (!message?.author) return;
            const own = message.author.id === users.get()?.getCurrentUser()?.id;
            const action = clickAction(own, settings.store);
            if (!action) return;
            window.getSelection()?.removeAllRanges();
            if (action === "edit") {
                dispatcher.get()?.dispatch({ type: "MESSAGE_START_EDIT", channelId, messageId, content: message.content, _isQuickEdit: true });
                return;
            }
            const channel = channels.get()?.getChannel(channelId) as { type?: number; } | undefined;
            dispatcher.get()?.dispatch({
                type: "CREATE_PENDING_REPLY", channel, message, shouldMention: settings.store.mention,
                showMentionToggle: channel?.type !== 1 && channel?.type !== 3, _isQuickReply: true
            });
            (document.querySelector("[role=\"textbox\"][data-slate-editor]") as HTMLElement | null)?.focus();
        };
        document.addEventListener("dblclick", onDoubleClick);
        ctx.onDispose(() => { document.removeEventListener("dblclick", onDoubleClick); });
    }
};

export default plugin;
