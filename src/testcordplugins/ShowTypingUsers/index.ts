/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ShowTypingUsers (author Sharp) as found in TestCord. The original put a "N typing" badge in the channel header and kept its own copy of who was typing. Here a small label over the left end of the message box says who is typing in the channel you are looking at ("Ana is typing...", "Ana and Leo are typing...", "Ana, Leo and 2 others are typing..."), read from Discord's own typing store on each typing event, and it uses the name the person has in the server. It draws an element of its own over the page and patches nothing.
// Not seen live: nobody was typing in her test server.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    maxNames: { type: "number", default: 3, min: 1, max: 6, integer: true, description: "How many names to list before saying \"and N others\"" },
    showFriendsOnly: { type: "boolean", default: false, description: "Only show friends" }
});

/** The sentence for the names of the people typing, or an empty text when nobody is. */
export function typingLabel(names: readonly string[], maxNames: number): string {
    if (names.length === 0) return "";
    const limit = Math.max(1, maxNames);
    if (names.length === 1) return `${names[0]} is typing...`;
    if (names.length <= limit) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing...`;
    const others = names.length - limit;
    return `${names.slice(0, limit).join(", ")} and ${others} ${others === 1 ? "other" : "others"} are typing...`;
}

interface TypingStore { getTypingUsers(channelId: string): Record<string, number> | undefined; }
interface Users { getCurrentUser(): { id: string; } | undefined; getUser(id: string): { id: string; username?: string; globalName?: string; } | undefined; }
interface Members { getNick?(guildId: string, userId: string): string | null | undefined; }
interface Relationships { isFriend?(id: string): boolean; }

const COMPOSER = "[role=\"textbox\"][data-slate-editor=\"true\"]";
const CSS = `
.amiricord-typing { position: fixed; z-index: 100; pointer-events: none; padding: 1px 8px; border-radius: 4px; font-size: 12px; line-height: 1.4; color: var(--text-muted, #949ba4); background: var(--background-base-low, var(--background-secondary, #2b2d31)); max-width: 60vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

let stop: (() => void) | undefined;

const plugin: PluginCode & { refresh?(): void; } = {
    settings,
    start(ctx) {
        ctx.addStyle(CSS, "show-typing-users");
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const typing = ctx.finders.byStore<TypingStore>("TypingStore");
        const channels = ctx.common.SelectedChannelStore;
        const users = ctx.common.UserStore;
        const members = ctx.common.GuildMemberStore;
        const guilds = ctx.common.SelectedGuildStore;
        const relationships = ctx.common.RelationshipStore;
        let label: HTMLElement | undefined;
        const hide = () => { label?.remove(); label = undefined; };
        const update = () => {
            const channelId = channels.get()?.getChannelId();
            const store = typing.get();
            const userStore = users.get() as unknown as Users | undefined;
            const editor = page.querySelector(COMPOSER);
            if (!channelId || !store || !userStore || !editor) { hide(); return; }
            const me = userStore.getCurrentUser()?.id;
            const guildId = guilds.get()?.getGuildId();
            const nicks = members.get() as unknown as Members | undefined;
            const friends = relationships.get() as unknown as Relationships | undefined;
            const names = Object.keys(store.getTypingUsers(channelId) ?? {})
                .filter(id => id !== me && (!settings.store.showFriendsOnly || friends?.isFriend?.(id) === true))
                .map(id => {
                    const user = userStore.getUser(id);
                    return (guildId && nicks?.getNick?.(guildId, id)) || user?.globalName || user?.username || "Someone";
                });
            const text = typingLabel(names, settings.store.maxNames);
            const box = (editor.closest("form") ?? editor).getBoundingClientRect();
            if (text === "" || box.width === 0) { hide(); return; }
            if (!label) {
                label = page.createElement("div");
                label.className = "amiricord-typing";
                page.body.append(label);
            }
            label.textContent = text;
            label.style.left = `${Math.max(0, box.left + 12)}px`;
            label.style.top = `${Math.max(0, box.top - label.offsetHeight - 2)}px`;
        };
        plugin.refresh = update;
        // Discord ends a person's typing by itself without an event, so the label is also read again while it is shown.
        const timer = view.setInterval(() => { if (label) update(); }, 1500);
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
