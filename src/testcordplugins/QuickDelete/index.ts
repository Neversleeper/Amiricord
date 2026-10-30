/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin QuickDelete (author Sharp) as found in TestCord. Same shortcuts (Alt + Delete, or Ctrl + Shift + Delete) and same rule (your most recent message that is not already deleted). The delete is the plain Discord request, like QuickMsg's.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    keybind: {
        type: "select", default: "altDelete", description: "Keyboard shortcut that deletes your last message in this channel",
        options: [
            { label: "Alt + Delete", value: "altDelete" },
            { label: "Ctrl + Shift + Delete", value: "ctrlShiftDelete" }
        ]
    },
    showConfirmToast: { type: "boolean", default: true, description: "Show a notice after deleting" }
});

interface Rest { del(request: { url: string; }): Promise<unknown>; }
interface Messages { getMessages(channelId: string): { toArray?(): Array<{ id: string; author?: { id: string; }; deleted?: boolean; }>; } | undefined; }

/** Whether the key press is the shortcut chosen. */
export function matchesKeybind(event: { altKey: boolean; ctrlKey: boolean; shiftKey: boolean; key: string; }, keybind: string): boolean {
    if (keybind === "altDelete") return event.altKey && event.key === "Delete" && !event.ctrlKey && !event.shiftKey;
    if (keybind === "ctrlShiftDelete") return event.ctrlKey && event.shiftKey && event.key === "Delete" && !event.altKey;
    return false;
}

let stopListening: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const messages = ctx.common.MessageStore;
        const users = ctx.common.UserStore;
        const channels = ctx.common.SelectedChannelStore;
        const listener = async (event: KeyboardEvent) => {
            if (!matchesKeybind(event, settings.store.keybind)) return;
            const channelId = channels.get()?.getChannelId();
            const me = users.get()?.getCurrentUser()?.id;
            if (!channelId || !me) return;
            const all = (messages.get() as unknown as Messages | undefined)?.getMessages(channelId)?.toArray?.() ?? [];
            const last = [...all].reverse().find(message => message.author?.id === me && !message.deleted);
            if (!last) return;
            event.preventDefault();
            try {
                await rest.get()?.del({ url: `/channels/${channelId}/messages/${last.id}` });
                if (settings.store.showConfirmToast) ctx.toasts.show("Last message deleted.", "success");
            } catch (error) {
                ctx.reportError("QuickDelete", error);
                ctx.toasts.show("Could not delete the message.", "failure");
            }
        };
        document.addEventListener("keydown", listener);
        stopListening = () => document.removeEventListener("keydown", listener);
    },
    stop() {
        stopListening?.();
        stopListening = undefined;
    }
};

export default plugin;
