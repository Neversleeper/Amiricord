/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin MutualGroupDMs (author amia) as found in TestCord's copy of Vencord's plugins. The patches are the original's (the old
// profile window, the new profile window and the old DM side panel). Differences: Discord's own components (`Clickable`, `Avatar`, `ScrollerThin`, `BaseText`, `ErrorBoundary`)
// are not used, the rows are plain elements with Discord's own class names found by their names (`row`, `icon`, `name`, `details`; if they are not found the rows are unstyled
// but work), a group's picture is the CDN address of its icon, the group name is written here, and the style goes in when the first list is drawn.
// NOT checked on a live page: any of the anchors on the current build (all are optional and lazy), and the look.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

type Lazy = { get(): any; } | undefined;

const CSS = `
.ac-mutual-gdms-modal-tab-bar { gap: 0; }
.ac-mutual-gdms-modal-v2-tab-bar { --space-xl: 16px; }
.ac-mutual-gdms-scroller { gap: 12px; margin-inline-start: -12px; }
.ac-mutual-gdms-dm-page-list { gap: 0; margin-inline-start: -8px; }
.ac-mutual-gdms-row { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 4px; cursor: pointer; }
.ac-mutual-gdms-row:hover { background: var(--background-mod-subtle, rgba(128, 128, 128, 0.15)); }
.ac-mutual-gdms-row img { width: 40px; height: 40px; border-radius: 50%; }
.ac-mutual-gdms-scroller-box { overflow-y: auto; max-height: 100%; }
`;

let context: EnginePluginContext | undefined;
let styled = false;
let channels: Lazy;
let users: Lazy;
let relationships: Lazy;
let navigation: Lazy;
let classes: Lazy;
let ExpandableList: any = () => null;

const MUTUALS = "MUTUAL_GDMS";

function ensureStyle(): void {
    if (styled || !context) return;
    styled = true;
    context.addStyle(CSS, "mutual-group-dms");
}

function groupName(channel: any): string {
    if (channel.name) return channel.name;
    return (channel.recipients ?? [])
        .map((id: string) => users?.get()?.getUser?.(id))
        .filter(Boolean)
        .map((user: any) => relationships?.get()?.getNickname?.(user.id) || user.globalName || user.username)
        .join(", ");
}

function mutualGroupDms(userId: string): any[] {
    return (channels?.get()?.getSortedPrivateChannels?.() ?? []).filter((c: any) => c.isGroupDM?.() && c.recipients?.includes(userId));
}

const isBotOrSelf = (user: any) => user?.bot || user?.id === users?.get()?.getCurrentUser?.()?.id;

function rows(dms: any[], onClose?: () => void): unknown[] {
    const react = currentReact() as any;
    const names = classes?.get() ?? {};
    return dms.map(channel => react.createElement("div", {
        key: channel.id,
        className: `ac-mutual-gdms-row ${names.row ?? ""}`,
        role: "button",
        tabIndex: 0,
        onClick: () => {
            onClose?.();
            navigation?.get()?.selectPrivateChannel?.(channel.id);
        }
    },
    channel.icon
        ? react.createElement("img", { alt: "", className: names.icon ?? "", src: `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png?size=64` })
        : react.createElement("div", { className: names.icon ?? "", style: { width: 40, height: 40, borderRadius: "50%", background: "var(--background-mod-strong, rgba(128,128,128,0.3))" } }),
    react.createElement("div", { className: names.details ?? "" },
        react.createElement("div", { className: names.name ?? "" }, groupName(channel)),
        react.createElement("div", { style: { fontSize: 12 } }, `${(channel.recipients?.length ?? 0) + 1} Members`))));
}

const plugin: PluginCode & {
    ExpandableList: unknown;
    getMutualGroupDms(userId: string): any[];
    getProps(props: any): any;
    renderMutualGDMs(props: any): unknown;
    renderDMPageList(props: any): unknown;
} = {
    patches: [
        {
            // The old profile window.
            find: ".BOT_DATA_ACCESS?(",
            lazy: true,
            required: false,
            replacements: [
                { match: /(?<=initialSection:\i=\i\.\i\.USER_INFO,onClose:\i\}=)(\i)/, replace: "$self.getProps($1)" },
                { match: /\(0,\i\.jsx\)\(\i,\{items:\i,section:(\i)/, replace: "$1==='MUTUAL_GDMS'?$self.renderMutualGDMs({...arguments[0],isLegacy:true}):$&" },
                // Discord puts space between the tabs, which pushes ours off the screen.
                { match: /className:\i\.\i(?=,type:"top")/, replace: '$& + " ac-mutual-gdms-modal-tab-bar"' }
            ]
        },
        {
            // The new profile window.
            find: ".WIDGETS?",
            lazy: true,
            required: false,
            replacements: [
                { match: /(?<=items:\i,initialSection:\i,onClose:\i\}=)(\i)/, replace: "$self.getProps($1)" },
                { match: /children:(?=.{0,100}?component:.+?section:(\i))/, replace: "$&$1.section==='MUTUAL_GDMS'?$self.renderMutualGDMs(arguments[0]):" },
                { match: /type:"top",/, replace: '$&className:"ac-mutual-gdms-modal-v2-tab-bar",' }
            ]
        },
        {
            // The old DM side panel.
            find: 'section:"MUTUAL_FRIENDS"',
            lazy: true,
            required: false,
            replacements: [
                { match: /\i\|\|\i(?=\?\(0,\i\.jsxs?\)\(\i\.\i\.Overlay,)/, replace: "$&||$self.getMutualGroupDms(arguments[0].user.id).length>0" },
                {
                    match: /\.openUserProfileModal.+?\)}\)}\)(?<=,(\i)&&(\i)&&(\(0,\i\.jsxs?\)\(\i\.\i,{className:(\i)\.\i}\)).{0,50}?"MUTUAL_FRIENDS".+?)/,
                    replace: "$&,$self.renderDMPageList({user:arguments[0].user,hasDivider:$1||$2,Divider:$3,listStyle:$4.list})"
                },
                { match: /(?=function (\i)\(\i\){let{section:\i,header:\i[^}]+?onExpand:)/, replace: "$self.ExpandableList=$1;" }
            ]
        }
    ],

    start(ctx) {
        context = ctx;
        channels = ctx.common.ChannelStore;
        users = ctx.common.UserStore;
        relationships = ctx.common.RelationshipStore;
        navigation = ctx.finders.byProps("selectPrivateChannel");
        classes = ctx.finders.byProps("row", "icon", "name", "details");
    },

    stop() {
        context = channels = users = relationships = navigation = classes = undefined;
        styled = false;
        ExpandableList = () => null;
    },

    set ExpandableList(value: unknown) {
        ExpandableList = value;
    },

    getMutualGroupDms(userId) {
        try {
            return mutualGroupDms(userId);
        } catch (error) {
            context?.reportError("MutualGroupDMs", error);
            return [];
        }
    },

    getProps(props) {
        try {
            if (isBotOrSelf(props.user)) return props;
            const count = mutualGroupDms(props.user.id).length;
            const section = { text: `${count === 0 ? "No" : count} Mutual Group${count !== 1 ? "s" : ""}`, section: MUTUALS };
            return { ...props, items: [...props.items, section] };
        } catch (error) {
            context?.reportError("MutualGroupDMs", error);
            return props;
        }
    },

    renderMutualGDMs({ user, onClose, isLegacy }) {
        const react = currentReact() as any;
        try {
            ensureStyle();
            const entries = rows(mutualGroupDms(user.id), onClose);
            return react.createElement("div", { className: `ac-mutual-gdms-scroller-box ${isLegacy ? "" : "ac-mutual-gdms-scroller"}` },
                entries.length > 0 ? entries : react.createElement("div", { style: { padding: 16 } }, "You don't have any group chats in common"));
        } catch (error) {
            context?.reportError("MutualGroupDMs", error);
            return null;
        }
    },

    renderDMPageList({ user, hasDivider, Divider, listStyle }) {
        const react = currentReact() as any;
        try {
            const dms = mutualGroupDms(user.id);
            if (dms.length === 0) return null;
            ensureStyle();
            return react.createElement(react.Fragment, null,
                hasDivider ? Divider : null,
                react.createElement(ExpandableList, { listClassName: `${listStyle ?? ""} ac-mutual-gdms-dm-page-list`, header: "Mutual Groups", isLoading: false, items: rows(dms) }));
        } catch (error) {
            context?.reportError("MutualGroupDMs", error);
            return null;
        }
    }
};

export default plugin;
