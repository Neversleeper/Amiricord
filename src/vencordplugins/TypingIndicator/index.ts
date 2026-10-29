/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin TypingIndicator (authors Nuckyz, fawn and Sqaaakoi) as found in TestCord's copy of Vencord's plugins. The two patches are the
// original's. Differences: the hook that redraws on store changes is written with React's own hooks (as in the HomeTyping port); the avatars are plain pictures (the original
// used Discord's UserSummaryItem, with a profile popout on click); the hover text is the browser's own `title`, in English ("A, B are typing..."), not Discord's translated
// texts; and the original's mention of the TypingTweaks plugin for "several people" is left out. The style goes in when the first indicator is drawn.
// NOT checked on a live page: the two anchors on the current build, the store names, and the look.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

const DOTS = 1;
const AVATARS = 2;

const settings = definePluginSettings({
    includeCurrentChannel: { type: "boolean", default: true, description: "Whether to show the typing indicator for the currently selected channel" },
    includeMutedChannels: { type: "boolean", default: false, description: "Whether to show the typing indicator for muted channels." },
    includeIgnoredUsers: { type: "boolean", default: false, description: "Whether to show the typing indicator for ignored users." },
    includeBlockedUsers: { type: "boolean", default: false, description: "Whether to show the typing indicator for blocked users." },
    indicatorMode: {
        type: "select",
        default: DOTS | AVATARS,
        description: "How should the indicator be displayed?",
        options: [
            { label: "Avatars and animated dots", value: DOTS | AVATARS },
            { label: "Animated dots", value: DOTS },
            { label: "Avatars", value: AVATARS }
        ]
    }
} as const);

const CSS = `
.ac-typing-indicator { display: flex; align-items: center; margin-left: 6px; margin-right: 2px; }
.ac-typing-indicator-avatars { display: flex; margin-right: 4px; }
.ac-typing-indicator-avatars img { width: 16px; height: 16px; border-radius: 50%; margin-left: -4px; }
.ac-typing-indicator-avatars img:first-child { margin-left: 0; }
.ac-typing-indicator-dots { display: flex; align-items: center; }
`;

let context: EnginePluginContext | undefined;
let styled = false;
let typingStore: Lazy;
let userStore: Lazy;
let guildMembers: Lazy;
let selectedChannel: Lazy;
let guildSettings: Lazy;
let relationships: Lazy;
let threeDots: Lazy;

function useStores(stores: any[], read: () => unknown): unknown {
    const react = currentReact() as any;
    const [, redraw] = react.useState(0) as [number, (update: (n: number) => number) => void];
    const value = read();
    react.useEffect(() => {
        const listener = () => redraw(n => n + 1);
        const live = stores.filter(store => typeof store?.addChangeListener === "function");
        live.forEach(store => store.addChangeListener(listener));
        return () => live.forEach(store => store.removeChangeListener(listener));
    }, stores);
    return value;
}

function displayName(guildId: string | null, userId: string): string {
    const user = userStore?.get()?.getUser?.(userId);
    return guildMembers?.get()?.getNick?.(guildId, userId) ?? user?.globalName ?? user?.username ?? "Someone";
}

function describe(names: string[], total: number): string {
    if (total === 1) return `${names[0]} is typing...`;
    if (total === 2) return `${names[0]} and ${names[1]} are typing...`;
    if (total === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing...`;
    return "Several people are typing...";
}

function Indicator({ channelId, guildId }: { channelId: string; guildId: string | null; }): unknown {
    const react = currentReact() as any;
    const stores = [typingStore?.get(), selectedChannel?.get()];
    const typing = useStores(stores, () => Object.keys({ ...(typingStore?.get()?.getTypingUsers?.(channelId) ?? {}) }).sort().join(",")) as string;
    const current = useStores(stores, () => selectedChannel?.get()?.getChannelId?.());
    try {
        if (!settings.store.includeMutedChannels && guildSettings?.get()?.isChannelMuted?.(guildId, channelId)) return null;
        if (!settings.store.includeCurrentChannel && current === channelId) return null;
        const me = userStore?.get()?.getCurrentUser?.()?.id;
        const relation = relationships?.get();
        const ids = typing.split(",").filter(id => id !== "" && id !== me
            && !(relation?.isBlocked?.(id) && !settings.store.includeBlockedUsers)
            && !(relation?.isIgnored?.(id) && !settings.store.includeIgnoredUsers));
        if (!ids.length) return null;
        if (!styled && context) {
            styled = true;
            context.addStyle(CSS, "typing-indicator");
        }
        const mode = Number(settings.store.indicatorMode);
        const parts: unknown[] = [];
        if ((mode & AVATARS) === AVATARS) {
            parts.push(react.createElement("div", { key: "avatars", className: "ac-typing-indicator-avatars" },
                ids.slice(0, 3).map(id => {
                    const user = userStore?.get()?.getUser?.(id);
                    const picture = user?.getAvatarURL?.(guildId ?? undefined, 32, false);
                    return picture ? react.createElement("img", { key: id, alt: "", src: picture }) : null;
                })));
        }
        const Dots = threeDots?.get();
        if ((mode & DOTS) === DOTS && Dots) {
            parts.push(react.createElement("div", { key: "dots", className: "ac-typing-indicator-dots" }, react.createElement(Dots, { dotRadius: 3, themed: true })));
        }
        if (!parts.length) return null;
        return react.createElement("div", { className: "ac-typing-indicator", title: describe(ids.slice(0, 3).map(id => displayName(guildId, id)), ids.length) }, parts);
    } catch {
        return null;
    }
}

const plugin: PluginCode & { TypingIndicator(channelId: string, guildId: string | null): unknown; } = {
    settings,

    patches: [
        {
            // Normal channel.
            find: "UNREAD_IMPORTANT:",
            lazy: true,
            replacements: [{
                match: /\.Children\.count.+?:null(?<=,channel:(\i).+?)/,
                replace: "$&,$self.TypingIndicator($1.id,$1.getGuildId())"
            }]
        },
        {
            // The thread "spine" on the left.
            find: "M0 15H2c0 1.6569",
            lazy: true,
            required: false,
            replacements: [{
                match: /\(\i,\{thread:(\i),countInVoice:.{0,200}?\]\}\)(?=\])/,
                replace: "$&,$self.TypingIndicator($1.id,$1.getGuildId())"
            }]
        }
    ],

    start(ctx) {
        context = ctx;
        typingStore = ctx.finders.byStore("TypingStore");
        userStore = ctx.common.UserStore;
        guildMembers = ctx.common.GuildMemberStore;
        selectedChannel = ctx.common.SelectedChannelStore;
        guildSettings = ctx.finders.byStore("UserGuildSettingsStore");
        relationships = ctx.common.RelationshipStore;
        threeDots = ctx.finders.componentByCode("Math.min(1,Math.max(", "dotRadius:");
    },

    stop() {
        context = undefined;
        styled = false;
        typingStore = userStore = guildMembers = selectedChannel = guildSettings = relationships = threeDots = undefined;
    },

    TypingIndicator(channelId, guildId) {
        return (currentReact() as any).createElement(Indicator, { channelId, guildId });
    }
};

export default plugin;
