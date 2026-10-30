/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin TypingTweaks (authors zt, sadan, MrDiamond) as found in TestCord's copy of Vencord's plugins. The original patches Discord's typing text; here nothing of Discord's
// code is touched: the typing text above the message box (`typing_*` > `text_*`, with each name in a `strong`, read in her running Discord, build 655747) is found in the page, and the people typing
// come from Discord's typing store (the match is by the name Discord shows; a name two people share is left alone). The options are the original's, in the same plugin:
//  - avatars: a small round picture in front of every name;
//  - role colours: the name painted with the colour of the person's top role;
//  - clickable names: a click on a name or a picture opens the person's profile (`openUserProfileModal`, as the original opens it);
//  - alternative formatting: when more than three people type, Discord says "Several people are typing..."; here the first three are listed and "and N others" follows. Discord's own text is hidden and
//    ours is a separate element beside it (nothing Discord draws is changed, so Discord drawing again cannot clash with it).
// Not here: the original's option to show yourself in the list (it needs Discord's own code changed, which this port avoids). Everything added is taken away when the plugin stops.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    showAvatars: { type: "boolean", default: true, description: "Show a small avatar in front of each name in the typing text." },
    showRoleColors: { type: "boolean", default: true, description: "Colour the names with the colour of the person's top role." },
    clickableNames: { type: "boolean", default: true, description: "Click a name or an avatar in the typing text to open the person's profile." },
    alternativeFormatting: { type: "boolean", default: true, description: "When more than three people type, list the first three and say how many others (Discord only says \"Several people\")." }
});

export interface Typist { id: string; name: string; }

export const ALTERNATIVE_FROM = 4;
export const LISTED_NAMES = 3;

/** The person whose shown name is exactly this text, or undefined when nobody or more than one person has it. */
export function typistNamed(text: string, typists: readonly Typist[]): Typist | undefined {
    const wanted = text.trim();
    if (wanted === "") return undefined;
    const found = typists.filter(typist => typist.name === wanted);
    return found.length === 1 ? found[0] : undefined;
}

/** For the alternative text: the people to name and how many others there are. */
export function listed<T>(people: readonly T[], names: number): { named: T[]; others: number; } {
    const limit = Math.max(1, names);
    return { named: people.slice(0, limit), others: Math.max(0, people.length - limit) };
}

interface TypingStore { getTypingUsers(channelId: string): Record<string, number> | undefined; }
interface User { id: string; username?: string; globalName?: string; getAvatarURL?(guildId?: string | null, size?: number): string; }
interface Users { getCurrentUser(): { id: string; } | undefined; getUser(id: string): User | undefined; }
interface Members { getNick?(guildId: string, userId: string): string | null | undefined; getMember?(guildId: string, userId: string): { colorString?: string | null; } | undefined; }
interface Relationships { isBlockedOrIgnored?(id: string): boolean; }
interface ProfileActions { openUserProfileModal?(options: { userId: string; guildId?: string | null; channelId?: string; }): unknown; }

const MARK = "amiricord-typing-avatar";
const ALT = "amiricord-typing-alt";
const USER = "data-amiricord-user";
const PAINT = "data-amiricord-typing-paint";
const HIDDEN = "data-amiricord-typing-hidden";
// The typing bar holds two copies of the text, and the one that is not drawn (`visibility: hidden`) is left alone.
const TEXT = "[class*=\"typing_\"] [class*=\"text_\"][aria-hidden=\"true\"]:not([style*=\"visibility\"])";
const NAMES = `${TEXT} strong`;
const CSS = `
img.${MARK} { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin: -2px 4px 0 0; }
`;

let stop: (() => void) | undefined;

const plugin: PluginCode & { refresh?(): void; } = {
    settings,
    start(ctx) {
        ctx.addStyle(CSS, "typing-avatars");
        const page = (globalThis as unknown as { document: Document; }).document;
        const view = page.defaultView!;
        const typing = ctx.finders.byStore<TypingStore>("TypingStore");
        const profileActions = ctx.finders.byProps<ProfileActions>("openUserProfileModal");
        const channels = ctx.common.SelectedChannelStore;
        const users = ctx.common.UserStore;
        const members = ctx.common.GuildMemberStore;
        const guilds = ctx.common.SelectedGuildStore;
        const relationships = ctx.common.RelationshipStore;

        const clear = () => {
            for (const image of page.querySelectorAll(`img.${MARK}`)) image.remove();
            for (const alt of page.querySelectorAll(`.${ALT}`)) alt.remove();
            for (const text of page.querySelectorAll<HTMLElement>(`[${HIDDEN}]`)) { text.removeAttribute(HIDDEN); text.style.removeProperty("display"); }
            for (const strong of page.querySelectorAll<HTMLElement>(`[${PAINT}]`)) {
                strong.style.removeProperty("color");
                strong.style.removeProperty("cursor");
                strong.removeAttribute(USER);
                strong.removeAttribute(PAINT);
            }
        };

        const onClick = (event: Event) => {
            if (!settings.store.clickableNames) return;
            const target = (event.target as Element | null)?.closest?.(`[${USER}]`);
            const userId = target?.getAttribute(USER);
            if (!userId) return;
            event.stopPropagation();
            event.preventDefault();
            profileActions.get()?.openUserProfileModal?.({ userId, guildId: guilds.get()?.getGuildId() ?? null, channelId: channels.get()?.getChannelId() });
        };
        page.addEventListener("click", onClick, true);

        const update = () => {
            const channelId = channels.get()?.getChannelId();
            const store = typing.get();
            const userStore = users.get() as unknown as Users | undefined;
            const strongs = [...page.querySelectorAll<HTMLElement>(NAMES)];
            const text = page.querySelector<HTMLElement>(TEXT);
            // Discord draws the text again when the people change, which leaves our pictures behind (seen live: several in front of each name). Only the one right before a name stays.
            const wanted = new Set<Element | null>(strongs);
            for (const image of page.querySelectorAll(`img.${MARK}`)) {
                if (image.closest(`.${ALT}`)) continue;
                if (!settings.store.showAvatars || !wanted.has(image.nextElementSibling)) image.remove();
            }
            if (!text) { for (const alt of page.querySelectorAll(`.${ALT}`)) alt.remove(); }
            if (!channelId || !store || !userStore) return;

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
            const colorOf = (userId: string): string | null => (settings.store.showRoleColors && guildId ? nicks?.getMember?.(guildId, userId)?.colorString ?? null : null);
            const pictureOf = (userId: string): string | undefined => userStore.getUser(userId)?.getAvatarURL?.(guildId, 32);

            const alternative = !!text && settings.store.alternativeFormatting && typists.length >= ALTERNATIVE_FROM;
            for (const alt of page.querySelectorAll(`.${ALT}`)) if (!alternative) alt.remove();
            if (text) {
                if (alternative) {
                    const names = listed(typists, LISTED_NAMES);
                    const signature = [...names.named.map(person => person.id), names.others, settings.store.showAvatars, settings.store.showRoleColors, settings.store.clickableNames].join(",");
                    let alt = page.querySelector<HTMLElement>(`.${ALT}`);
                    if (!alt || alt.getAttribute("data-signature") !== signature) {
                        alt?.remove();
                        alt = page.createElement("span");
                        alt.className = `${text.className} ${ALT}`;
                        alt.setAttribute("data-signature", signature);
                        names.named.forEach((person, index) => {
                            const picture = settings.store.showAvatars ? pictureOf(person.id) : undefined;
                            if (picture) {
                                const image = page.createElement("img");
                                image.className = MARK;
                                image.alt = "";
                                image.src = picture;
                                image.setAttribute(USER, person.id);
                                if (settings.store.clickableNames) image.style.cursor = "pointer";
                                alt!.append(image);
                            }
                            const strong = page.createElement("strong");
                            strong.textContent = person.name;
                            strong.setAttribute(USER, person.id);
                            const color = colorOf(person.id);
                            if (color) strong.style.color = color;
                            if (settings.store.clickableNames) strong.style.cursor = "pointer";
                            alt!.append(strong);
                            alt!.append(page.createTextNode(index < names.named.length - 1 ? ", " : " "));
                        });
                        alt.append(page.createTextNode(`and ${names.others} ${names.others === 1 ? "other is" : "others are"} typing...`));
                        text.after(alt);
                    } else if (alt.previousElementSibling !== text) {
                        text.after(alt);
                    }
                    text.setAttribute(HIDDEN, "1");
                    text.style.display = "none";
                } else if (text.hasAttribute(HIDDEN)) {
                    text.removeAttribute(HIDDEN);
                    text.style.removeProperty("display");
                }
            }

            for (const strong of strongs) {
                const person = alternative ? undefined : typistNamed(strong.textContent ?? "", typists);
                const color = person ? colorOf(person.id) : null;
                if (color) strong.style.color = color;
                else if (strong.hasAttribute(PAINT)) strong.style.removeProperty("color");
                if (person && settings.store.clickableNames) { strong.setAttribute(USER, person.id); strong.style.cursor = "pointer"; } else { strong.removeAttribute(USER); strong.style.removeProperty("cursor"); }
                if (person) strong.setAttribute(PAINT, "1"); else strong.removeAttribute(PAINT);
                if (!person || !settings.store.showAvatars) continue;
                const src = pictureOf(person.id);
                if (!src) continue;
                const before = strong.previousElementSibling;
                const has = before?.classList.contains(MARK) === true;
                if (has && before!.getAttribute(USER) === person.id) continue;
                if (has) before!.remove();
                const image = page.createElement("img");
                image.className = MARK;
                image.setAttribute(USER, person.id);
                if (settings.store.clickableNames) image.style.cursor = "pointer";
                image.alt = "";
                image.src = src;
                strong.before(image);
            }
        };
        plugin.refresh = () => { update(); view.setTimeout(update, 60); };
        // The text is drawn again by Discord when the names change, which can drop what was added, so it is checked now and then.
        const timer = view.setInterval(update, 800);
        stop = () => {
            view.clearInterval(timer);
            page.removeEventListener("click", onClick, true);
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
