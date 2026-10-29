/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */

// Adapted for Amiricord (2026) from the plugin UniversalMention (author justjxke) of Equicord. The three patches were checked against the text of Discord's web build 653945
// (module with `,queryMentionResults(`): each regular expression matches once there (the second one twice, as the original wants, since it is global). The original switched the
// second patch on and off with a `predicate`; Amiricord's patches have none, so that patch wraps the original expression and `members` decides at run time.
// Not tried in a real Discord at the time of writing.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    globalMention: {
        type: "boolean", default: false, restartNeeded: true,
        description: "Mention users from any server, not just the current one. It can slow Discord down and show a huge number of users in the autocomplete."
    },
    onlyDMUsers: {
        type: "boolean", default: false, restartNeeded: true,
        description: "Only show users you have had direct messages with."
    }
});

// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
let userStore: { get(): any; } | undefined;
let channelStore: { get(): any; } | undefined;
let cachedUsers: any[] | null = null;

/** The people to offer, given the two options. `all` is every user Discord knows. */
export function pickUsers(all: any[], onlyDM: boolean, hasDM: (id: string) => unknown): any[] {
    return onlyDM ? all.filter(user => hasDM(user.id)) : all;
}

function users(): any[] {
    return cachedUsers ??= Object.values(userStore?.get()?.getUsers?.() ?? {});
}

const plugin: PluginCode & { members(original: unknown): unknown; useFilter(map?: boolean): unknown; } = {
    settings,

    patches: [{
        find: ",queryMentionResults(",
        replacements: [
            { match: /(filter:\i).{0,75}context:\i\}\)(?=,allowSnowflake)/, replace: "$1=>true" },
            { match: /(?<=\i=)(\i\.\i\.getMembers\(.{0,25}\)\.filter\(\i\))/g, replace: "$self.members($1)" },
            { match: /(?<=\i=)\i\.recipients\.map\(.{0,100}\?\?null\}\)\)/, replace: "$self.useFilter(true)" }
        ]
    }],

    /** The people of the current server, or every user when the options ask for it. */
    members(original) {
        return settings.store.globalMention || settings.store.onlyDMUsers ? plugin.useFilter() : original;
    },

    useFilter(map = false) {
        const list = pickUsers(users(), settings.store.onlyDMUsers, id => channelStore?.get()?.getDMFromUserId?.(id));
        return map ? list.map(user => ({ userId: user.id, nick: null })) : list;
    },

    start(ctx) {
        userStore = ctx.common.UserStore;
        channelStore = ctx.common.ChannelStore;
        cachedUsers = null;
    },

    stop() {
        userStore = channelStore = undefined;
        cachedUsers = null;
    }
};

export default plugin;
