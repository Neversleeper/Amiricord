/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin QuickMsg (author x2b) as found in TestCord. A button in the row next to the message box sends what is typed in the box (read
// from Discord's draft store) as a message, empties the box, waits the delay and deletes that message. Differences, NOT verified in a real Discord: the button is drawn by
// Amiricord's `ctx.chatBar` (the original used Vencord's chat button API); the draft is cleared through Discord's own draft actions found by their names, and when they are
// missing the typed text stays in the box.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

export const settings = definePluginSettings({
    deleteDelay: { type: "number", default: 0, min: 0, max: 60_000, integer: true, description: "Delay in milliseconds between sending and deleting the message (lower = harder to catch, but may fail if the server is slow)." },
    suppressNotifications: { type: "boolean", default: true, description: "Send the message as a silent message (no pings)." }
});

/** Discord's number for the draft of a normal message in a channel. */
export const CHANNEL_MESSAGE_DRAFT = 0;
/** The flag that makes a message silent (no notifications). */
export const SUPPRESS_NOTIFICATIONS = 4096;

/** What to send for a draft, or undefined when there is nothing worth sending. */
export function messageBody(draft: string | undefined, suppress: boolean, nonce: string): { content: string; flags: number; nonce: string; tts: false; } | undefined {
    if (!draft || draft.trim().length === 0) return undefined;
    return { content: draft, flags: suppress ? SUPPRESS_NOTIFICATIONS : 0, nonce, tts: false };
}

interface Rest {
    post(request: { url: string; body: unknown; rejectWithError?: boolean; }): Promise<{ body?: { id?: string; }; }>;
    del(request: { url: string; rejectWithError?: boolean; }): Promise<unknown>;
}
interface Drafts { getDraft(channelId: string, type: number): string | undefined; }
interface DraftActions { clearDraft(channelId: string, type: number): void; }

let busy = false;

const plugin: PluginCode = {
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const drafts = ctx.finders.byStore<Drafts>("DraftStore");
        const draftActions = ctx.finders.byProps<DraftActions>("clearDraft", "saveDraft");
        const selected = ctx.common.SelectedChannelStore;

        async function quickSend(): Promise<void> {
            if (busy) return;
            const channelId = selected.get()?.getChannelId();
            const api = rest.get();
            if (!channelId || !api) { ctx.toasts.show("Could not find Discord's functions for sending, so nothing was sent.", "failure"); return; }
            const body = messageBody(drafts.get()?.getDraft(channelId, CHANNEL_MESSAGE_DRAFT), settings.store.suppressNotifications, String(Date.now()));
            if (!body) return;
            busy = true;
            try {
                const answer = await api.post({ url: `/channels/${channelId}/messages`, body, rejectWithError: true });
                try { draftActions.get()?.clearDraft(channelId, CHANNEL_MESSAGE_DRAFT); } catch { /* the text just stays in the box */ }
                const id = answer?.body?.id;
                if (!id) return;
                if (settings.store.deleteDelay > 0) await new Promise<void>(resolve => { setTimeout(resolve, settings.store.deleteDelay); });
                await api.del({ url: `/channels/${channelId}/messages/${id}`, rejectWithError: true });
            } catch (error) {
                ctx.reportError("quick send", error);
                ctx.toasts.show("The message could not be sent or deleted.", "failure");
            } finally {
                busy = false;
            }
        }

        ctx.chatBar.add({
            id: "quick-send",
            label: "Quick Send & Delete",
            icon: { viewBox: "0 0 24 24", path: "M13 2L3 14h7l-1 8 10-12h-7l1-8z" },
            onClick: () => { void quickSend(); }
        });
    }
};

export default plugin;
