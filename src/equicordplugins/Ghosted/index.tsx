/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin Ghosted (authors vei, sadan, justjxke and iamme) of Equicord. Differences from the original:
//  - the counter at the top of the server list uses Amiricord's `ctx.serverList` instead of Vencord's ServerList API;
//  - the list of ghosted people is a window of Amiricord's own (Discord's components, no avatars for group chats: a letter is drawn instead);
//  - the "unghost" entries use `ctx.contextMenu.addNative` with `gdm-context` and `user-context` (Vencord's names, not in the readable part of Discord's build) and are added at the
//    end of the menu, not in the group of "leave" / "close DM";
//  - Discord only keeps messages of the chats that were opened, so for the others the last message is asked once (limit 1, one chat every 0.4 s, only for the chats drawn in the list).
// The patch (module with `PrivateChannel.renderAvatar`) was checked against Discord's web build 653945 and matches once. Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showIndicator: { type: "boolean", default: true, description: "Show the ghost counter at the top of the server list." },
    showDmIcons: { type: "boolean", default: true, description: "Show a ghost next to each direct message that waits for an answer." },
    ignoreGroupDms: { type: "boolean", default: false, description: "Leave group chats out." },
    exemptedChannels: { type: "string", default: "", description: "Channel IDs to leave out, separated by commas." },
    ignoreBots: { type: "boolean", default: true, description: "Ignore direct messages from bots." },
    maxInactiveTimeMs: {
        type: "select", default: 0, description: "Only count direct messages that were active within this time.",
        options: [
            { label: "No limit", value: 0 },
            { label: "1 hour", value: 60 * 60 * 1000 },
            { label: "1 day", value: 24 * 60 * 60 * 1000 },
            { label: "1 week", value: 7 * 24 * 60 * 60 * 1000 },
            { label: "1 month", value: 30 * 24 * 60 * 60 * 1000 }
        ]
    }
});

const CSS = `
.vc-boo-icon { height: 42px; }
#vc-boo-container { display: flex; flex-direction: row; align-items: center; justify-content: center; background-color: var(--background-base-lower, var(--background-primary)); height: 30px; width: 48px; margin-left: auto; margin-right: auto; color: var(--text-default, currentColor); fill: var(--text-default, currentColor); }
.vc-boo-clickable { cursor: pointer; transition: opacity 0.2s ease; }
.vc-boo-clickable:hover { opacity: 0.8; }
.vc-boo-clickable:active { opacity: 0.6; }
.vc-boo-ghosted-entry { padding: 12px; cursor: pointer; border-radius: 8px; margin-bottom: 8px; background-color: var(--background-secondary-alt, rgba(128,128,128,0.15)); display: flex; align-items: center; gap: 8px; }
.vc-boo-ghosted-entry:hover { background-color: var(--background-mod-subtle, rgba(128,128,128,0.25)); }
.vc-boo-user-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.vc-boo-modal-content { padding: 16px; }
.vc-boo-modal-text { color: var(--text-muted); }
.vc-boo-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; display: flex; align-items: center; justify-content: center; background: var(--background-mod-strong, #4e5058); color: var(--text-default, #fff); }
`;

let context: EnginePluginContext | undefined;
// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
let messageStore: { get(): any; } | undefined;
let userStore: { get(): any; } | undefined;
let channelStore: { get(): any; } | undefined;
let channelActions: { get(): any; } | undefined;
let wrapperClasses: { get(): any; } | undefined;
let rest: { get(): any; } | undefined;

/** The last message of a direct message that Discord has not loaded into its message store, asked once per message id (the store only holds the chats that were opened). */
const fetched = new Map<string, any>();
const asked = new Map<string, string>();
const waiting: Array<() => Promise<void>> = [];
let draining = false;

async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    while (waiting.length > 0) {
        await waiting.shift()!();
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    draining = false;
}

function askLastMessage(channelId: string, lastMessageId: string, done: () => void): void {
    if (asked.get(channelId) === lastMessageId) return;
    asked.set(channelId, lastMessageId);
    waiting.push(async () => {
        try {
            const answer = await rest?.get()?.get({ url: `/channels/${channelId}/messages`, query: { limit: 1 }, retries: 1 });
            const message = answer?.body?.[0];
            if (message) {
                fetched.set(channelId, message);
                done();
            }
        } catch {
            // Discord refused or the network failed: the ghost for that chat just does not show until it is opened.
        }
    });
    void drain();
}

const countedChannels = new Set<string>();
/** Channels the person cleared by hand, with the id of the last message at that moment: a newer message from the other person brings the ghost back. */
const clearedChannels = new Map<string, string>();
const clearedListeners = new Set<(channelId: string) => void>();
const countListeners = new Set<(count: number) => void>();
let booCount = 0;

function setBooCount(count: number): void {
    booCount = count;
    for (const listener of countListeners) listener(count);
}

export function getGhostedChannels(): string[] {
    return Array.from(countedChannels);
}

export function clearChannelFromGhost(channelId: string): void {
    if (!countedChannels.has(channelId)) return;
    countedChannels.delete(channelId);
    setBooCount(booCount - 1);
    const lastMessage = messageStore?.get()?.getMessages?.(channelId)?.last?.();
    if (lastMessage) clearedChannels.set(channelId, lastMessage.id);
    for (const listener of clearedListeners) listener(channelId);
}

/** Whether a channel is left out, by id or because it is a group chat and group chats are ignored. */
export function isExempted(exempted: string, ignoreGroups: boolean, channel: { id: string; isGroupDM?(): boolean; }): boolean {
    const ids = exempted.split(",").map(id => id.trim()).filter(id => id.length > 0);
    return ids.includes(channel.id) || (ignoreGroups && Boolean(channel.isGroupDM?.()));
}

/** Re-draws the caller when one of the stores changes, like Discord's own hook. */
function useStores<T>(stores: any[], read: () => T): T {
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

function IconGhost({ fill }: { fill: string; }) {
    const react = currentReact() as any;
    return react.createElement("svg", { xmlns: "http://www.w3.org/2000/svg", width: "1.5em", height: "1.5em", viewBox: "0 0 24 24" },
        react.createElement("path", { fill, d: "M12 4a7 7 0 0 0-7 7v8.62a.4.4 0 0 0 .594.35l.943-.523a4 4 0 0 1 3.927.023l.544.311a2 2 0 0 0 1.984 0l.544-.31a4 4 0 0 1 3.927-.024l.943.523a.4.4 0 0 0 .594-.35V11a7 7 0 0 0-7-7m-9 7a9 9 0 0 1 18 0v8.62c0 1.83-1.966 2.987-3.565 2.099l-.943-.524a2 2 0 0 0-1.964.012l-.543.31a4 4 0 0 1-3.97 0l-.543-.31a2 2 0 0 0-1.964-.012l-.942.524C4.966 22.607 3 21.45 3 19.62zm7.5-.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0M15 12a1.5 1.5 0 1 0 0-3a1.5 1.5 0 0 0 0 3" }));
}

function Boo({ channel }: { channel: any; }) {
    const react = currentReact() as any;
    const id: string = channel.id;
    const currentUserId: string | undefined = useStores([userStore?.get()], () => userStore?.get()?.getCurrentUser?.()?.id);
    const stored: any = useStores([messageStore?.get()], () => messageStore?.get()?.getMessages?.(id)?.last?.());
    const [, redraw] = react.useState(0) as [number, (update: (n: number) => number) => void];
    const lastMessageId: string | undefined = channel.lastMessageId ?? undefined;
    const lastMessage: any = stored ?? fetched.get(id);

    react.useEffect(() => {
        if (stored || !lastMessageId || fetched.get(id)?.id === lastMessageId) return;
        askLastMessage(id, lastMessageId, () => redraw(n => n + 1));
    }, [id, lastMessageId, Boolean(stored)]);

    const timestamp = lastMessage ? new Date(lastMessage.timestamp).getTime() : 0;
    const limit = Number(settings.store.maxInactiveTimeMs);
    const inactive = Boolean(lastMessage) && limit > 0 && Number.isFinite(timestamp) && Date.now() - timestamp > limit;
    const fromMe = Boolean(lastMessage) && lastMessage.author?.id === currentUserId;
    const left = isExempted(String(settings.store.exemptedChannels), Boolean(settings.store.ignoreGroupDms), channel) || (settings.store.ignoreBots && Boolean(lastMessage?.author?.bot)) || inactive;

    react.useEffect(() => {
        const listener = (changed: string) => { if (changed === id) redraw(n => n + 1); };
        clearedListeners.add(listener);
        return () => { clearedListeners.delete(listener); };
    }, [id]);

    react.useEffect(() => {
        if (!lastMessage || !currentUserId) return;
        if (fromMe) {
            if (countedChannels.delete(id)) setBooCount(booCount - 1);
            clearedChannels.delete(id);
            return;
        }
        const clearedAt = clearedChannels.get(id);
        if (clearedAt !== undefined) {
            if (clearedAt === lastMessage.id) return;
            clearedChannels.delete(id);
            for (const listener of clearedListeners) listener(id);
        }
        if (left) {
            if (countedChannels.delete(id)) setBooCount(booCount - 1);
            return;
        }
        if (!countedChannels.has(id)) {
            countedChannels.add(id);
            setBooCount(booCount + 1);
        }
    }, [id, lastMessage?.id, currentUserId, fromMe, left]);

    if (!lastMessage || !currentUserId || fromMe || left || clearedChannels.has(id) || !settings.store.showDmIcons) return null;
    const hasQuestion = String(lastMessage.content ?? "").includes("?");
    return react.createElement("div", { className: `vc-boo-icon ${wrapperClasses?.get()?.wrapper ?? ""}` }, react.createElement(IconGhost, { fill: hasQuestion ? "#ff8000" : "currentColor" }));
}

/** The name of a direct message for the list and the tooltip. */
export function channelName(channel: any, getUser: (id: string) => any): string {
    if (!channel) return "Unknown";
    if (channel.isGroupDM?.()) return channel.name || "Unnamed Group";
    return getUser(channel.recipients?.[0] ?? "")?.username || "Unknown User";
}

function nameOf(channelId: string): string {
    return channelName(channelStore?.get()?.getChannel?.(channelId), id => userStore?.get()?.getUser?.(id));
}

function openList(ctx: EnginePluginContext): void {
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Button = ctx.components.Button.get() as any;
    const Text = ctx.components.Text.get() as any;
    if (!Root || !Content) return;
    const react = currentReact() as any;
    const h = react.createElement;
    ctx.modals.open(props => {
        const List = () => {
            const [ids, setIds] = react.useState(getGhostedChannels()) as [string[], (value: string[]) => void];
            const rows = ids.map(channelId => {
                const channel = channelStore?.get()?.getChannel?.(channelId);
                if (!channel) return null;
                const last = messageStore?.get()?.getMessages?.(channelId)?.last?.() ?? fetched.get(channelId);
                const date = last?.timestamp ? new Date(last.timestamp).toLocaleDateString() : "";
                const name = nameOf(channelId);
                const picture = channel.isGroupDM?.()
                    ? (channel.icon ? `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png` : null)
                    : userStore?.get()?.getUser?.(channel.recipients?.[0] ?? "")?.getAvatarURL?.(undefined, 128, true) ?? null;
                return h("div", { key: channelId, className: "vc-boo-ghosted-entry", onClick: () => { channelActions?.get()?.selectPrivateChannel?.(channelId); props.onClose(); } },
                    picture ? h("img", { className: "vc-boo-avatar", src: picture, alt: "" }) : h("div", { className: "vc-boo-avatar" }, name.slice(0, 1).toUpperCase()),
                    h("div", { className: "vc-boo-user-info" }, h("span", null, name), date ? h("span", { className: "vc-boo-modal-text" }, date) : null),
                    Button ? h(Button, { variant: "secondary", size: "small", onClick: (event: any) => { event?.stopPropagation?.(); clearChannelFromGhost(channelId); setIds(ids.filter(other => other !== channelId)); } }, "Clear") : null);
            });
            return h("div", { className: "vc-boo-modal-content" },
                Text ? h(Text, { variant: "heading-lg/semibold" }, `Ghosted Users (${ids.length})`) : h("strong", null, `Ghosted Users (${ids.length})`),
                ids.length === 0 ? h("div", null, "No ghosts here!") : rows,
                ids.length > 0 && Button ? h(Button, { variant: "primary", onClick: () => { ids.forEach(clearChannelFromGhost); setIds([]); } }, "Clear All") : null);
        };
        return h(Root, { size: "medium", onClose: props.onClose, label: "Ghosted users" }, h(Content, null, h(List)));
    });
}

function BooIndicator() {
    const react = currentReact() as any;
    const [count, setCount] = react.useState(booCount) as [number, (value: number) => void];
    react.useEffect(() => {
        countListeners.add(setCount);
        return () => { countListeners.delete(setCount); };
    }, []);
    const ids = getGhostedChannels();
    if (!settings.store.showIndicator || ids.length === 0 || !context) return null;
    const ctx = context;
    const tip = ids.length <= 5 ? ids.map(nameOf).join(", ") : `${ids.length} Ghosted Users`;
    return react.createElement("div", { id: "vc-boo-container", className: "vc-boo-clickable", title: tip, onClick: () => openList(ctx) }, count, react.createElement(IconGhost, { fill: "currentColor" }));
}

const plugin: PluginCode & { renderBoo(props: { channel: any; }): unknown; } = {
    settings,

    patches: [{
        find: "PrivateChannel.renderAvatar",
        replacements: [{ match: /\]:\i\|\|\i.{0,50}children:\[/, replace: "$&$self.renderBoo(arguments[0])," }]
    }],

    renderBoo(props) {
        const react = currentReact() as any;
        return react.createElement(Boo, props);
    },

    start(ctx) {
        context = ctx;
        messageStore = ctx.common.MessageStore;
        userStore = ctx.common.UserStore;
        channelStore = ctx.common.ChannelStore;
        channelActions = ctx.finders.byProps("selectPrivateChannel");
        wrapperClasses = ctx.finders.byProps("muted", "wrapper");
        rest = ctx.finders.byProps("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        ctx.addStyle(CSS, "ghosted");
        ctx.serverList.add("above", BooIndicator);

        const item = (children: unknown[], props: unknown) => {
            const channel = (props as { channel?: any; } | undefined)?.channel;
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!channel?.id || !parts || !react) return;
            children.push(react.createElement(parts.MenuItem as any, { id: "ghosted-clear", key: "ghosted-clear", label: "unghost", action: () => clearChannelFromGhost(channel.id) }));
        };
        ctx.contextMenu.addNative("gdm-context", item);
        ctx.contextMenu.addNative("user-context", item);
    },

    stop() {
        context = messageStore = userStore = channelStore = channelActions = wrapperClasses = rest = undefined;
        fetched.clear();
        asked.clear();
        waiting.length = 0;
        countedChannels.clear();
        clearedChannels.clear();
        clearedListeners.clear();
        countListeners.clear();
        booCount = 0;
    }
};

export default plugin;
