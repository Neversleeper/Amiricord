/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the window is built with React's createElement, which has no types here (as in ProfilePresets) */

// Adapted for Amiricord (2026) from the plugin MutualServerMembers (by Neversleeper, who posted it in TestCord as nnenaza) as found in TestCord.
// Pick two of your servers (or type two server ids) and see which people are members of both. It uses only the members Discord already has in memory (the ones
// you have seen by opening the member list), so open the member list of both servers first for a fuller answer; nothing is asked of Discord's servers.
// Differences, NOT verified in a real Discord:
//  - the item "Mutual Server Members" is added to the right-click menu of a server's icon in the server list by the engine's own menu items (Discord's menu is not
//    patched): the engine only tells the plugin what was clicked, so the server is read from the `data-list-item-id="guildsnav___<id>"` that Discord puts on each
//    icon (seen in the code of build 653945). `/mutual-servers` opens the same window from the chat box, which does not depend on that;
//  - the window is one window with two steps (pick, then results) instead of two; the servers are two plain lists; the member ids come from the member store's
//    `getMemberIds` (found in the code of build 653945) instead of building every member first.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

const SNOWFLAKE = /^\d{15,25}$/;
const SERVER_ICON = "[data-list-item-id^=\"guildsnav___\"]";

/** The id of the server whose icon in the server list was clicked, or undefined when the click was elsewhere. */
export function guildIdFromTarget(target: { closest?(selector: string): { getAttribute(name: string): string | null; } | null; } | null | undefined): string | undefined {
    const icon = target?.closest?.(SERVER_ICON);
    const id = icon?.getAttribute("data-list-item-id")?.split("___")[1];
    return id !== undefined && SNOWFLAKE.test(id) ? id : undefined;
}

/** The ids that are in both lists, in the order of the second one, each once. */
export function mutualIds(first: readonly string[], second: readonly string[]): string[] {
    const inFirst = new Set(first);
    const seen = new Set<string>();
    const both: string[] = [];
    for (const id of second) {
        if (inFirst.has(id) && !seen.has(id)) { seen.add(id); both.push(id); }
    }
    return both;
}

export interface Member { id: string; name: string; bot: boolean; avatar: string; }

/** The address of a picture on Discord's own image host: the person's own when there is one, else the default one that goes with the id. */
export function avatarFor(id: string, hash: unknown): string {
    if (typeof hash === "string" && /^(a_)?[0-9a-f]{16,40}$/.test(hash) && SNOWFLAKE.test(id)) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=32`;
    const index = SNOWFLAKE.test(id) ? Number((BigInt(id) >> 22n) % 6n) : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** The members to show: bots only when asked for, the text found anywhere in the name (any case), sorted by name. */
export function visibleMembers(members: readonly Member[], search: string, showBots: boolean): Member[] {
    const wanted = search.trim().toLowerCase();
    return members.filter(member => (showBots || !member.bot) && member.name.toLowerCase().includes(wanted)).sort((a, b) => a.name.localeCompare(b.name));
}

interface Stores {
    members: { getMemberIds?(guildId: string): string[]; };
    guilds: { getGuilds?(): Record<string, { id: string; name: string; }>; getGuild(id: string): { id: string; name?: string; } | undefined; };
    users: { getUser(id: string): { globalName?: string; username?: string; bot?: boolean; avatar?: string; } | undefined; };
}

let found: (() => Stores) | undefined;
let context: EnginePluginContext | undefined;

const memberIds = (guildId: string): string[] => {
    const ids = found?.().members.getMemberIds?.(guildId);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
};

const guildName = (id: string): string => found?.().guilds.getGuild(id)?.name ?? id;

const yourGuilds = (): Array<{ id: string; name: string; }> => {
    const all = found?.().guilds.getGuilds?.() ?? {};
    return Object.values(all).map(guild => ({ id: guild.id, name: guild.name })).sort((a, b) => a.name.localeCompare(b.name));
};

function membersOf(ids: readonly string[]): Member[] {
    const users = found?.().users;
    return ids.map(id => {
        const user = users?.getUser(id);
        return { id, name: user?.globalName ?? user?.username ?? id, bot: user?.bot === true, avatar: avatarFor(id, user?.avatar) };
    });
}

function MutualWindow({ fixedGuildId }: { fixedGuildId?: string; }) {
    const react = currentReact() as any;
    const h = react.createElement;
    const guilds = react.useMemo(() => yourGuilds(), []) as Array<{ id: string; name: string; }>;
    const [first, setFirst] = react.useState(fixedGuildId ?? "") as [string, (v: string) => void];
    const [second, setSecond] = react.useState("") as [string, (v: string) => void];
    const [manual, setManual] = react.useState(false) as [boolean, (v: boolean) => void];
    const [typedFirst, setTypedFirst] = react.useState("") as [string, (v: string) => void];
    const [typedSecond, setTypedSecond] = react.useState("") as [string, (v: string) => void];
    const [result, setResult] = react.useState(null) as [{ a: string; b: string; members: Member[]; } | null, (v: { a: string; b: string; members: Member[]; } | null) => void];
    const [search, setSearch] = react.useState("") as [string, (v: string) => void];
    const [showBots, setShowBots] = react.useState(false) as [boolean, (v: boolean) => void];

    const compare = () => {
        const a = (manual ? typedFirst : first).trim();
        const b = (manual ? typedSecond : second).trim();
        if (!SNOWFLAKE.test(a) || !SNOWFLAKE.test(b)) { context?.toasts.show("Pick or type two servers.", "failure"); return; }
        if (a === b) { context?.toasts.show("Pick two different servers.", "failure"); return; }
        setResult({ a, b, members: membersOf(mutualIds(memberIds(a), memberIds(b))) });
    };

    const field = { padding: "4px 8px", width: "100%", boxSizing: "border-box" } as const;
    const button = (label: string, onClick: () => void) => h("button", { type: "button", onClick, style: { cursor: "pointer", padding: "4px 10px" } }, label);
    const pick = (value: string, onChange: (v: string) => void, label: string) => h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" } }, label,
        h("select", { value, onChange: (e: any) => onChange(e.target.value), style: field }, h("option", { value: "" }, "- pick a server -"), ...guilds.map(guild => h("option", { key: guild.id, value: guild.id }, guild.name))));
    const type = (value: string, onChange: (v: string) => void, label: string) => h("label", { style: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px" } }, label,
        h("input", { value, placeholder: "server id", maxLength: 25, onChange: (e: any) => onChange(e.target.value), style: field }));

    const frame = (...children: unknown[]) => h("div", { style: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px", color: "var(--text-default, var(--text-normal, #dbdee1))" } }, ...children);

    if (!result) {
        return frame(
            h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: 0 } }, "Compare servers"),
            h("div", { style: { display: "flex", gap: "8px" } }, manual ? type(typedFirst, setTypedFirst, "Server A id") : pick(first, setFirst, "Server A"), manual ? type(typedSecond, setTypedSecond, "Server B id") : pick(second, setSecond, "Server B")),
            h("div", { style: { display: "flex", gap: "8px" } }, button("Compare members", compare), button(manual ? "Use the lists" : "Type server ids", () => setManual(!manual))));
    }

    const shown = visibleMembers(result.members, search, showBots);
    return frame(
        h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: 0 } }, `Mutual members (${shown.length})`),
        h("span", { style: { fontSize: "13px", opacity: 0.8 } }, `${guildName(result.a)} and ${guildName(result.b)}`),
        h("div", { style: { display: "flex", gap: "8px" } },
            h("input", { value: search, placeholder: "Search members...", onChange: (e: any) => setSearch(e.target.value), style: { ...field, flex: 1 } }),
            button(showBots ? "Hide bots" : "Show bots", () => setShowBots(!showBots))),
        h("div", { style: { maxHeight: "340px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" } },
            shown.length === 0
                ? h("div", { style: { textAlign: "center", opacity: 0.7, padding: "24px 0" } }, result.members.length === 0 ? "No cached members found. Open the member list of both servers first." : "No members match your search.")
                : shown.map(member => h("div", { key: member.id, style: { display: "flex", alignItems: "center", gap: "10px", padding: "4px 6px" } },
                    h("img", { src: member.avatar, alt: "", width: 32, height: 32, style: { borderRadius: "50%", flex: "none" } }),
                    h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, member.name),
                    member.bot ? h("span", { style: { fontSize: "10px", fontWeight: 700, opacity: 0.7 } }, "BOT") : null))),
        h("span", { style: { fontSize: "12px", opacity: 0.7 } }, "Only the members Discord already has in memory count: open the member list of both servers for a fuller answer."),
        button("Back", () => setResult(null)));
}

function openWindow(ctx: EnginePluginContext, fixedGuildId?: string): void {
    const react = currentReact() as any;
    const h = react.createElement;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) { ctx.toasts.show("The window could not be opened.", "failure"); return; }
    ctx.modals.open(props => h(Root, { size: "medium", onClose: props.onClose, label: "Mutual server members" }, h(Content, null, h(MutualWindow, { fixedGuildId })), Close ? h(Close, { onClick: props.onClose }) : null));
}

const plugin: PluginCode = {
    start(ctx) {
        context = ctx;
        const members = ctx.common.GuildMemberStore;
        const guilds = ctx.common.GuildStore;
        const users = ctx.common.UserStore;
        found = () => ({
            members: (members.get() ?? {}) as unknown as Stores["members"],
            guilds: (guilds.get() ?? { getGuild: () => undefined }) as unknown as Stores["guilds"],
            users: (users.get() ?? { getUser: () => undefined }) as unknown as Stores["users"]
        });
        ctx.menuItems.add("mutual-members", click => {
            const guildId = guildIdFromTarget(click.target as unknown as Parameters<typeof guildIdFromTarget>[0]);
            return guildId ? { label: "Mutual Server Members", action: () => { openWindow(ctx, guildId); } } : null;
        });
        ctx.commands.add({
            name: "mutual-servers",
            description: "Compare two of your servers and see who is in both",
            execute() { openWindow(ctx); }
        });
    },

    stop() {
        context = undefined;
        found = undefined;
    }
};

export default plugin;
