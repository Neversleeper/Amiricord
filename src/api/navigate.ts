/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Going to a channel from a plugin: `ctx.navigate("/channels/<server>/<channel>")`. Discord's own router follows the page history, so the engine pushes the new address
// into the history and tells the page it changed (a `popstate` event). Checked live on Discord build 655747: from a server channel, `/channels/@me` opened the friends
// page. Only channel addresses are accepted (a server and a channel, a message of a channel, a direct message, or the direct messages home), so a plugin cannot send the
// page anywhere else.

const ID = "\\d{15,25}";
const CHANNEL_PATH = new RegExp(`^/channels/(?:@me(?:/${ID})?|${ID}/${ID}(?:/${ID})?)$`);

export interface NavigatePage {
    history: { pushState(state: unknown, unused: string, url: string): void; };
    location: { pathname: string; };
    dispatchEvent(event: Event): boolean;
    PopStateEvent: typeof PopStateEvent;
}

/** Whether the address is one a plugin may go to. */
export function isChannelPath(path: unknown): path is string {
    return typeof path === "string" && CHANNEL_PATH.test(path);
}

/** Goes to the address; false (and nothing happens) for an address that is not a channel one or when the page cannot do it. */
export function navigate(page: NavigatePage, path: unknown): boolean {
    if (!isChannelPath(path)) return false;
    try {
        if (page.location.pathname === path) return true;
        page.history.pushState({}, "", path);
        page.dispatchEvent(new page.PopStateEvent("popstate", { state: {} }));
        return true;
    } catch {
        return false;
    }
}
