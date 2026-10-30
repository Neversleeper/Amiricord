/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ImageFilename (author Ven) as found in TestCord's copy of Vencord's plugins. Same patch and same rules; the option is kept. Not checked live.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const IMAGE_EXTENSION = /\.(png|jpg|jpeg|gif|webp|avif)$/i;
const GIF_HOST = /^(.+?\.)?(tenor|giphy|imgur)\.com$/i;

const settings = definePluginSettings({
    showFullUrl: { type: "boolean", default: false, description: "Show the whole address of the image instead of just the file name. Always on for GIFs, because they usually have no useful file name" }
});

/** What the tooltip of an image says, or undefined when it should have none. */
export function imageTitle(src: string, showFullUrl: boolean): string | undefined {
    try {
        const url = new URL(src);
        const isGif = GIF_HOST.test(url.hostname);
        if (!isGif && !IMAGE_EXTENSION.test(url.pathname)) return undefined;
        return isGif || showFullUrl ? src : url.pathname.split("/").pop();
    } catch {
        return undefined;
    }
}

const plugin: PluginCode & { getTitle(src: string): string | undefined; } = {
    settings,
    patches: [
        {
            find: ".RESPONSIVE?",
            lazy: true,
            required: false,
            replacements: [{ match: /(?="data-role":"img","data-safe-src":)(?<=href:(\i).+?)/, replace: "title:$self.getTitle($1)," }]
        }
    ],

    getTitle(src) {
        return imageTitle(src, settings.store.showFullUrl);
    }
};

export default plugin;
