/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin TypingTweaks (authors zt, sadan, MrDiamond) as found in TestCord's copy of Vencord's plugins. The original patched Discord's typing text to put a round avatar before each name. Here nothing of Discord's code is touched: the typing text above the message box (`typing_*` > `text_*`, with each name in a `strong`, read in her running Discord, build 655747) gets a small avatar put in front of every name that matches someone typing in the channel (read from Discord's typing store; the match is by the name Discord shows, and a name that two people share is left without an avatar). The avatars are taken away again when the plugin stops or nobody types.

import type { PluginCode } from "../../renderer/engine";

export interface Typist { id: string; name: string; }

/** The person whose name is exactly this text, or undefined when nobody or more than one person has it. */
export function typistNamed(text: string, typists: readonly Typist[]): Typist | undefined {
    const wanted = text.trim();
    if (wanted === "") return undefined;
    const found = typists.filter(typist => typist.name === wanted);
    return found.length === 1 ? found[0] : undefined;
}

interface TypingStore { getTypingUsers(channelId: string): Record<string, number> | undefined; }
interface User { id: string; username?: string; globalName?: string; getAvatarURL?(guildId?: string | null, size?: number): string; }
interface Users { getCurrentUser(): { id: string; } | undefined; getUser(id: string): User | undefined; }
interface Members { getNick?(guildId: string, userId: string): string | null | undefined; }
interface Relationships { isBlockedOrIgnored?(id: string): boolean; }

const MARK = "amiricord-typing-avatar";
const NAMES = "[class*=\"typing_\"] [class*=\"text_\"][aria-hidden=\"true\"] strong";
const CSS = `
img.${MARK} { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin: -2px 4px 0 0; }
`;

let stop: (() => void) | undefined;

const plugin: PluginCode & { refresh?(): void; } = {
    start(ctx) {
        ctx.addStyle(CSS, "typing-avatars");
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const typing = ctx.finders.byStore<TypingStore>("TypingStore");
        const channels = ctx.common.SelectedChannelStore;
        const users = ctx.common.UserStore;
        const members = ctx.common.GuildMemberStore;
        const guilds = ctx.common.SelectedGuildStore;
        const relationships = ctx.common.RelationshipStore;
        const clear = () => { for (const image of page.querySelectorAll(`img.${MARK}`)) image.remove(); };
        const update = () => {
            const channelId = channels.get()?.getChannelId();
            const store = typing.get();
            const userStore = users.get() as unknown as Users | undefined;
            const strongs = [...page.querySelectorAll(NAMES)];
            // Discord draws the text again when the people change, which leaves our pictures behind (seen live: several in front of each name). Only the one right before a name stays.
            const wanted = new Set<Element | null>(strongs);
            for (const image of page.querySelectorAll(`img.${MARK}`)) {
                if (!wanted.has(image.nextElementSibling)) image.remove();
            }
            if (!channelId || !store || !userStore || strongs.length === 0) return;
            const me = userStore.getCurrentUser()?.id;
            const guildId = guilds.get()?.getGuildId() ?? null;
            const nicks = members.get() as unknown as Members | undefined;
            const blocked = relationships.get() as unknown as Relationships | undefined;
            const typists: Typist[] = [];
            for (const id of Object.keys(store.getTypingUsers(channelId) ?? {})) {
                if (id === me || blocked?.isBlockedOrIgnored?.(id) === true) continue;
                const user = userStore.getUser(id);
                typists.push({ id, name: (guildId && nicks?.getNick?.(guildId, id)) || user?.globalName || user?.username || "" });
            }
            for (const strong of strongs) {
                const typist = typistNamed(strong.textContent ?? "", typists);
                const before = strong.previousElementSibling;
                const has = before?.classList.contains(MARK) === true;
                if (!typist) { if (has) before!.remove(); continue; }
                const src = userStore.getUser(typist.id)?.getAvatarURL?.(guildId, 32);
                if (!src) continue;
                if (has && before!.getAttribute("data-user") === typist.id) continue;
                if (has) before!.remove();
                const image = page.createElement("img");
                image.className = MARK;
                image.setAttribute("data-user", typist.id);
                image.alt = "";
                image.src = src;
                strong.before(image);
            }
        };
        plugin.refresh = () => { update(); view.setTimeout(update, 60); };
        // The text is drawn again by Discord when the names change, which can drop the avatars, so they are checked now and then.
        const timer = view.setInterval(update, 800);
        stop = () => {
            view.clearInterval(timer);
            plugin.refresh = undefined;
            clear();
        };
    },
    flux: {
        TYPING_START() { plugin.refresh?.(); },
        TYPING_STOP() { plugin.refresh?.(); },
        MESSAGE_CREATE() { plugin.refresh?.(); },
        CHANNEL_SELECT() { plugin.refresh?.(); }
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
