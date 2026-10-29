/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin FriendTags (author Samwich) of Equicord. Differences from the original:
//  - the tags are kept in the plugin's own storage (`ctx.storage`) as plain JSON, not as text in Vencord's DataStore;
//  - the settings page is written with Discord's own button and text input; it lists the people of a tag by name instead of drawing their pictures;
//  - the quick switcher patch looks for the module by `renderInput(){let{selectedIndex:` (the original used a translation key, which Amiricord's patcher cannot look for). The patch
//    was checked against Discord's web build 653945 and matches once. The right-click entry uses `user-context` (Vencord's name, not in the readable part of the build).
// Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

export interface UserTagData {
    tagName: string;
    userIds: string[];
}

const KEY = "tags";

let context: EnginePluginContext | undefined;
let tags: UserTagData[] = [];
// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
let users: { get(): any; } | undefined;
let channels: { get(): any; } | undefined;
let relationships: { get(): any; } | undefined;

/** The names written after `&` in a search: `&friends &work` gives `friends` and `work`. */
export function parseUserTags(text: string): string[] {
    const matches = text.match(/&([^&]+)/g);
    if (!matches) return [];
    return matches.map(match => match.substring(1).trim()).filter(tag => tag !== "");
}

/** The ids of the people in the tags named in a search, among the ones given. */
export function usersWithTags(query: string, saved: UserTagData[], candidates: string[]): string[] {
    const wanted = parseUserTags(query).map(tag => tag.toLowerCase());
    if (wanted.length === 0) return [];
    const chosen = saved.filter(data => data.tagName.length > 0 && data.userIds.length > 0 && wanted.includes(data.tagName.toLowerCase()));
    return [...new Set(candidates)].filter(id => chosen.some(tag => tag.userIds.includes(id)));
}

function save(): void {
    void context?.storage.set(KEY, tags as never);
}

function cleanLoaded(value: unknown): UserTagData[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry: any) => entry && typeof entry.tagName === "string" && Array.isArray(entry.userIds))
        .map((entry: any) => ({ tagName: entry.tagName, userIds: entry.userIds.filter((id: unknown) => typeof id === "string") }));
}

function nameOf(id: string): string | null {
    const user = users?.get()?.getUser?.(id);
    return user ? user.globalName || user.username : null;
}

function Settings() {
    const react = currentReact() as any;
    const h = react.createElement;
    const Input = context?.components.TextInput.get() as any;
    const Button = context?.components.Button.get() as any;
    const Text = context?.components.Text.get() as any;
    const [, redraw] = react.useState(0) as [number, (update: (n: number) => number) => void];
    const refresh = () => redraw(n => n + 1);
    if (!Input || !Button) return null;
    const card = (tag: UserTagData, index: number) => h("div", { key: index, style: { display: "flex", flexDirection: "column", gap: "6px", padding: "10px 0", borderBottom: "1px solid var(--background-modifier-accent, #4e505899)" } },
        Text ? h(Text, { variant: "text-sm/semibold" }, "Name") : null,
        h(Input, { value: tag.tagName, onChange: (value: string) => { tag.tagName = value; save(); refresh(); } }),
        Text ? h(Text, { variant: "text-sm/semibold" }, "People (user IDs, separated by commas)") : null,
        h(Input, { value: tag.userIds.join(", "), onChange: (value: string) => { tag.userIds = value.split(",").map(part => part.trim()).filter(Boolean); save(); refresh(); } }),
        Text ? h(Text, { variant: "text-sm/normal" }, tag.userIds.map(id => nameOf(id) ?? id).join(", ") || "Nobody yet") : null,
        h(Button, { variant: "critical-secondary", onClick: () => { tags = tags.filter(other => other !== tag); save(); refresh(); } }, "Remove"));
    return h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } },
        ...tags.map(card),
        h(Button, { variant: "primary", onClick: () => { tags.push({ tagName: "", userIds: [] }); save(); refresh(); } }, "Add a tag")) as never;
}

const plugin: PluginCode & { queryFriendTags(query: string): unknown[]; } = {
    settingsComponent: Settings as never,

    patches: [{
        find: "renderInput(){let{selectedIndex:",
        replacements: [{
            match: /let\{selectedIndex:\i,results:\i\}=this\.props,\{query:\i\}=this\.state/,
            replace: "if(this.state.query.includes(\"&\")){this.props.results=$self.queryFriendTags(this.state.query);}$&"
        }]
    }],

    queryFriendTags(query: string) {
        const candidates = [...(channels?.get()?.getDMUserIds?.() ?? []), ...(relationships?.get()?.getFriendIDs?.() ?? [])] as string[];
        return usersWithTags(query, tags, candidates).flatMap(id => {
            const user = users?.get()?.getUser?.(id);
            if (!user) return [];
            const name = user.globalName || user.username;
            return [{ type: "USER", record: user, score: 20, comparator: name, sortable: name }];
        });
    },

    async start(ctx) {
        context = ctx;
        users = ctx.common.UserStore;
        channels = ctx.common.ChannelStore;
        relationships = ctx.common.RelationshipStore;
        tags = cleanLoaded(await ctx.storage.get(KEY));
        ctx.contextMenu.addNative("user-context", (children, props) => {
            const user = (props as { user?: any; } | undefined)?.user;
            const parts = ctx.contextMenu.parts();
            const react = ctx.components.react.get() as any;
            if (!user?.id || !parts || !react || tags.length === 0) return;
            const entries = tags.filter(tag => tag.tagName).map(tag => {
                const has = tag.userIds.includes(user.id);
                return react.createElement(parts.MenuItem as any, {
                    id: `friend-tag-${tag.tagName}`, key: `friend-tag-${tag.tagName}`,
                    label: `${has ? "Remove from" : "Add to"} ${tag.tagName}`,
                    action: () => { tag.userIds = has ? tag.userIds.filter(id => id !== user.id) : [...tag.userIds, user.id]; save(); }
                });
            });
            if (entries.length > 0) children.push(react.createElement(parts.MenuItem as any, { id: "friend-tag-group", key: "friend-tag-group", label: "Tag" }, ...entries));
        });
    },

    stop() {
        context = users = channels = relationships = undefined;
        tags = [];
    }
};

export default plugin;
