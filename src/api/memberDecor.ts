/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A short piece of text next to the name of each person in the member list at the right of a server: `ctx.memberDecor.add({ id, text(user), title? })`. It goes away when the
// plugin stops. Written from scratch (TestCord has an API like this, `MemberListDecorators`, built on patches of Discord's code; this one puts the text in the page by hand,
// the way `messageDecor.ts` does, so it patches nothing). Checked live on Discord build 655747: a row is `div[data-list-item-id^="members-"]` (its id is its place in the list, not the person) with
// `div.nameAndDecorators_*` inside it (the name, the OWNER tag, the crown); the text goes at the end of that. Rows of other lists (the friends page, a call) are not touched.
// The text is always set as text, never as HTML. When Discord changes the row, nothing shows (nothing breaks).

import { cleanDecorationText } from "./messageDecor";

export interface MemberDecoration {
    /** Unique among the plugin's own decorations. */
    id: string;
    /** The text to show for this person, or nothing. Asked each time the list is drawn, so keep it quick. */
    text(user: { id: string; }): string | undefined;
    /** A tooltip for the text. */
    title?(user: { id: string; }): string | undefined;
}

export interface PluginMemberDecor {
    /** Adds a decoration. Returns false (and adds nothing) for a bad definition or an id that this plugin already uses. */
    add(decoration: MemberDecoration): boolean;
    /** Draws the decorations again, for when what `text` answers has changed. */
    refresh(): void;
}

export const MAX_MEMBER_DECORATIONS_PER_PLUGIN = 3;
export const MEMBER_DECOR_ATTRIBUTE = "data-amiricord-memberdecor";
const STYLE_NAME = "member-decor";
const SYNC_DELAY_MS = 150;
const BODY_WAIT_MS = 100;
const ROW_PREFIX = "members-";

export const MEMBER_DECOR_CSS = `
[${MEMBER_DECOR_ATTRIBUTE}] { margin-left: 4px; font-size: 0.7rem; font-weight: 600; color: var(--text-muted, #949ba4); white-space: nowrap; flex: none; order: 20; }
`;

/** The id of a person from the address of their avatar ("https://cdn.discordapp.com/avatars/<user id>/<hash>.webp"), or undefined (a default avatar has none). */
export function idFromAvatarUrl(src: string | null | undefined): string | undefined {
    return typeof src === "string" ? /\/avatars\/(\d{15,25})\//.exec(src)?.[1] : undefined;
}

interface FiberLike { return?: FiberLike | null; memoizedProps?: { user?: { id?: unknown; }; } | null; }

/**
 * The person of a member list row. The row's own id is its place in the list, not the person, so the id is read from the avatar address first and, when that has none,
 * from the props of the React component that drew the row (the nearest one that has a `user`; checked live: 6 levels up from the row). Undefined when neither gives one.
 */
export function userIdOfRow(row: Element): string | undefined {
    const fromAvatar = idFromAvatarUrl(row.querySelector("img")?.getAttribute("src"));
    if (fromAvatar) return fromAvatar;
    const key = Object.keys(row).find(name => name.startsWith("__reactFiber$"));
    let fiber = key ? (row as unknown as Record<string, FiberLike | undefined>)[key] : undefined;
    for (let level = 0; fiber && level < 40; level++, fiber = fiber.return ?? undefined) {
        const id = fiber.memoizedProps?.user?.id;
        if (typeof id === "string" && /^\d{5,25}$/.test(id)) return id;
    }
    return undefined;
}

interface Entry { plugin: string; decoration: MemberDecoration; }

export interface MemberDecorPage {
    document: Document;
    MutationObserver: typeof MutationObserver;
    setTimeout(run: () => void, ms: number): unknown;
}

const keyOf = (plugin: string, id: string) => `${plugin}:${id}`;

export class MemberDecorHub {
    private readonly entries = new Map<string, Entry>();
    private observer: MutationObserver | undefined;
    private timer: unknown;
    private styled = false;

    constructor(private readonly page: MemberDecorPage, private readonly addStyle: (css: string, name: string) => void, private readonly onError: (plugin: string, source: string, error: unknown) => void) {}

    add(plugin: string, decoration: MemberDecoration): boolean {
        if (typeof decoration?.id !== "string" || decoration.id.length === 0 || typeof decoration.text !== "function") return false;
        const key = keyOf(plugin, decoration.id);
        if (this.entries.has(key)) return false;
        if ([...this.entries.values()].filter(entry => entry.plugin === plugin).length >= MAX_MEMBER_DECORATIONS_PER_PLUGIN) return false;
        this.entries.set(key, { plugin, decoration });
        this.start();
        this.schedule();
        return true;
    }

    removeAll(plugin: string): void {
        for (const [key, entry] of this.entries) if (entry.plugin === plugin) this.entries.delete(key);
        this.schedule();
        if (this.entries.size === 0) this.stop();
    }

    refresh(): void { this.schedule(); }

    private start(): void {
        if (this.observer) return;
        const body = this.page.document.body as HTMLElement | null;
        if (!body) {
            this.page.setTimeout(() => { if (this.entries.size > 0) this.start(); }, BODY_WAIT_MS);
            return;
        }
        if (!this.styled) { this.styled = true; this.addStyle(MEMBER_DECOR_CSS, STYLE_NAME); }
        this.observer = new this.page.MutationObserver(() => { this.schedule(); });
        this.observer.observe(body, { childList: true, subtree: true });
        this.schedule();
    }

    private stop(): void {
        this.observer?.disconnect();
        this.observer = undefined;
    }

    private schedule(): void {
        if (this.timer !== undefined) return;
        this.timer = this.page.setTimeout(() => { this.timer = undefined; this.sync(); }, SYNC_DELAY_MS);
    }

    private sync(): void {
        const doc = this.page.document;
        // Text left behind by a plugin that stopped.
        for (const element of doc.querySelectorAll(`[${MEMBER_DECOR_ATTRIBUTE}]`)) {
            if (!this.entries.has(element.getAttribute(MEMBER_DECOR_ATTRIBUTE) ?? "")) element.remove();
        }
        if (this.entries.size === 0) return;
        for (const row of doc.querySelectorAll(`[data-list-item-id^="${ROW_PREFIX}"]`)) {
            const id = userIdOfRow(row);
            const line = row.querySelector("[class*=\"nameAndDecorators_\"]");
            if (!id || !line) continue;
            for (const [key, entry] of this.entries) this.place(line, key, entry, id);
        }
    }

    private place(line: Element, key: string, entry: Entry, id: string): void {
        let text: string | undefined;
        let title: string | undefined;
        try {
            text = cleanDecorationText(entry.decoration.text({ id }));
            title = text === undefined ? undefined : cleanDecorationText(entry.decoration.title?.({ id }));
        } catch (error) {
            this.onError(entry.plugin, `member decoration ${entry.decoration.id}`, error);
            text = undefined;
        }
        let element = line.querySelector(`[${MEMBER_DECOR_ATTRIBUTE}="${key}"]`);
        if (text === undefined) { element?.remove(); return; }
        if (!element) {
            element = this.page.document.createElement("span");
            element.setAttribute(MEMBER_DECOR_ATTRIBUTE, key);
            line.append(element);
        }
        if (element.textContent !== text) element.textContent = text;
        if ((element.getAttribute("title") ?? undefined) !== title) {
            if (title === undefined) element.removeAttribute("title");
            else element.setAttribute("title", title);
        }
    }
}

export function buildMemberDecor(hub: MemberDecorHub, plugin: string, onDispose: (callback: () => void) => void): PluginMemberDecor {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(decoration) { return hub.add(plugin, decoration); },
        refresh() { hub.refresh(); }
    };
}
