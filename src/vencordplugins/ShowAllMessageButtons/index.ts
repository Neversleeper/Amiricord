/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowAllMessageButtons (author Nuckyz) as found in TestCord's copy of Vencord's plugins. Same patches. The original switches three of them on or off with `predicate`; here the patched code asks the plugin when it runs, so the options work at once, and the delete and pin go through Discord's plain requests instead of its message actions. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    noShiftDelete: { type: "boolean", default: true, description: "Delete a message without holding Shift" },
    noShiftPin: { type: "boolean", default: true, description: "Pin a message without holding Shift" },
    noQuickReacts: { type: "boolean", default: true, description: "Hide the quick reactions. By default, showing the whole menu hides them" }
});

interface Rest { del(request: { url: string; }): Promise<unknown>; put(request: { url: string; }): Promise<unknown>; }

let rest: { get(): Rest | undefined; } | undefined;

const plugin: PluginCode & {
    noShiftDelete(): boolean;
    noShiftPin(): boolean;
    hideQuickReacts(): boolean;
    deleteMessage(message: { channel_id: string; id: string; }): void;
    toggleMessagePin(args: { channel: { id: string; } | string; message: { id: string; pinned?: boolean; }; }): void;
} = {
    settings,
    patches: [
        {
            find: "#{intl::MESSAGE_UTILITIES_A11Y_LABEL}),children",
            lazy: true,
            required: false,
            replacements: [
                { match: /isExpanded:\i&&(.+?),/, replace: "isExpanded:$1," },
                { match: /onClick:(.{10,20})(?=,dangerous:!0)/, replace: "onClick:$self.noShiftDelete()?()=>$self.deleteMessage(arguments[0].message):$1" },
                { match: /onClick:(.{10,30})(?=\},"pin")/, replace: "onClick:$self.noShiftPin()?()=>$self.toggleMessagePin(arguments[0]):$1" },
                // Quick reactions show only when the menu is not expanded; with "hide" off the condition becomes false and they always show (build 655747, module 471533).
                // The add-reaction button is a member expression on Discord's current build, which the bare identifier pattern of `\i` cannot match
                { match: /(\i)(\?null:\(0,\i\.jsxs\).{0,100}message:\i\}\),\(0,\i\.jsxs?\)\([\w$]+(?:\.[\w$]+)*,\{\}\))/, replace: "($self.hideQuickReacts()&&$1)$2" }
            ]
        }
    ],

    start(ctx) {
        rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
    },
    stop() {
        rest = undefined;
    },

    noShiftDelete() {
        return settings.store.noShiftDelete;
    },
    noShiftPin() {
        return settings.store.noShiftPin;
    },
    hideQuickReacts() {
        return settings.store.noQuickReacts;
    },
    deleteMessage({ channel_id, id }) {
        void rest?.get()?.del({ url: `/channels/${channel_id}/messages/${id}` });
    },
    toggleMessagePin({ channel, message }) {
        const channelId = typeof channel === "string" ? channel : channel.id;
        const url = `/channels/${channelId}/pins/${message.id}`;
        void (message.pinned ? rest?.get()?.del({ url }) : rest?.get()?.put({ url }));
    }
};

export default plugin;
