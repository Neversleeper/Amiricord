/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin EmbeddedURLs (author Dadian1) as found in TestCord. Same table of sites. The original changes the whole message into just one link (its own comment says it needs fixing); here every link in the text is looked at and the rest of the message stays. Uses the before-send hook.

import type { PluginCode } from "../../renderer/engine";

const URL_MAP = new Map<string, string>([
    ["https://www.tiktok.com", "https://www.tnktok.com"],
    ["https://vt.tiktok.com", "https://www.tnktok.com"],
    ["https://x.com", "https://www.fxtwitter.com"],
    ["https://www.twitter.com", "https://www.fxtwitter.com"],
    ["https://www.instagram.com", "https://www.kkinstagram.com"]
]);

/** The link with its site swapped for the one that embeds well; any link that is not in the table stays as it is. */
export function replaceUrl(original: string): string {
    try {
        const url = new URL(original);
        const target = URL_MAP.get(url.origin);
        return target === undefined ? original : target + url.pathname + url.search + url.hash;
    } catch {
        return original;
    }
}

/** Every link in a message, replaced. Links wrapped in `<...>` (no preview wanted) are left alone. */
export function replaceUrls(content: string): string {
    return content.replace(/(?<!<)https:\/\/[^\s<>]+/g, replaceUrl);
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.messageEvents.onBeforeSend(content => replaceUrls(content));
    }
};

export default plugin;
