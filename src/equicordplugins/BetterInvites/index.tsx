/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin BetterInvites (authors iamme and thororen) of Equicord. Differences from the original:
//  - the patches were written again against Discord's build 653945 as it runs (the invite card was reworked: the text the original looked for, `isBannerVisible:!1})},`, is now
//    `isBannerVisible:!1}))`); the module with the card is found by its translation key (`.t.xdCLeM`, "Hide details") and the one with the server name by the name of the date it shows (a patch only goes to the first module that matches its `find`, and
//    the first module with the card's heading text is another one);
//  - the expiry is shown as a small icon whose tooltip is the plain date (the original used a Discord timestamp that counts down);
//  - the inviter's picture is drawn with the plugin's own style, and clicking it opens their profile when Discord's profile opener is found.
// The three patches were taken from the live code of Discord's card (the functions seen in the page), not from the downloadable files, which were not readable for those modules.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface Inviter {
    id: string;
    avatar?: string | null;
    global_name?: string | null;
    username: string;
}

const CSS = `
.ac-bi-header-inner { display: flex; flex-direction: column; gap: 2px; margin: 0 0 8px 0; font-size: 14px; }
.ac-bi-line { display: flex; align-items: center; gap: 6px; }
.ac-bi-inviter-avatar { margin: 0; height: 20px; width: 20px; border-radius: 50%; flex-shrink: 0; cursor: pointer; object-fit: cover; }
.ac-bi-header-text { flex: 1; min-width: 0; white-space: normal; color: var(--text-default, var(--text-normal)); }
.ac-bi-expiry { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
`;

// The finders are kept and asked when used: the modules are not in Discord yet when the plugin starts.
let guildActions: { get(): any; } | undefined;
let profileActions: { get(): any; } | undefined;
let users: { get(): any; } | undefined;
let context: EnginePluginContext | undefined;
let styled = false;

/** The style goes in when the first card is drawn: the plugin starts before the page has a place for styles. */
function ensureStyle(): void {
    if (styled || !context) return;
    styled = true;
    context.addStyle(CSS, "better-invites");
}

/** Joins a server as a visitor and goes to it. Only discoverable servers accept that. */
function lurk(id: string): void {
    const actions = guildActions?.get();
    actions?.joinGuild?.(id, { lurker: true })
        ?.then(() => actions.transitionToGuildSync?.(id))
        ?.catch(() => { /* the server is not open to visitors */ });
}

export function isLurkable(guild: { features?: Iterable<string>; } | undefined): boolean {
    return guild?.features !== undefined && new Set(guild.features).has("DISCOVERABLE");
}

/** "3d 4h 12m 5s" for the time left, parts that are zero at the front left out. */
export function timeLeft(ms: number): string {
    if (ms <= 0) return "expired";
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400);
    const parts = [`${days}d`, `${Math.floor(total % 86400 / 3600)}h`, `${Math.floor(total % 3600 / 60)}m`, `${total % 60}s`];
    const first = days > 0 ? 0 : total >= 3600 ? 1 : total >= 60 ? 2 : 3;
    return parts.slice(first).join(" ");
}

/** The line that counts down to the end of the invite, drawn again every second. */
function Expiry({ at }: { at: number; }) {
    const react = currentReact() as any;
    const [now, setNow] = react.useState(Date.now()) as [number, (value: number) => void];
    react.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const left = at - now;
    return react.createElement("div", { className: "ac-bi-expiry", title: new Date(at).toLocaleString() }, left <= 0 ? "This invite has expired" : `Expires in ${timeLeft(left)}`);
}

const plugin: PluginCode & {
    Lurkable(guild?: { id: string; features?: string[]; }): (() => void) | null;
    Header(invite: { inviter?: Inviter; expires_at?: string; } | undefined, guildName?: string): unknown;
} = {
    patches: [
        // The card: hand the invite to the part that draws the server name and counts.
        {
            find: ".t.xdCLeM",
            replacements: [
                { match: /profile:\i,disableGuildNameClick:!\i,guildNameId:\i/, replace: "$&,invite:arguments[0].invite" }
            ]
        },
        // The name and counts: click on the name and the lines saying who sent it and when it ends.
        {
            find: /guildNameId:[\w$]+\}=[\w$]+.{0,2500}createdAtDate:/,
            replacements: [
                { match: /children:(\i)\.name\}\)\}\)\}\)/, replace: "onClick:$self.Lurkable($1),$&" },
                { match: /(?<=\]\}\),)(?=.{0,15}onlineCount:\i\.onlineCount)/, replace: "$self.Header(arguments[0]?.invite,arguments[0]?.profile?.name)," }
            ]
        }
    ],

    Lurkable(guild) {
        if (!guild?.id || !isLurkable(guild)) return null;
        return () => lurk(guild.id);
    },

    Header(invite, guildName) {
        const inviter = invite?.inviter;
        const expires = invite?.expires_at ? new Date(invite.expires_at).getTime() : Number.NaN;
        if (!inviter && Number.isNaN(expires)) return null;
        ensureStyle();
        const react = currentReact() as any;
        const me = users?.get()?.getCurrentUser?.()?.id;
        const server = guildName ?? "this server";
        const children: unknown[] = [];
        if (inviter) {
            const name = inviter.global_name || inviter.username;
            const picture = inviter.avatar ? `https://cdn.discordapp.com/avatars/${inviter.id}/${inviter.avatar}.webp?size=80` : "/assets/1f0bfc0865d324c2587920a7d80c609b.png?size=128";
            children.push(react.createElement("div", { key: "who", className: "ac-bi-line" },
                react.createElement("img", { alt: "", className: "ac-bi-inviter-avatar", src: picture, onClick: () => profileActions?.get()?.openUserProfileModal?.({ userId: inviter.id }) }),
                react.createElement("div", { className: "ac-bi-header-text" }, me === inviter.id ? `You sent an invite to join ${server}` : `${name} invited you to join ${server}`)));
        }
        if (!Number.isNaN(expires)) children.push(react.createElement(Expiry, { key: "ends", at: expires }));
        return react.createElement("div", { key: "ac-bi-header", className: "ac-bi-header-inner" }, ...children);
    },

    start(ctx) {
        context = ctx;
        users = ctx.common.UserStore;
        guildActions = ctx.finders.byProps("joinGuild", "transitionToGuildSync");
        profileActions = ctx.finders.byProps("openUserProfileModal");
    },

    stop() {
        guildActions = profileActions = users = context = undefined;
        styled = false;
    }
};

export default plugin;
