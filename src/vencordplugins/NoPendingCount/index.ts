/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoPendingCount (author amia) as found in TestCord's copy of Vencord's plugins. Same four patches. The original switches each one on or off with `predicate` (needs a restart); here the patched code asks the plugin when it runs, so the options work at once. The message requests store is found by name when the plugin starts. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    hideFriendRequestsCount: { type: "boolean", default: true, description: "Hide the count of incoming friend requests" },
    hideMessageRequestsCount: { type: "boolean", default: true, description: "Hide the count of message requests" },
    hidePremiumOffersCount: { type: "boolean", default: true, description: "Hide the count of Nitro offers" }
});

interface MessageRequests { getMessageRequestChannelIds(): { size: number; }; }

let messageRequests: { get(): MessageRequests | undefined; } | undefined;

const plugin: PluginCode & { hideFriends(): boolean; hideMessages(): boolean; hideOffers(): boolean; getRealMessageRequestCount(): number; } = {
    settings,
    // The functions that decide the count in the top left are in the one module that calls getUnacknowledgedOffers(...), or search "showProgressBadge:"
    patches: [
        {
            find: "getPendingCount(){",
            lazy: true,
            required: false,
            replacements: [{ match: /(?<=getPendingCount\(\)\{)/, replace: "if($self.hideFriends())return 0;" }]
        },
        {
            // Message requests hook
            find: "getMessageRequestsCount(){",
            lazy: true,
            required: false,
            replacements: [{ match: /(?<=getMessageRequestsCount\(\)\{)/, replace: "if($self.hideMessages())return 0;" }]
        },
        {
            // Keeps the Message Requests tab from always hiding because of the patch above (and works with spam requests): only the red badge goes
            find: ".getSpamChannelsCount();return",
            lazy: true,
            required: false,
            replacements: [{ match: /(?<=getSpamChannelsCount\(\);return )(\i\.getMessageRequestsCount\(\))/, replace: "$self.hideMessages()?$self.getRealMessageRequestCount():$1" }]
        },
        {
            find: "showProgressBadge:",
            lazy: true,
            required: false,
            // The two groups inside the first group are the minified names of the variables, used later to find unviewedTrialCount + unviewedDiscountCount
            replacements: [{
                match: /(\{unviewedTrialCount:(\i),unviewedDiscountCount:(\i)\}.+?)\2\+\3/,
                replace: (_whole: string, rest: string, trial: string, discount: string) => `${rest}$self.hideOffers()?0:${trial}+${discount}`
            }]
        }
    ],

    start(ctx) {
        messageRequests = ctx.finders.byStore<MessageRequests>("MessageRequestStore");
    },
    stop() {
        messageRequests = undefined;
    },

    hideFriends() {
        return settings.store.hideFriendRequestsCount;
    },
    hideMessages() {
        return settings.store.hideMessageRequestsCount;
    },
    hideOffers() {
        return settings.store.hidePremiumOffersCount;
    },
    getRealMessageRequestCount() {
        return messageRequests?.get()?.getMessageRequestChannelIds().size ?? 0;
    }
};

export default plugin;
