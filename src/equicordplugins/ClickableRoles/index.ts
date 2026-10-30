/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ClickableRoles (author prism) as found in Equicord. Click a role in a profile or a role's title in the member list and a small
// list shows up with the people who have it (the first 20 and how many more); click one and their profile opens.
// What was checked against the real code of Discord (build 653945, in the page of a running Discord): the two patch points exist and each regular expression matches once or
// twice as expected - the role pill (found by its fixed text `overflowOnly:!0,ariaHidden:!0`; its props are `{role, guildId}`) and the titles of the groups of the member list
// (`tutorialId:"whos-online"`, group props `{id, guildId}`); the address `/guilds/{guild}/roles/{role}/member-ids` and Discord's `requestMembersById` and
// `openUserProfileModal` exist in its code. Differences from the original, which draws Discord's Popout: the list is a plain element added to the page by hand (no React
// portal is available), placed beside the clicked role and closed with a click outside or Escape; the wrapper element uses `display: contents`, so it changes no layout.
// NOT seen working in a real Discord with a click yet.

import { currentReact } from "../../api/jsxRuntime";
import type { StyleHandle } from "../../api/styles";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

export const MAX_VISIBLE_MEMBERS = 20;
export const CACHE_MS = 60_000;
const SNOWFLAKE = /^\d{15,25}$/;

/** The ids of a role's members as Discord answers (a list of text ids): only well-formed ids, each once. */
export function readMemberIds(body: unknown): string[] {
    if (!Array.isArray(body)) return [];
    return [...new Set(body.filter((id): id is string => typeof id === "string" && SNOWFLAKE.test(id)))];
}

/** What the list shows of the ids: the first ones, and how many more there are. */
export function splitVisible(ids: readonly string[], limit = MAX_VISIBLE_MEMBERS): { visible: string[]; more: number; } {
    return { visible: ids.slice(0, limit), more: Math.max(0, ids.length - limit) };
}

export const memberIdsUrl = (guildId: string, roleId: string) => `/guilds/${guildId}/roles/${roleId}/member-ids`;

/** A picture address for a person: their own on Discord's picture server, or one of the six default ones. */
export function avatarOf(user: { id: string; avatar?: string | null; } | undefined): string {
    if (user?.avatar && /^(?:a_)?[0-9a-f]{20,40}$/.test(user.avatar) && SNOWFLAKE.test(user.id)) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=48`;
    const index = user && SNOWFLAKE.test(user.id) ? Number((BigInt(user.id) >> 22n) % 6n) : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

interface Rest { get(request: { url: string; }): Promise<{ body?: unknown; }>; }
interface GuildActions { requestMembersById(guildId: string, ids: string[], withPresences?: boolean): unknown; }
interface UserLike { id: string; username?: string; globalName?: string | null; avatar?: string | null; }
interface RoleLike { name?: string; colorString?: string | null; }

const CSS = `
.amiricord-clickableroles-trigger { display: contents; cursor: pointer; }
.amiricord-clickableroles-popout { position: fixed; z-index: 10000; box-sizing: border-box; width: 250px; max-height: 350px; padding: 12px; border-radius: 8px; display: flex; flex-direction: column; background: var(--background-surface-highest, var(--background-floating, #1e1f22)); color: var(--interactive-text-default, var(--text-default, #dbdee1)); box-shadow: 0 8px 24px rgba(0, 0, 0, .4); }
.amiricord-clickableroles-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.amiricord-clickableroles-color { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.amiricord-clickableroles-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amiricord-clickableroles-count { margin-left: auto; font-size: 12px; color: var(--text-muted, #949ba4); }
.amiricord-clickableroles-list { min-height: 0; max-height: 260px; overflow-y: auto; }
.amiricord-clickableroles-empty { padding: 8px; text-align: center; font-size: 13px; color: var(--text-muted, #949ba4); }
.amiricord-clickableroles-user { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 14px; }
.amiricord-clickableroles-user:hover { background: var(--interactive-background-hover, rgba(255, 255, 255, .07)); }
.amiricord-clickableroles-avatar { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
.amiricord-clickableroles-more { padding: 6px; text-align: center; font-size: 12px; color: var(--text-muted, #949ba4); }
`;

let context: EnginePluginContext | undefined;
let styleHandle: StyleHandle | undefined;
let rest: { get(): Rest | undefined; } | undefined;
let guildActions: { get(): GuildActions | undefined; } | undefined;
let profileActions: { get(): { openUserProfileModal?(options: { userId: string; guildId?: string; }): unknown; } | undefined; } | undefined;
let userStore: { get(): { getUser(id: string): UserLike | undefined; } | undefined; } | undefined;
let roleStore: { get(): { getRole(guildId: string, roleId: string): RoleLike | undefined; } | undefined; } | undefined;
let closeCurrent: (() => void) | undefined;
const memberCache = new Map<string, { ids: string[]; at: number; }>();

async function memberIds(guildId: string, roleId: string): Promise<string[]> {
    const key = `${guildId}-${roleId}`;
    const cached = memberCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.ids;
    const answer = await rest?.get()?.get({ url: memberIdsUrl(guildId, roleId) });
    const ids = readMemberIds(answer?.body);
    memberCache.set(key, { ids, at: Date.now() });
    return ids;
}

function element(page: Document, tag: string, className: string, text?: string): HTMLElement {
    const made = page.createElement(tag);
    made.className = `amiricord-clickableroles-${className}`;
    if (text !== undefined) made.textContent = text;
    return made;
}

/** Shows the list of the members of a role beside `anchor`; a second click elsewhere, or Escape, closes it. Built with plain page elements and text only (no markup is ever parsed). */
async function openList(anchor: Element, guildId: string, roleId: string) {
    closeCurrent?.();
    const page = anchor.ownerDocument;
    const role = roleStore?.get()?.getRole(guildId, roleId);
    const box = element(page, "div", "popout");
    const header = element(page, "div", "header");
    const color = element(page, "span", "color");
    color.style.backgroundColor = role?.colorString ?? "var(--background-mod-strong, #4e5058)";
    const count = element(page, "span", "count");
    header.append(color, element(page, "span", "name", role?.name ?? "Unknown role"), count);
    const list = element(page, "div", "list");
    list.append(element(page, "div", "empty", "Loading members..."));
    box.append(header, list);
    page.body.append(box);

    const rect = anchor.getBoundingClientRect();
    const width = 250;
    const left = rect.right + 8 + width <= page.defaultView!.innerWidth ? rect.right + 8 : Math.max(8, rect.left - 8 - width);
    box.style.left = `${left}px`;
    box.style.top = `${Math.max(8, Math.min(rect.top, page.defaultView!.innerHeight - box.offsetHeight - 8))}px`;

    let alive = true;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const close = () => {
        alive = false;
        for (const timer of timers) clearTimeout(timer);
        page.removeEventListener("mousedown", outside, true);
        page.removeEventListener("keydown", escape, true);
        box.remove();
        if (closeCurrent === close) closeCurrent = undefined;
    };
    const outside = (event: Event) => { if (!box.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    // The click that opened the list is already over; the next mouse press outside closes it.
    page.addEventListener("mousedown", outside, true);
    page.addEventListener("keydown", escape, true);
    closeCurrent = close;

    const draw = (ids: readonly string[], more: number) => {
        list.replaceChildren();
        if (ids.length === 0) { list.append(element(page, "div", "empty", "No members found.")); return; }
        for (const id of ids) {
            const user = userStore?.get()?.getUser(id);
            const row = element(page, "div", "user");
            const picture = element(page, "img", "avatar") as HTMLImageElement;
            picture.src = avatarOf(user ?? { id });
            picture.alt = "";
            row.append(picture, element(page, "span", "", user ? (user.globalName ?? user.username ?? id) : id));
            row.addEventListener("click", () => { close(); profileActions?.get()?.openUserProfileModal?.({ userId: id, guildId }); });
            list.append(row);
        }
        if (more > 0) list.append(element(page, "div", "more", `and ${more} more`));
    };

    try {
        const ids = await memberIds(guildId, roleId);
        if (!alive) return;
        const { visible, more } = splitVisible(ids);
        count.textContent = String(ids.length);
        if (visible.length > 0) guildActions?.get()?.requestMembersById(guildId, visible, false);
        draw(visible, more);
        // Discord sends the people it was asked for a moment later: draw again a few times so their names and pictures replace the ids.
        for (const wait of [400, 1000, 2000]) timers.push(setTimeout(() => { if (alive) draw(visible, more); }, wait));
    } catch (error) {
        if (!alive) return;
        context?.reportError("ClickableRoles", error);
        list.replaceChildren(element(page, "div", "empty", "The members could not be read."));
    }
}

function trigger(guildId: string, roleId: string, child: unknown): unknown {
    const react = currentReact() as { createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown; };
    return react.createElement("div", {
        className: "amiricord-clickableroles-trigger",
        onClick: (event: { currentTarget: Element; target: Element; }) => {
            const anchor = event.currentTarget.firstElementChild ?? event.target;
            void openList(anchor, guildId, roleId);
        }
    }, child);
}

const plugin: PluginCode & {
    wrapRolePill(props: { role?: { id?: string; }; guildId?: string; } | undefined, renderOriginal: () => unknown): unknown;
    RoleGroup(props: { Original: unknown; id?: string; guildId?: string; } & Record<string, unknown>): unknown;
} = {
    patches: [
        {
            // The role pill of a profile: its function ends with `return` of the pill; the pill's own `{role, guildId}` are its first argument.
            find: "overflowOnly:!0,ariaHidden:!0",
            required: false,
            replacements: [{
                match: /(\.colorString\?\?\i;)return(.*?enableTooltip:!1\}\)\}\):null,\i\]\}\))/,
                replace: "$1return $self.wrapRolePill(arguments[0],()=>$2)"
            }]
        },
        {
            // The titles of the groups of the member list ("Online", the roles): each is drawn by a component given `{id, guildId}`.
            find: "tutorialId:\"whos-online\"",
            required: false,
            replacements: [{
                match: /(\i\.\i),\{(?=\.\.\.\i,key:`section-)/g,
                replace: "$self.RoleGroup,{Original:$1,"
            }]
        }
    ],

    wrapRolePill(props, renderOriginal) {
        const original = renderOriginal();
        const roleId = props?.role?.id;
        if (typeof roleId !== "string" || typeof props?.guildId !== "string" || !SNOWFLAKE.test(roleId) || !SNOWFLAKE.test(props.guildId)) return original;
        return trigger(props.guildId, roleId, original);
    },

    RoleGroup({ Original, ...props }) {
        const react = currentReact() as { createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown; };
        const result = react.createElement(Original, props);
        const { id, guildId } = props;
        // The groups "online" and "offline" are not roles: only an id of a role Discord knows gets the click.
        if (typeof id !== "string" || typeof guildId !== "string" || !SNOWFLAKE.test(id) || !roleStore?.get()?.getRole(guildId, id)) return result;
        return trigger(guildId, id, result);
    },

    start(ctx) {
        context = ctx;
        styleHandle = ctx.addStyle(CSS, "clickable-roles");
        rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        guildActions = ctx.finders.byProps<GuildActions>("requestMembersById", "banUser");
        profileActions = ctx.finders.byProps("openUserProfileModal");
        userStore = ctx.common.UserStore as never;
        roleStore = ctx.finders.byStore("GuildRoleStore");
    },

    stop() {
        closeCurrent?.();
        memberCache.clear();
        styleHandle?.remove();
        styleHandle = undefined;
        context = rest = guildActions = profileActions = userStore = roleStore = undefined;
    }
};

export default plugin;
