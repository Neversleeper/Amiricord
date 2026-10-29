/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin OpenInApp (authors Ven and surgedevs) as found in TestCord's copy of Vencord's plugins. The rules and the first patch are the
// original's (the patch on Discord's link click handler matches once on build 653945); the second one (a connected account of a profile) is in code Discord loads later, so it is
// lazy and optional and NOT known to match. Differences:
//  - a link is opened by clicking a temporary link element with the app's address (the original asks Vencord's main process to open it); whether Discord's window lets that
//    address through was NOT tried. Only the protocols the rules produce can be opened;
//  - the short link look-up is a main-process function (`native.ts`) that can only reach the hosts in plugin.json;
//  - the original's web-only patch (Spotify "no artist ids in metadata") is dropped, because Amiricord runs in the desktop app;
//  - "Opened link in native app" is Amiricord's short message at the bottom of the page.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface Rule {
    match: RegExp;
    replace: (...matches: string[]) => string;
    shortlinkMatch?: RegExp;
    accountViewReplace?: (userId: string) => string;
}

const RULES: Record<string, Rule> = {
    spotify: {
        match: /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|artist|playlist|user|episode|prerelease)\/(.+)(?:\?.+?)?$/,
        replace: (_, type, id) => `spotify://${type}/${id}`,
        shortlinkMatch: /^https:\/\/spotify\.link\/.+$/,
        accountViewReplace: userId => `spotify:user:${userId}`
    },
    steam: {
        match: /^https:\/\/(steamcommunity\.com|(?:help|store)\.steampowered\.com)\/.+$/,
        replace: match => `steam://openurl/${match}`,
        shortlinkMatch: /^https:\/\/s\.team\/.+$/,
        accountViewReplace: userId => `steam://openurl/https://steamcommunity.com/profiles/${userId}`
    },
    epic: {
        match: /^https:\/\/store\.epicgames\.com\/(.+)$/,
        replace: (_, id) => `com.epicgames.launcher://store/${id}`
    },
    tidal: {
        match: /^https:\/\/(?:listen\.)?tidal\.com\/(?:browse\/)?(track|album|artist|playlist|user|video|mix)\/([a-f0-9-]+).*/,
        replace: (_, type, id) => `tidal://${type}/${id}`
    },
    itunes: {
        match: /^https:\/\/(?:geo\.)?music\.apple\.com\/([a-z]{2}\/)?(album|artist|playlist|song|curator)\/([^/?#]+)\/?([^/?#]+)?(?:\?.*)?(?:#.*)?$/,
        replace: (_, lang, type, name, id) => id ? `itunes://music.apple.com/us/${type}/${name}/${id}` : `itunes://music.apple.com/us/${type}/${name}`
    },
    vrcx: {
        match: /^https:\/\/vrchat\.com\/home\/(user|avatar|world|group)\/(.+)$/,
        replace: (_, type, id) => `vrcx://${type}/${id}`
    },
    telegram: {
        match: /^https:\/\/t\.me\/([a-zA-Z0-9_]+)$/,
        replace: (_, username) => `tg://resolve?domain=${username}`
    }
};

/** The only protocols an address may have to be opened. */
const ALLOWED_PROTOCOLS = ["spotify:", "steam:", "com.epicgames.launcher:", "tidal:", "itunes:", "vrcx:", "tg:"];

const settings = definePluginSettings({
    spotify: { type: "boolean", default: true, description: "Open Spotify links in the Spotify app" },
    steam: { type: "boolean", default: true, description: "Open Steam links in the Steam app" },
    epic: { type: "boolean", default: true, description: "Open Epic Games links in the Epic Games Launcher" },
    tidal: { type: "boolean", default: true, description: "Open Tidal links in the Tidal app" },
    itunes: { type: "boolean", default: true, description: "Open Apple Music links in the iTunes app" },
    vrcx: { type: "boolean", default: true, description: "Open VRChat links in the VRCX app" },
    telegram: { type: "boolean", default: true, description: "Open Telegram links in the Telegram app" }
} as const);

let context: EnginePluginContext | undefined;

const enabled = (key: string): boolean => (settings.store as unknown as Record<string, boolean>)[key] === true;

function openApp(address: string): void {
    let protocol: string;
    try {
        protocol = new URL(address).protocol;
    } catch {
        return;
    }
    if (!ALLOWED_PROTOCOLS.includes(protocol)) return;
    const link = document.createElement("a");
    link.href = address;
    link.rel = "noopener noreferrer";
    link.click();
}

const plugin: PluginCode & {
    handleLink(data: { href?: string; } | undefined, event?: { preventDefault(): void; defaultPrevented?: boolean; }): Promise<boolean>;
    handleAccountView(event: { preventDefault(): void; }, platformType: string, userId: string): boolean;
} = {
    settings,

    patches: [
        {
            find: "trackAnnouncementMessageLinkClicked({",
            lazy: true,
            replacements: [{
                match: /function (\i\(\i,\i\)\{)(?=.{0,150}trusted:)/,
                replace: "async function $1 if(await $self.handleLink(...arguments)) return;"
            }]
        },
        {
            // A connected account on a profile (the account list of the profile window).
            find: ".BLUESKY||",
            lazy: true,
            required: false,
            replacements: [{
                match: /(?<=onClick:(\i)=>\{)(?=.{0,100}\.CONNECTED_ACCOUNT_VIEWED)(?<==(\i)\.metadata.+?)/,
                replace: "if($self.handleAccountView($1,$2.type,$2.id)) return;"
            }]
        }
    ],

    start(ctx) {
        context = ctx;
    },

    stop() {
        context = undefined;
    },

    async handleLink(data, event) {
        try {
            let url = data?.href;
            if (!url) return false;
            let heldBack = false;
            for (const [key, rule] of Object.entries(RULES)) {
                if (!enabled(key)) continue;
                if (rule.shortlinkMatch?.test(url)) {
                    event?.preventDefault();
                    heldBack = true;
                    const resolved = await context?.native.call("resolveRedirect", url);
                    if (typeof resolved === "string" && resolved) url = resolved;
                }
                if (rule.match.test(url)) {
                    context?.toasts.show("Opened link in native app", "success");
                    openApp(url.replace(rule.match, rule.replace));
                    event?.preventDefault();
                    return true;
                }
            }
            // A short link that did not end up as something this handles still has to open somewhere.
            // (only when this handler held the click back itself; a click another handler already stopped is left alone)
            if (heldBack) {
                window.open(url, "_blank");
                return true;
            }
        } catch (error) {
            context?.reportError("OpenInApp", error);
        }
        return false;
    },

    handleAccountView(event, platformType, userId) {
        const rule = RULES[platformType];
        if (!rule?.accountViewReplace || !enabled(platformType)) return false;
        openApp(rule.accountViewReplace(userId));
        event.preventDefault();
        return true;
    }
};

export default plugin;
