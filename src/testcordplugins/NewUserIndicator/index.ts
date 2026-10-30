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
// `ctx.profileBadges` (new, drawn by Discord with the same hover text; its picture is the same red "!" as the mark beside names, drawn as a vector image), and the explanation ("Account created N days ago") is shown by `src/api/tooltip.ts`, a tooltip drawn like Discord's own that appears at once (the browser's hover text was slow and plain), instead of Discord's tooltip component. NOT seen on screen yet.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import { hideTip, showTip } from "../../api/tooltip";
import type { PluginCode } from "../../renderer/engine";

const DISCORD_EPOCH = 1_420_070_400_000n;
const DAY_MS = 86_400_000;
/** A red exclamation mark, like the ❗ emoji, with no disc behind it: the picture of the profile badge (a small vector image kept inside the program). */
const BADGE_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path d=\"M16 2c-2.6 0-4.6 2.2-4.4 4.8l1 12.6c.1 1.5 1.5 2.6 3.4 2.6s3.3-1.1 3.4-2.6l1-12.6C20.6 4.2 18.6 2 16 2z\" fill=\"#e5322d\"/><circle cx=\"16\" cy=\"27\" r=\"3.6\" fill=\"#e5322d\"/></svg>")}`;
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
    return (currentReact() as { createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown; }).createElement("span", {
        key: "amiricord-new-user",
        "aria-label": text,
        style: { marginLeft: "4px", cursor: "default" },
        onMouseEnter: (event: { currentTarget: Element; }) => { showTip(event.currentTarget, text); },
        onMouseLeave: hideTip
    }, "❗");
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

    stop() {
        hideTip();
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
