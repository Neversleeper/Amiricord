/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The faces of the people who reacted, drawn next to the number of each reaction under a message, as Vencord's WhoReacted does. The original patches Discord's reaction component and draws
// Discord's `UserSummaryItem`; here nothing of Discord's code is touched: the reactions of a message in the chat are found in the page (`reactions_*` > `reaction_*` > `reactionInner_*`, with the
// emoji picture inside and the number in `reactionCount_*`, read in her running Discord, build 655747), matched to the reactions Discord holds for that message by their emoji, and a small row
// of round avatars (up to five, then "+N") is put after the number. The people come from the same request the right-click window uses, one reaction at a time with 250 ms between requests,
// at most 50 waiting, only for reactions that are on the screen, and again when the number of a reaction changes. A message with more than ten reactions gets none (as in the original).
// Hover an avatar for the name. Clicking an avatar does nothing (it must not add or take away your own reaction, which the button under it would do).

import { hideTip, showTip } from "../../api/tooltip";
import type { EnginePluginContext } from "../../renderer/engine";

export const MAX_FACES = 5;
export const MAX_REACTIONS = 10;
export const MAX_PENDING = 50;
export const GAP_MS = 250;
const SYNC_DELAY_MS = 300;

export interface Person { id: string; username?: string; global_name?: string | null; avatar?: string | null; }
export interface Emoji { id?: string | null; name?: string | null; }

/** The picture of a person: their own avatar, or Discord's default one for their id. */
export function avatarUrl(person: Person): string {
    if (person.avatar) return `https://cdn.discordapp.com/avatars/${person.id}/${person.avatar}.${person.avatar.startsWith("a_") ? "gif" : "webp"}?size=32`;
    let index = 0;
    try { index = Number((BigInt(person.id) >> 22n) % 6n); } catch { /* an id that is not a number: the first default picture */ }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Whether a reaction's emoji is the one drawn as this picture: a custom emoji by its id in the address, a normal one by the character in the picture's text. */
export function emojiMatches(emoji: Emoji, picture: { alt: string; src: string; }): boolean {
    if (emoji.id) return picture.src.includes(`/emojis/${emoji.id}`);
    return emoji.name !== undefined && emoji.name !== null && picture.alt === emoji.name;
}

/** The people to draw and how many are left out. */
export function faces<T>(people: readonly T[], max: number): { shown: T[]; more: number; } {
    const limit = Math.max(1, max);
    return { shown: people.slice(0, limit), more: Math.max(0, people.length - limit) };
}

/** The key Discord's request wants for an emoji (`name` or `name:id`). */
export function emojiKey(emoji: Emoji): string {
    return encodeURIComponent((emoji.name ?? "") + (emoji.id ? `:${emoji.id}` : ""));
}

interface Reaction { emoji: Emoji; count?: number; }
interface Message { reactions?: Reaction[]; }
interface Rest { get(request: { url: string; query?: Record<string, unknown>; oldFormErrors?: boolean; }): Promise<{ body?: Person[]; }>; }
interface Entry { count: number; people: Person[] | undefined; pending: boolean; }

const MARK = "amiricord-who-reacted";
const CSS = `
.${MARK} { display: inline-flex; align-items: center; margin-left: 6px; }
.${MARK} img, .${MARK} span { width: 22px; height: 22px; flex: none; border-radius: 50%; box-sizing: border-box; box-shadow: 0 0 0 2px var(--background-base-lower, var(--background-primary, #313338)); background: var(--background-base-low, #2b2d31); margin-left: -6px; object-fit: cover; }
.${MARK} > :first-child { margin-left: 0; }
.${MARK} span { display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; color: var(--text-muted, #949ba4); }
`;

export function startInline(ctx: EnginePluginContext, enabled: () => boolean): () => void {
    ctx.addStyle(CSS, "who-reacted-faces");
    const page = (globalThis as unknown as { document: Document; }).document;
    const view = page.defaultView!;
    const messages = ctx.common.MessageStore;
    const relationships = ctx.common.RelationshipStore;
    const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
    const cache = new Map<string, Entry>();
    const queue: Array<() => Promise<void>> = [];
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;

    const runQueue = async () => {
        if (running) return;
        running = true;
        while (alive && queue.length > 0) {
            const task = queue.shift()!;
            try { await task(); } catch { /* the reaction is asked for again the next time it is drawn */ }
            await new Promise(resolve => setTimeout(resolve, GAP_MS));
        }
        running = false;
    };

    const ask = (key: string, entry: Entry, channelId: string, messageId: string, emoji: Emoji, count: number) => {
        if (entry.pending || queue.length >= MAX_PENDING) return;
        entry.pending = true;
        queue.push(async () => {
            try {
                const response = await rest.get()?.get({ url: `/channels/${channelId}/messages/${messageId}/reactions/${emojiKey(emoji)}`, query: { limit: 100, type: 0 }, oldFormErrors: true });
                const blocked = relationships.get() as unknown as { isBlockedOrIgnored?(id: string): boolean; } | undefined;
                entry.people = (response?.body ?? []).filter(person => blocked?.isBlockedOrIgnored?.(person.id) !== true);
                entry.count = count;
            } finally {
                entry.pending = false;
                schedule();
            }
        });
        void runQueue();
    };

    const clearAll = () => { for (const mark of page.querySelectorAll(`.${MARK}`)) mark.remove(); };

    const draw = (inner: Element, people: Person[]) => {
        const signature = people.map(person => person.id).join(",");
        const existing = inner.querySelector(`.${MARK}`);
        if (existing?.getAttribute("data-people") === signature) return;
        existing?.remove();
        if (people.length === 0) return;
        const row = page.createElement("div");
        row.className = MARK;
        row.setAttribute("data-people", signature);
        row.addEventListener("click", event => { event.stopPropagation(); event.preventDefault(); });
        const { shown, more } = faces(people, MAX_FACES);
        for (const person of shown) {
            const image = page.createElement("img");
            image.src = avatarUrl(person);
            image.alt = "";
            const name = person.global_name || person.username || person.id;
            image.addEventListener("mouseenter", () => { showTip(image, name); });
            image.addEventListener("mouseleave", hideTip);
            row.append(image);
        }
        if (more > 0) {
            const plus = page.createElement("span");
            plus.textContent = `+${more}`;
            row.append(plus);
        }
        inner.append(row);
    };

    const sync = () => {
        timer = undefined;
        if (!alive) return;
        if (!enabled()) { clearAll(); return; }
        const store = messages.get() as unknown as { getMessage(channelId: string, id: string): Message | undefined; } | undefined;
        for (const group of page.querySelectorAll("li[id^=\"chat-messages-\"] [class*=\"reactions_\"]")) {
            const ids = /^chat-messages-(\d+)-(\d+)$/.exec(group.closest("li")?.id ?? "");
            const message = ids ? store?.getMessage(ids[1], ids[2]) : undefined;
            const reactions = message?.reactions ?? [];
            const tooMany = reactions.length > MAX_REACTIONS;
            for (const reaction of group.querySelectorAll("[class*=\"reaction_\"]")) {
                const inner = reaction.querySelector("[class*=\"reactionInner_\"]");
                const picture = reaction.querySelector("img");
                if (!inner || !picture || !ids) continue;
                const found = tooMany ? undefined : reactions.find(item => emojiMatches(item.emoji, { alt: picture.alt, src: picture.src }));
                if (!found) { inner.querySelector(`.${MARK}`)?.remove(); continue; }
                const key = `${ids[2]}:${emojiKey(found.emoji)}`;
                const count = found.count ?? 0;
                let entry = cache.get(key);
                if (!entry) { entry = { count, people: undefined, pending: false }; cache.set(key, entry); }
                if (entry.people === undefined || entry.count !== count) ask(key, entry, ids[1], ids[2], found.emoji, count);
                if (entry.people) draw(inner, entry.people);
            }
        }
    };

    function schedule() {
        if (timer !== undefined || !alive) return;
        timer = setTimeout(sync, SYNC_DELAY_MS);
    }

    const observer = new view.MutationObserver(schedule);
    observer.observe(page.body, { childList: true, subtree: true, characterData: true });
    schedule();

    return () => {
        alive = false;
        observer.disconnect();
        if (timer !== undefined) clearTimeout(timer);
        queue.length = 0;
        cache.clear();
        clearAll();
        hideTip();
    };
}
