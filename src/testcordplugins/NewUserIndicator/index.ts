/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NewUserIndicator (author x2b) as found in TestCord. Puts a small mark (❗) next to the name of a person whose account was made
// less than N days ago (30 by default): beside the name above a message and in the member list. The age is read from the person's id (an id holds the moment the account
// was made), so nothing is asked of anyone and nothing is sent.
// Where it hooks was read in a running Discord (build 653945): the header of a message (`hideSystemTag:` is in it once; the badges of the name are the `null!=ev?ev:null` that
// follows the lobby name) and the row of the member list (the same place MoreUserTags uses). Differences from the original: the profile mark is a badge added through
// `ctx.profileBadges` (new, drawn by Discord with the same hover text; it uses a red disc with a white "!" instead of the emoji), and the explanation is the element's own hover text ("Account created N days ago") instead of Discord's tooltip. NOT seen on screen yet.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const DISCORD_EPOCH = 1_420_070_400_000n;
const DAY_MS = 86_400_000;
/** A red exclamation mark on a white disc, the picture of the profile badge (a small vector image kept inside the program). */
const BADGE_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><circle cx=\"16\" cy=\"16\" r=\"16\" fill=\"#f23f43\"/><rect x=\"14\" y=\"6\" width=\"4\" height=\"12.5\" rx=\"2\" fill=\"#fff\"/><circle cx=\"16\" cy=\"24\" r=\"2.4\" fill=\"#fff\"/></svg>")}`;
const SNOWFLAKE = /^\d{15,25}$/;

const settings = definePluginSettings({
    badges: { type: "boolean", default: true, description: "Show the mark as a badge on the profile (the card and the popout)." },
    decorators: { type: "boolean", default: true, description: "Show the mark in the member list." },
    decorations: { type: "boolean", default: true, description: "Show the mark next to names above messages." },
    days: { type: "number", default: 30, min: 1, max: 3650, integer: true, description: "An account made fewer days ago than this gets the mark." }
});

/** The whole days since an account was made, from its id; undefined when the id is not one. */
export function accountAgeDays(id: unknown, now: number): number | undefined {
    if (typeof id !== "string" || !SNOWFLAKE.test(id)) return undefined;
    const made = Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
    return Math.max(0, Math.floor((now - made) / DAY_MS));
}

/** The hover text of the mark, or undefined when the person does not get one (a bot, an id that is not one, or an account that is old enough). */
export function indicatorText(user: { id?: unknown; bot?: unknown; } | null | undefined, limitDays: number, now: number): string | undefined {
    if (!user || user.bot === true) return undefined;
    const age = accountAgeDays(user.id, now);
    if (age === undefined || age >= limitDays) return undefined;
    return `Account created ${age} ${age === 1 ? "day" : "days"} ago`;
}

function mark(user: { id?: unknown; bot?: unknown; } | null | undefined, enabled: boolean): unknown {
    if (!enabled) return null;
    const text = indicatorText(user, settings.store.days, Date.now());
    if (text === undefined) return null;
    return (currentReact() as { createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown; }).createElement("span", { key: "amiricord-new-user", title: text, "aria-label": text, style: { marginLeft: "4px", cursor: "default" } }, "❗");
}

const plugin: PluginCode & {
    messageIndicator(message: { author?: { id?: unknown; bot?: unknown; }; } | undefined): unknown;
    memberIndicator(props: { user?: { id?: unknown; bot?: unknown; }; } | undefined): unknown;
} = {
    settings,

    start(ctx) {
        // The mark on the profile, as the original does with a profile badge (`ctx.profileBadges`; Discord draws it with the hover text as its tooltip).
        ctx.profileBadges.add({
            id: "new-user",
            badge: userId => {
                if (!settings.store.badges) return undefined;
                const text = indicatorText({ id: userId }, settings.store.days, Date.now());
                return text === undefined ? undefined : { description: text, iconSrc: BADGE_ICON };
            }
        });
    },

    patches: [
        {
            // The header of a message: after the name's badges, the mark.
            find: "hideSystemTag:",
            lazy: true,
            required: false,
            replacements: [{
                match: /(\(0,\i\.jsx\)\(\i,\{message:\i,channel:\i\}\),)(null!=\i\?\i:null,)/,
                replace: "$1$2$self.messageIndicator(arguments[0].message),"
            }]
        },
        {
            // A row of the member list: the decorators (bot tag, crown, boost icon) get the mark first.
            find: "lostPermissionTooltipText:",
            required: false,
            replacements: [{
                match: /(\.memo\(function\(\i\)\{let\{user:\i,isOwner:\i,lostPermissionTooltipText:\i,ownerTooltipText:\i,premiumSince:\i,onClickPremiumGuildIcon:\i\}=\i;return\(0,\i\.jsxs\)\(\i\.Fragment,\{children:\[)/,
                replace: "$1$self.memberIndicator(arguments[0]),"
            }]
        }
    ],

    messageIndicator(message) {
        return mark(message?.author, settings.store.decorations);
    },

    memberIndicator(props) {
        return mark(props?.user, settings.store.decorators);
    }
};

export default plugin;
