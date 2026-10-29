/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin AlwaysAnimate (author FieryFlames) as found in TestCord's copy of Vencord's plugins.
// The patches are the original's, each one only while its setting is on (read when the plugin starts, so a change needs a restart), with Discord's translation keys
// written as their hashes (GUILD_OWNER `pclUFJ`, DISCOVERABLE_GUILD_HEADER_PUBLIC_INFO `O8lDI2`). Checked on build 653945: the member list gradient, the nameplate and
// the role gradient ones match; the others are in code Discord loads later, so they are lazy and NOT known to match. The "pause the member list" setting works at once.
// The member list is found by its two class names (`members`, `membersWrap`) at the time the setting is applied.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

const ANIMATE = /canAnimate:(?!\s*(?:!0|true|["']))[^,{}]+?(?=[,}](?!\s*=)(?![^;{}]*\}\s*=))/;
const STYLE_ID = "amiricord-always-animate-member-freeze";

const settings = definePluginSettings({
    icons: { type: "boolean", default: true, description: "Always animate server icons, avatars, decor and more" },
    statusEmojis: { type: "boolean", default: true, description: "Always animate status emojis" },
    serverBanners: { type: "boolean", default: true, description: "Always animate server banners" },
    nameplates: { type: "boolean", default: true, description: "Always animate nameplates" },
    roleGradients: { type: "boolean", default: true, description: "Always animate role gradients" },
    excludeMemberList: {
        type: "boolean",
        default: false,
        restartNeeded: true,
        description: "Leave the server member list out of this. Member list patches are skipped and its animations are paused, so large servers stay smooth. Chat and everything else keeps animating. Needs a restart."
    }
} as const);

let context: EnginePluginContext | undefined;

function selectorOf(className: unknown): string | undefined {
    if (typeof className !== "string") return undefined;
    const parts = className.split(/\s+/).filter(part => /^[\w-]+$/.test(part));
    return parts.length ? parts.map(part => `.${part}`).join("") : undefined;
}

function freezeMemberList(on: boolean): void {
    document.getElementById(STYLE_ID)?.remove();
    if (!on || !context) return;
    const classes = context.finders.byProps<Record<string, unknown>>("members", "membersWrap").get();
    const selectors = ["members", "membersWrap"].map(key => selectorOf(classes?.[key])).filter((value): value is string => value !== undefined).flatMap(selector => [selector, `${selector} *`]);
    if (!selectors.length) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    // Pausing settles the compositor: gradient and nameplate art stays visible but stops repainting every frame.
    style.textContent = `${selectors.join(",")} { animation-play-state: paused !important; }`;
    document.head.appendChild(style);
}

const plugin: PluginCode = {
    settings,

    get patches(): PatchDefinition[] {
        const patches: PatchDefinition[] = [];
        const store = settings.store;
        if (store.icons) {
            patches.push({ find: ANIMATE, all: true, lazy: true, replacements: [{ match: new RegExp(ANIMATE.source, "g"), replace: "canAnimate:!0" }] });
        }
        if (store.statusEmojis) {
            patches.push({ find: ".t.pclUFJ),children:", lazy: true, required: false, replacements: [{ match: /(\.CUSTOM_STATUS.+?animateEmoji:)\i/, replace: "$1!0" }] });
        }
        if (store.serverBanners) {
            patches.push({ find: ".t.O8lDI2", lazy: true, required: false, replacements: [{ match: /(guildBanner:\i,animate:)\i(?=}\):null)/, replace: "$1!0" }] });
        }
        patches.push({ find: "contentOnly:", lazy: true, required: false, replacements: [{ match: /animate:\i/, replace: "animate:!0" }] });
        if (!store.excludeMemberList) {
            patches.push({ find: '="left",className:', lazy: true, required: false, replacements: [{ match: /,animateGradient:/, replace: ",animateGradient:!0,_oldAnimateGradient:" }] });
        }
        if (store.nameplates) {
            patches.push({ find: ".MINI_PREVIEW,[", lazy: true, required: false, replacements: [{ match: /animate:\i,loop:/, replace: "animate:true,loop:true,_loop:" }] });
        }
        if (store.roleGradients) {
            patches.push({
                find: "includeConvenienceGlow:r,animateGradient:",
                lazy: true,
                required: false,
                replacements: [{ match: /(includeConvenienceGlow:\i,animateGradient:(\i)\}=e),(\i="username"===\i)/, replace: "$1;$2=!0;let $3" }]
            });
        }
        return patches;
    },

    start(ctx) {
        context = ctx;
        if (settings.store.excludeMemberList) freezeMemberList(true);
    },

    stop() {
        freezeMemberList(false);
        context = undefined;
    }
};

export default plugin;
