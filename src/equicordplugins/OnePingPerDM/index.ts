/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin OnePingPerDM (author ProffDea) as found in Equicord's copy of Vencord's plugins. Same two patches and same decision rules. Discord's channel type numbers are written out (1 = DM, 3 = group DM) and the stores are found by name when the plugin starts. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const DM = 1;
const GROUP_DM = 3;

const settings = definePluginSettings({
    channelToAffect: {
        type: "select", default: "both_dms", description: "Which DMs the plugin affects",
        options: [
            { label: "Both", value: "both_dms" },
            { label: "User DMs", value: "user_dm" },
            { label: "Group DMs", value: "group_dm" }
        ]
    },
    allowMentions: { type: "boolean", default: false, description: "Hear the sound for @mentions" },
    allowEveryone: { type: "boolean", default: false, description: "Hear the sound for @everyone and @here in group DMs" },
    ignoreUsers: { type: "string", default: "", description: "IDs of people whose messages are never limited, separated by comma and space" },
    alwaysPlaySound: { type: "boolean", default: false, description: "Play the message sound even when Discord has it turned off" }
});

interface Message { id: string; channel_id: string; author: { id: string; }; mentions: Array<{ id: string; }>; mention_everyone?: boolean; }
interface Channels { getChannel(id: string): { type: number; } | undefined; }
interface Users { getCurrentUser(): { id: string; } | undefined; }
interface ReadStates { getOldestUnreadMessageId(channelId: string): string | undefined; }

let channels: { get(): Channels | undefined; } | undefined;
let users: { get(): Users | undefined; } | undefined;
let readStates: { get(): ReadStates | undefined; } | undefined;

const plugin: PluginCode & { playSound(): boolean; isPrivateChannelRead(message: Message | undefined): boolean; } = {
    settings,
    patches: [
        {
            find: "playNotificationSound(",
            lazy: true,
            required: false,
            replacements: [
                {
                    match: /(\i\.\i\.getDesktopType\(\)===\i\.\i\.NEVER)\)(?=.*?(\i\.\i\.playNotificationSound\(.{0,5}\)))/,
                    replace: "$&if(!$self.isPrivateChannelRead(arguments[0]?.message))return;else if($self.playSound())return $2;else "
                },
                {
                    match: /sound:(\i\?(\i):void 0,volume:\i,onClick)/,
                    replace: "sound:!$self.isPrivateChannelRead(arguments[0]?.message)?undefined:$self.playSound()?$2:$1"
                }
            ]
        }
    ],

    start(ctx) {
        channels = ctx.common.ChannelStore as typeof channels;
        users = ctx.common.UserStore as typeof users;
        readStates = ctx.common.ReadStateStore as unknown as typeof readStates;
    },
    stop() {
        channels = users = readStates = undefined;
    },

    playSound() {
        return settings.store.alwaysPlaySound;
    },

    /** True when the message should make its sound: it is the oldest unread one, or the plugin does not apply to it. */
    isPrivateChannelRead(message) {
        if (!message) return true;
        const ignored = settings.store.ignoreUsers.split(", ").filter(Boolean);
        if (ignored.includes(message.author.id)) return true;
        const type = channels?.get()?.getChannel(message.channel_id)?.type;
        const mode = settings.store.channelToAffect;
        if (
            (type !== DM && type !== GROUP_DM)
            || (type === DM && mode === "group_dm")
            || (type === GROUP_DM && mode === "user_dm")
            || (settings.store.allowMentions && message.mentions.some(mention => mention.id === users?.get()?.getCurrentUser()?.id))
            || (settings.store.allowEveryone && message.mention_everyone)
        ) return true;
        return readStates?.get()?.getOldestUnreadMessageId(message.channel_id) === message.id;
    }
};

export default plugin;
