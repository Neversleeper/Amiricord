/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RoleColorEverywhere (authors KingFish, lewisakura, AutumnVN, Kyuuhachi, jamesbt365) as found in TestCord's copy of Vencord's plugins. The original patches
// seven places of Discord's code; here nothing of Discord's code is touched: the pieces are found in the page and painted with an inline colour, and the colour comes from where the original takes it
// (the member's `colorString`, the role's `colorString`). Places, with how each was read in her running Discord (build 655747):
//  - mentions in messages: `span.mention`, whose React props (a few levels up) hold `user` and `guildId`;
//  - the name in a reply: `username_*` inside `repliedMessage_*`, the props of the reply (13 levels up) hold `referencedMessage`;
//  - (the names in "is typing" are coloured by the plugin Typing Tweaks, which has its own switch for it);
//  - the titles of roles in the member list: `h3.membersGroup_*`, props with the role `id` and `guildId`;
//  - the text of a message (off by default, as in the original): `message-content-*`, mixed with the normal text colour by a percentage.
// Not here: the voice channel list, the list of who reacted, poll results and mentions typed in the message box (their pieces were not seen in the page; the original has them for voice, reactors
// and polls). What was painted is taken away again when the plugin stops or a switch is turned off. Colours are not changed for a person the server gives no colour.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    chatMentions: { type: "boolean", default: true, description: "Colour the mentions of people in messages." },
    replyNames: { type: "boolean", default: true, description: "Colour the name in the line that shows what a message replies to." },
    memberList: { type: "boolean", default: true, description: "Colour the role titles of the member list." },
    colorChatMessages: { type: "boolean", default: false, description: "Colour the text of a message with the colour of its author's top role." },
    messageSaturation: { type: "number", default: 30, min: 0, max: 100, integer: true, description: "How strong the colour of the message text is (0 to 100)." }
});

interface FiberLike { memoizedProps?: Record<string, unknown> | null; return?: FiberLike | null; }

const FIBER_LEVELS = 40;

/** The first props, going up from this element's React node, that the test accepts. */
export function findProps(element: object, test: (props: Record<string, unknown>) => boolean, levels = FIBER_LEVELS): Record<string, unknown> | undefined {
    const key = Object.keys(element).find(name => name.startsWith("__reactFiber"));
    let node: FiberLike | null | undefined = key ? (element as Record<string, FiberLike | undefined>)[key] : undefined;
    for (let level = 0; level < levels && node; level++, node = node.return) {
        const props = node.memoizedProps;
        if (props && typeof props === "object" && test(props)) return props;
    }
    return undefined;
}

/** The colour of a message's text: the role colour mixed with the normal text colour, `percent` strong; undefined when it would show nothing. */
export function messageColor(color: string | null | undefined, percent: number): string | undefined {
    if (!color || !/^#[0-9a-f]{3,8}$/i.test(color) || !(percent > 0)) return undefined;
    return `color-mix(in oklab, ${color} ${Math.min(100, Math.round(percent))}%, var(--text-default))`;
}

interface MemberStore { getMember(guildId: string, userId: string): { colorString?: string | null; } | undefined; }
interface RoleStore { getRole(guildId: string, roleId: string): { colorString?: string | null; } | undefined; }
interface MessageStoreLike { getMessage(channelId: string, id: string): { author?: { id?: string; }; state?: string; } | undefined; }

const MARK = "data-amiricord-role-color";
const SYNC_DELAY_MS = 100;

let stop: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const members = ctx.common.GuildMemberStore;
        const guildSelection = ctx.common.SelectedGuildStore;
        const messages = ctx.common.MessageStore;
        const roles = ctx.finders.byStore<RoleStore>("GuildRoleStore");

        const memberColor = (guildId: unknown, userId: unknown): string | null => {
            if (typeof guildId !== "string" || typeof userId !== "string") return null;
            return (members.get() as unknown as MemberStore | undefined)?.getMember(guildId, userId)?.colorString ?? null;
        };

        /** Paint (or clear) one thing. `kind` says which switch it belongs to so a switch turned off takes its paint away. */
        const paint = (element: HTMLElement, kind: string, color: string | null | undefined, background?: boolean): void => {
            if (!color) {
                if (element.getAttribute(MARK) === kind) {
                    element.style.removeProperty("color");
                    if (background) element.style.removeProperty("background-color");
                    element.removeAttribute(MARK);
                }
                return;
            }
            if (element.style.color !== color) element.style.color = color;
            if (background) element.style.backgroundColor = `color-mix(in srgb, ${color} 10%, transparent)`;
            element.setAttribute(MARK, kind);
        };

        const clearAll = () => {
            for (const element of page.querySelectorAll<HTMLElement>(`[${MARK}]`)) {
                element.style.removeProperty("color");
                element.style.removeProperty("background-color");
                element.removeAttribute(MARK);
            }
        };

        const sync = () => {
            const guildId = guildSelection.get()?.getGuildId();

            for (const mention of page.querySelectorAll<HTMLElement>("li[id^=\"chat-messages-\"] .mention")) {
                if (!settings.store.chatMentions) { paint(mention, "mention", null, true); continue; }
                const props = findProps(mention, candidate => "user" in candidate && "guildId" in candidate, 12);
                const user = props?.user as { id?: unknown; } | undefined;
                paint(mention, "mention", memberColor(props?.guildId, user?.id), true);
            }

            for (const name of page.querySelectorAll<HTMLElement>("li[id^=\"chat-messages-\"] [class*=\"repliedMessage_\"] [class*=\"username\"]")) {
                if (!settings.store.replyNames) { paint(name, "reply", null); continue; }
                const props = findProps(name, candidate => "referencedMessage" in candidate && "baseMessage" in candidate);
                const author = (props?.referencedMessage as { message?: { author?: { id?: unknown; }; }; } | undefined)?.message?.author;
                paint(name, "reply", memberColor(guildId, author?.id));
            }

            for (const header of page.querySelectorAll<HTMLElement>("h3[class*=\"membersGroup\"]")) {
                if (!settings.store.memberList) { paint(header, "header", null); continue; }
                const props = findProps(header, candidate => "id" in candidate && "guildId" in candidate, 8);
                const role = typeof props?.guildId === "string" && typeof props.id === "string" ? roles.get()?.getRole(props.guildId, props.id) : undefined;
                paint(header, "header", role?.colorString);
            }

            const store = messages.get() as unknown as MessageStoreLike | undefined;
            for (const content of page.querySelectorAll<HTMLElement>("li[id^=\"chat-messages-\"] [id^=\"message-content-\"]")) {
                if (!settings.store.colorChatMessages) { paint(content, "message", null); continue; }
                const ids = /^chat-messages-(\d+)-(\d+)$/.exec(content.closest("li")?.id ?? "");
                const message = ids ? store?.getMessage(ids[1], ids[2]) : undefined;
                // A message that failed to send keeps its normal colour, otherwise it could not be told apart.
                const color = message && message.state !== "SEND_FAILED" ? messageColor(memberColor(guildId, message.author?.id), settings.store.messageSaturation) : undefined;
                paint(content, "message", color);
            }
        };

        // The first look is immediate (before the browser draws, so nothing flashes uncoloured); changes that come during the wait are put together into one more look.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let dirty = false;
        const run = () => {
            dirty = false;
            try { sync(); } catch (error) { ctx.reportError("RoleColorEverywhere", error); }
            timer = setTimeout(() => { timer = undefined; if (dirty) run(); }, SYNC_DELAY_MS);
        };
        const schedule = () => { if (timer !== undefined) dirty = true; else run(); };
        const observer = new view.MutationObserver(schedule);
        observer.observe(page.body, { childList: true, subtree: true });
        // A switch changed in the settings is picked up here.
        const poll = view.setInterval(schedule, 2000);
        schedule();

        stop = () => {
            observer.disconnect();
            view.clearInterval(poll);
            if (timer !== undefined) clearTimeout(timer);
            clearAll();
        };
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
