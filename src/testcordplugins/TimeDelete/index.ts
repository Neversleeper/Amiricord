/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin TimeDelete (author x2b) as found in TestCord. Same rule (your own new messages, deleted after the delay, 1 to 3600 seconds). The original has its switch in the top bar of the channel; the engine has no top bar button yet, so it is a button next to the message box. The delete is the plain Discord request, like QuickMsg's. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    isActive: { type: "boolean", default: false, description: "Delete the messages you send after the delay" },
    delaySeconds: { type: "number", default: 5, min: 1, max: 3600, integer: true, description: "Seconds before your sent messages are deleted" }
});

interface MessageCreate { message: { id: string; channel_id: string; author: { id: string; }; }; optimistic?: boolean; type?: string; }
interface Rest { del(request: { url: string; }): Promise<unknown>; }

const pending = new Map<string, ReturnType<typeof setTimeout>>();
let onCreate: ((event: MessageCreate) => void) | undefined;

/** The delay in milliseconds for a setting value; a value that is not a number or is below one second gives one second. */
export function delayMs(seconds: number): number {
    return Math.max(1, Number.isFinite(seconds) ? seconds : 5) * 1000;
}

const plugin: PluginCode = {
    settings,

    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const users = ctx.common.UserStore;
        ctx.chatBar.add({
            id: "time-delete",
            label: () => settings.store.isActive ? "Time Delete: on" : "Time Delete: off",
            icon: {
                viewBox: "0 0 24 24",
                path: "M12 1.75A10.25 10.25 0 1 0 22.25 12 10.26 10.26 0 0 0 12 1.75Zm0 18.5A8.25 8.25 0 1 1 20.25 12 8.26 8.26 0 0 1 12 20.25ZM12 6.25a1 1 0 0 0-1 1v4.34l-2.62 1.57a1 1 0 1 0 1.02 1.72l3.1-1.86a1 1 0 0 0 .5-.86V7.25a1 1 0 0 0-1-1Z"
            },
            active: () => settings.store.isActive,
            onClick: () => { settings.store.isActive = !settings.store.isActive; ctx.chatBar.refresh(); }
        });
        ctx.onDispose(() => {
            for (const timer of pending.values()) clearTimeout(timer);
            pending.clear();
        });
        onCreate = ({ message, optimistic, type }) => {
            if (!settings.store.isActive || optimistic || type !== "MESSAGE_CREATE") return;
            const me = users.get()?.getCurrentUser()?.id;
            if (!me || message.author.id !== me || pending.has(message.id)) return;
            pending.set(message.id, setTimeout(() => {
                pending.delete(message.id);
                rest.get()?.del({ url: `/channels/${message.channel_id}/messages/${message.id}` }).catch(error => ctx.reportError("TimeDelete", error));
            }, delayMs(settings.store.delaySeconds)));
        };
    },

    stop() {
        onCreate = undefined;
    },

    flux: {
        MESSAGE_CREATE(event: MessageCreate) {
            onCreate?.(event);
        }
    }
};

export default plugin;
