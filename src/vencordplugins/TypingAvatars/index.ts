/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin TypingTweaks (authors zt, sadan, MrDiamond) as found in TestCord's copy of Vencord's plugins. The original patched Discord's typing text to put an avatar before each name. Here nothing of Discord's code is touched: a small row of round avatars is drawn over the right end of the message box (the people read from Discord's typing store on each typing event, you and blocked or ignored people left out), and a person's name is the tooltip of their avatar. Discord's own "is typing..." text stays as it is. NOT seen live: nobody was typing while it was built.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    maxAvatars: { type: "number", default: 5, min: 1, max: 10, integer: true, description: "How many avatars to show before \"+N\"" }
});

/** The ids to draw and how many are left out. */
export function chips(ids: readonly string[], max: number): { shown: string[]; more: number; } {
    const limit = Math.max(1, max);
    return { shown: ids.slice(0, limit), more: Math.max(0, ids.length - limit) };
}

interface TypingStore { getTypingUsers(channelId: string): Record<string, number> | undefined; }
interface User { id: string; username?: string; globalName?: string; getAvatarURL?(guildId?: string | null, size?: number): string; }
interface Users { getCurrentUser(): { id: string; } | undefined; getUser(id: string): User | undefined; }
interface Members { getNick?(guildId: string, userId: string): string | null | undefined; }
interface Relationships { isBlockedOrIgnored?(id: string): boolean; }

const COMPOSER = "[role=\"textbox\"][data-slate-editor=\"true\"]";
const CSS = `
.amiricord-typing-avatars { position: fixed; z-index: 100; display: flex; align-items: center; pointer-events: none; }
.amiricord-typing-avatars img, .amiricord-typing-avatars span { width: 20px; height: 20px; border-radius: 50%; box-sizing: border-box; border: 2px solid var(--background-base-lower, var(--background-primary, #313338)); background: var(--background-base-low, #2b2d31); margin-left: -6px; object-fit: cover; pointer-events: auto; }
.amiricord-typing-avatars span { display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600; color: var(--text-muted, #949ba4); }
`;

let stop: (() => void) | undefined;

const plugin: PluginCode & { refresh?(): void; } = {
    settings,
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
        let row: HTMLElement | undefined;
        const hide = () => { row?.remove(); row = undefined; };
        const update = () => {
            const channelId = channels.get()?.getChannelId();
            const store = typing.get();
            const userStore = users.get() as unknown as Users | undefined;
            const editor = page.querySelector(COMPOSER);
            if (!channelId || !store || !userStore || !editor) { hide(); return; }
            const me = userStore.getCurrentUser()?.id;
            const guildId = guilds.get()?.getGuildId() ?? null;
            const nicks = members.get() as unknown as Members | undefined;
            const blocked = relationships.get() as unknown as Relationships | undefined;
            const ids = Object.keys(store.getTypingUsers(channelId) ?? {}).filter(id => id !== me && blocked?.isBlockedOrIgnored?.(id) !== true);
            const box = (editor.closest("form") ?? editor).getBoundingClientRect();
            if (ids.length === 0 || box.width === 0) { hide(); return; }
            const { shown, more } = chips(ids, settings.store.maxAvatars);
            if (!row) {
                row = page.createElement("div");
                row.className = "amiricord-typing-avatars";
                page.body.append(row);
            }
            row.replaceChildren();
            for (const id of shown) {
                const user = userStore.getUser(id);
                const name = (guildId && nicks?.getNick?.(guildId, id)) || user?.globalName || user?.username || "Someone";
                const src = user?.getAvatarURL?.(guildId, 32);
                if (src) {
                    const image = page.createElement("img");
                    image.src = src;
                    image.alt = "";
                    image.title = name;
                    row.append(image);
                } else {
                    const letter = page.createElement("span");
                    letter.textContent = name.slice(0, 1).toUpperCase();
                    letter.title = name;
                    row.append(letter);
                }
            }
            if (more > 0) {
                const rest = page.createElement("span");
                rest.textContent = `+${more}`;
                row.append(rest);
            }
            row.style.left = `${Math.max(0, box.right - row.offsetWidth - 14)}px`;
            row.style.top = `${Math.max(0, box.top - 24)}px`;
        };
        plugin.refresh = update;
        // Discord ends a person's typing by itself without an event, so the row is also read again while it is shown.
        const timer = view.setInterval(() => { if (row) update(); }, 1500);
        view.addEventListener("resize", update);
        stop = () => {
            view.clearInterval(timer);
            view.removeEventListener("resize", update);
            plugin.refresh = undefined;
            hide();
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
