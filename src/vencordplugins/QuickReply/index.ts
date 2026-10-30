/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin QuickReply (authors fawn, Ven, pylix) as found in TestCord's copy of Vencord's plugins. Same keys and the same two Discord events (start a reply, start an edit), moving through the messages Discord has loaded for the channel. The original also checks if you may write in the channel and follows two other plugins (NoReplyMention, NoBlockedMessages); here a setting says whether replies ping, and blocked or ignored people are skipped. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    shouldMention: { type: "boolean", default: true, description: "Ping the person you reply to" },
    ignoreBlockedAndIgnored: { type: "boolean", default: true, description: "Skip messages of blocked or ignored people when moving" }
});

/** Message types that can be replied to: normal, reply, command, thread starter. */
export const REPLYABLE_TYPES = new Set([0, 19, 20, 21]);
const EPHEMERAL = 64;

export interface MovableMessage { id: string; type: number; deleted?: boolean; flags?: number; author: { id: string; }; }

/** The message to go to from the one you are on (or from nothing, which starts at the newest); null when you move past the ends. */
export function nextMessage(all: MovableMessage[], current: string | null, up: boolean, options: { own: string | undefined; replying: boolean; skip?(authorId: string): boolean; }): MovableMessage | null | undefined {
    const usable = all.filter(message => {
        if (message.deleted || !REPLYABLE_TYPES.has(message.type) || ((message.flags ?? 0) & EPHEMERAL) !== 0) return false;
        if (!options.replying && message.author.id !== options.own) return false;
        return !options.skip?.(message.author.id);
    });
    if (current === null) return usable[usable.length - 1];
    const index = usable.findIndex(message => message.id === current);
    if (index === -1) return usable[usable.length - 1];
    return usable[up ? index - 1 : index + 1] ?? null;
}

let replying: string | null = null;
let editing: string | null = null;

const plugin: PluginCode & { onFlux?(event: { type: string; [key: string]: unknown; }): void; } = {
    settings,
    start(ctx) {
        const dispatcher = ctx.common.FluxDispatcher;
        const selected = ctx.common.SelectedChannelStore;
        const channels = ctx.common.ChannelStore;
        const users = ctx.common.UserStore;
        const relationships = ctx.common.RelationshipStore;
        const store = ctx.common.MessageStore;
        const jumper = ctx.finders.byProps<{ jumpToMessage(options: { channelId: string; messageId: string; flash?: boolean; jumpType?: string; }): void; }>("jumpToMessage");
        const loaded = (channelId: string) => {
            const cache = (store.get() as unknown as { getMessages(channel: string): { _array?: MovableMessage[]; } | undefined; } | undefined)?.getMessages(channelId);
            return cache?._array ?? [];
        };
        const skip = (authorId: string) => settings.store.ignoreBlockedAndIgnored
            && ((relationships.get() as unknown as { isBlockedOrIgnored?(id: string): boolean; } | undefined)?.isBlockedOrIgnored?.(authorId) === true);
        const jumpIfOffScreen = (channelId: string, messageId: string) => {
            const element = document.getElementById(`message-content-${messageId}`);
            if (!element) return;
            const height = Math.max(document.documentElement.clientHeight, window.innerHeight);
            const rect = element.getBoundingClientRect();
            if (rect.bottom < 150 || rect.top - height >= -150) jumper.get()?.jumpToMessage({ channelId, messageId, flash: false, jumpType: "INSTANT" });
        };
        const move = (up: boolean, edit: boolean) => {
            const channelId = selected.get()?.getChannelId();
            if (!channelId) return;
            const own = users.get()?.getCurrentUser()?.id;
            const message = nextMessage(loaded(channelId), edit ? editing : replying, up, { own, replying: !edit, skip });
            if (edit) {
                editing = message?.id ?? null;
                if (!message) { dispatcher.get()?.dispatch({ type: "MESSAGE_END_EDIT", channelId }); return; }
                dispatcher.get()?.dispatch({ type: "MESSAGE_START_EDIT", channelId, messageId: message.id, content: (message as unknown as { content?: string; }).content, _isQuickEdit: true });
                jumpIfOffScreen(channelId, message.id);
                return;
            }
            replying = message?.id ?? null;
            if (!message) { dispatcher.get()?.dispatch({ type: "DELETE_PENDING_REPLY", channelId }); return; }
            const channel = channels.get()?.getChannel(channelId) as { type?: number; } | undefined;
            dispatcher.get()?.dispatch({
                type: "CREATE_PENDING_REPLY", channel, message, shouldMention: settings.store.shouldMention,
                showMentionToggle: channel?.type !== 1 && channel?.type !== 3 && message.author.id !== own, _isQuickReply: true
            });
            (document.querySelector("[role=\"textbox\"][data-slate-editor]") as HTMLElement | null)?.focus();
            jumpIfOffScreen(channelId, message.id);
        };
        const onKey = (event: KeyboardEvent) => {
            const up = event.key === "ArrowUp";
            if (!up && event.key !== "ArrowDown") return;
            if (!event.ctrlKey || event.altKey || event.metaKey) return;
            event.preventDefault();
            move(up, event.shiftKey);
        };
        document.addEventListener("keydown", onKey);
        ctx.onDispose(() => { document.removeEventListener("keydown", onKey); });
    },
    flux: {
        DELETE_PENDING_REPLY() { replying = null; },
        MESSAGE_END_EDIT() { editing = null; },
        CHANNEL_SELECT() { replying = null; editing = null; },
        MESSAGE_START_EDIT({ messageId, _isQuickEdit }: { messageId: string; _isQuickEdit?: boolean; }) { if (!_isQuickEdit) editing = messageId; },
        CREATE_PENDING_REPLY({ message, _isQuickReply }: { message: { id: string; }; _isQuickReply?: boolean; }) { if (!_isQuickReply) replying = message.id; }
    },
    stop() {
        replying = null;
        editing = null;
    }
};

export default plugin;
