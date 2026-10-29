/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */

// Adapted for Amiricord (2026) from the plugin MemberCount (authors Ven, Commandtechno and Apexo) as found in TestCord's copy of Vencord's plugins. The two patches are the
// original's, with the translation key VIEW_AS_ROLES_MENTIONS_WARNING written as its hash (`5LwN89`); both anchors were checked on build 653945 and match once.
// Differences: the "online" count that the original kept in its own Flux store is a plain map filled from Discord's two events (`GUILD_MEMBER_LIST_UPDATE` and
// `ONLINE_GUILD_MEMBER_COUNT_UPDATE`) with a short list of components that redraw on change; the ask for a server's count when it has none yet goes through Discord's
// channel `preload` function, found by name and NOT checked on a live page (without it the online count is "?" until the member list loads); Discord's tooltips are the
// browser's own `title`; and the `voiceActivity` setting is read when the widget is drawn. The style goes in when the first widget is drawn.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

type Lazy = { get(): any; } | undefined;

const settings = definePluginSettings({
    toolTip: { type: "boolean", default: true, restartNeeded: true, description: "Show member count on the server tooltip" },
    memberList: { type: "boolean", default: true, restartNeeded: true, description: "Show member count in the member list" },
    voiceActivity: { type: "boolean", default: true, description: "Show voice activity with member count in the member list" }
} as const);

const CSS = `
.ac-membercount-widget { gap: 0.85em; display: flex; align-content: center; --color-online: var(--green-360, #3ba55d); --color-total: var(--primary-400, #949ba4); --color-voice: var(--primary-400, #949ba4); }
.ac-membercount-tooltip { margin-top: 0.25em; margin-left: 2px; }
.ac-membercount-member-list { justify-content: center; flex-wrap: wrap; margin-top: 1em; padding-inline: 1em; line-height: 1.2em; }
.ac-membercount-container { display: flex; align-items: center; gap: 0.5em; }
.ac-membercount-online { color: var(--color-online); }
.ac-membercount-total { color: var(--color-total); }
.ac-membercount-voice { color: var(--color-voice); }
.ac-membercount-online-count { fill: var(--status-online, #3ba55d); width: 18px; height: 18px; }
.ac-membercount-total-count { fill: none; stroke: var(--icon-status-offline, #80848e); stroke-width: 4px; width: 15px; height: 15px; }
.ac-membercount-voice-icon { color: var(--color-voice); width: 15px; height: 15px; }
`;

const VIEW_CHANNEL = 1n << 10n;
const MIC_1 = "M15.6668 3C14.2523 3 12.8958 3.5619 11.8956 4.5621C10.8954 5.56229 10.3335 6.91884 10.3335 8.33333V13.6666C10.3335 15.0811 10.8954 16.4378 11.8956 17.438C12.8958 18.4381 14.2523 19 15.6668 19C17.0813 19 18.4378 18.4381 19.438 17.438C20.4382 16.4378 21.0001 15.0811 21.0001 13.6666V8.33333C21.0001 6.91884 20.4382 5.56229 19.438 4.5621C18.4378 3.5619 17.0813 3 15.6668 3Z";
const MIC_2 = "M7.66667 13.6666C7.66667 13.313 7.52619 12.9739 7.27614 12.7238C7.02609 12.4738 6.68695 12.3333 6.33333 12.3333C5.97971 12.3333 5.64057 12.4738 5.39052 12.7238C5.14047 12.9739 5 13.313 5 13.6666C4.99911 16.2653 5.94692 18.7749 7.66545 20.7243C9.38399 22.6736 11.7551 23.9285 14.3334 24.2533V27H11.6667C11.3131 27 10.9739 27.1404 10.7239 27.3905C10.4738 27.6405 10.3334 27.9797 10.3334 28.3333C10.3334 28.6869 10.4738 29.0261 10.7239 29.2761C10.9739 29.5262 11.3131 29.6666 11.6667 29.6666H19.6667C20.0203 29.6666 20.3595 29.5262 20.6095 29.2761C20.8596 29.0261 21 28.6869 21 28.3333C21 27.9797 20.8596 27.6405 20.6095 27.3905C20.3595 27.1404 20.0203 27 19.6667 27H17V24.2533C19.5783 23.9285 21.9494 22.6736 23.6679 20.7243C25.3864 18.7749 26.3343 16.2653 26.3334 13.6666C26.3334 13.313 26.1929 12.9739 25.9428 12.7238C25.6928 12.4738 25.3536 12.3333 25 12.3333C24.6464 12.3333 24.3073 12.4738 24.0572 12.7238C23.8072 12.9739 23.6667 13.313 23.6667 13.6666C23.6667 15.7884 22.8238 17.8232 21.3235 19.3235C19.8233 20.8238 17.7884 21.6666 15.6667 21.6666C13.545 21.6666 11.5101 20.8238 10.0098 19.3235C8.50952 17.8232 7.66667 15.7884 7.66667 13.6666Z";

const number = new Intl.NumberFormat();

let context: EnginePluginContext | undefined;
let styled = false;
const online = new Map<string, number>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
const waiting: string[] = [];
let draining = false;

let voiceStates: Lazy;
let channels: Lazy;
let permissions: Lazy;
let selectedChannel: Lazy;
let memberCounts: Lazy;
let memberLists: Lazy;
let threadLists: Lazy;
let guildChannels: Lazy;
let channelActions: Lazy;

const changed = () => { for (const listener of [...listeners]) listener(); };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function onlineFromGroups(groups: Array<{ id: string; count: number; }> | undefined): number {
    return (groups ?? []).reduce((total, group) => total + (group.id === "offline" ? 0 : group.count), 0);
}

/** Asks Discord for a server's member list once (so the "online" number arrives), one server every 200 ms. */
async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
        for (let guildId = waiting.shift(); guildId; guildId = waiting.shift()) {
            if (online.has(guildId)) continue;
            try {
                const channel = guildChannels?.get()?.getDefaultChannel?.(guildId);
                if (channel) await channelActions?.get()?.preload?.(guildId, channel.id);
            } catch {
                // preloading is only a help
            }
            await sleep(200);
        }
    } finally {
        draining = false;
    }
}

function ensureCount(guildId: string | undefined): void {
    if (!guildId || online.has(guildId) || asked.has(guildId)) return;
    asked.add(guildId);
    waiting.push(guildId);
    void drain();
}

function useStores(stores: any[], read: () => unknown): void {
    const react = currentReact() as any;
    const [, redraw] = react.useState(0) as [number, (update: (n: number) => number) => void];
    react.useEffect(() => {
        const listener = () => redraw(n => n + 1);
        const live = stores.filter(store => typeof store?.addChangeListener === "function");
        live.forEach(store => store.addChangeListener(listener));
        listeners.add(listener);
        return () => {
            live.forEach(store => store.removeChangeListener(listener));
            listeners.delete(listener);
        };
    }, stores);
    read();
}

function Widget({ isTooltip, tooltipGuildId }: { isTooltip?: boolean; tooltipGuildId?: string; }): unknown {
    const react = currentReact() as any;
    useStores([voiceStates?.get(), selectedChannel?.get(), memberCounts?.get(), memberLists?.get(), threadLists?.get()], () => 0);
    const guildId0 = tooltipGuildId;
    const channelId = isTooltip ? undefined : selectedChannel?.get()?.getChannelId?.();
    const currentChannel = channelId ? channels?.get()?.getChannel?.(channelId) : undefined;
    const guildId: string | undefined = guildId0 ?? currentChannel?.guild_id;
    const includeVoice = settings.store.voiceActivity && !isTooltip;

    react.useEffect(() => { ensureCount(guildId); }, [guildId]);

    try {
        let voiceCount = 0;
        if (includeVoice && guildId) {
            const states = voiceStates?.get()?.getVoiceStates?.(guildId);
            voiceCount = Object.values(states ?? {}).filter((state: any) => {
                if (!state.channelId) return false;
                const channel = channels?.get()?.getChannel?.(state.channelId);
                return channel && permissions?.get()?.can?.(VIEW_CHANNEL, channel);
            }).length;
        }
        const total = guildId ? memberCounts?.get()?.getMemberCount?.(guildId) : null;
        if (total === null || total === undefined) return null;

        let onlineCount: number | null | undefined = guildId ? online.get(guildId) : null;
        if (!isTooltip && guildId) {
            const groups = memberLists?.get()?.getProps?.(guildId, currentChannel?.id)?.groups as Array<{ id: string; count: number; }> | undefined;
            // An empty list, or one that is only the "unknown" group, means the member list has not loaded yet: keep the number Discord sent.
            if (groups && groups.length >= 1 && !(groups.length === 1 && groups[0].id === "unknown")) onlineCount = onlineFromGroups(groups);
            const sections = threadLists?.get()?.getMemberListSections?.(currentChannel?.id);
            if (sections && Object.keys(sections).length > 0) {
                onlineCount = (Object.values(sections) as any[]).reduce((sum, section) => sum + (section.sectionId === "offline" ? 0 : section.userIds.length), 0);
            }
        }

        if (!styled && context) {
            styled = true;
            context.addStyle(CSS, "member-count");
        }
        const onlineText = onlineCount !== null && onlineCount !== undefined ? number.format(onlineCount) : "?";
        const h = react.createElement;
        const circle = (className: string) => h("svg", { viewBox: "0 0 24 24", className }, h("circle", { cx: 12, cy: 12, r: 8 }));
        const item = (title: string, icon: unknown, valueClass: string, text: string) =>
            h("div", { className: "ac-membercount-container", title }, icon, h("span", { className: valueClass }, text));
        return h("div", { className: `ac-membercount-widget ${isTooltip ? "ac-membercount-tooltip" : "ac-membercount-member-list"}` },
            item(`${onlineText} online in this channel`, circle("ac-membercount-online-count"), "ac-membercount-online", onlineText),
            item(`${number.format(total)} total server members`, circle("ac-membercount-total-count"), "ac-membercount-total", number.format(total)),
            includeVoice && voiceCount > 0
                ? item(`${number.format(voiceCount)} members in voice`,
                    h("svg", { viewBox: "0 0 32 32", fill: "currentColor", className: "ac-membercount-voice-icon" }, h("path", { d: MIC_1 }), h("path", { d: MIC_2 })),
                    "ac-membercount-voice", number.format(voiceCount))
                : null);
    } catch {
        return null;
    }
}

const plugin: PluginCode & { render(): unknown; renderTooltip(guild: { id?: string; } | undefined): unknown; } = {
    settings,

    get patches(): PatchDefinition[] {
        const patches: PatchDefinition[] = [];
        if (settings.store.memberList) {
            patches.push({
                find: "{isSidebarVisible:",
                lazy: true,
                required: false,
                replacements: [{
                    match: /children:\[(\i\.useMemo[^}]+"aria-multiselectable")(?<=className:(\i),.+?)/,
                    replace: "children:[$2?.includes('members')?$self.render():null,$1"
                }]
            });
        }
        if (settings.store.toolTip) {
            patches.push({
                find: "GuildTooltip - ",
                lazy: true,
                required: false,
                replacements: [{ match: /t\["5LwN89"\].{0,100}(?=\])/, replace: "$&,$self.renderTooltip(arguments[0].guild)" }]
            });
        }
        return patches;
    },

    flux: {
        GUILD_MEMBER_LIST_UPDATE: (event: any) => {
            if (typeof event?.guildId !== "string") return;
            online.set(event.guildId, onlineFromGroups(event.groups));
            changed();
        },
        ONLINE_GUILD_MEMBER_COUNT_UPDATE: (event: any) => {
            if (typeof event?.guildId !== "string" || typeof event.count !== "number") return;
            online.set(event.guildId, event.count);
            changed();
        }
    },

    start(ctx) {
        context = ctx;
        voiceStates = ctx.common.VoiceStateStore;
        channels = ctx.common.ChannelStore;
        permissions = ctx.common.PermissionStore;
        selectedChannel = ctx.common.SelectedChannelStore;
        memberCounts = ctx.finders.byStore("GuildMemberCountStore");
        memberLists = ctx.finders.byStore("ChannelMemberStore");
        threadLists = ctx.finders.byStore("ThreadMemberListStore");
        guildChannels = ctx.finders.byStore("GuildChannelStore");
        channelActions = ctx.finders.byProps("preload", "closePrivateChannel");
    },

    stop() {
        context = voiceStates = channels = permissions = selectedChannel = memberCounts = memberLists = threadLists = guildChannels = channelActions = undefined;
        styled = false;
        online.clear();
        asked.clear();
        listeners.clear();
        waiting.length = 0;
    },

    render() {
        return (currentReact() as any).createElement(Widget, {});
    },

    renderTooltip(guild) {
        return (currentReact() as any).createElement(Widget, { isTooltip: true, tooltipGuildId: guild?.id });
    }
};

export default plugin;
