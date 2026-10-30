/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FixImagesQuality (authors Nuckyz, Ven) as found in TestCord's copy of Vencord's plugins. Same patch and same address rules. The original's explanation card is shortened into the option text. By default, chat gets full resolution but optimised images and the image viewer gets the original; the option loads the original in chat too (GIFs and WebPs then always animate and it may lag).

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    originalImagesInChat: { type: "boolean", default: false, description: "Also load the original image in chat. Careful: animated images (GIF, WebP) then always animate, even when Discord is not focused, and it may lag" }
});

interface ImageProps { src?: string; width: number; height: number; contentType?: string; mosaicStyleAlt?: boolean; trigger?: string; }

const LIMIT_PIXELS = 2000 * 1200;

/** The address to load the image from, or undefined to leave Discord's own. */
export function imageSource(props: ImageProps | undefined, freeze: boolean | undefined, originalInChat: boolean): string | undefined {
    if (!props?.src) return undefined;
    try {
        const { contentType, height, src, width, mosaicStyleAlt, trigger } = props;
        // Embed images have no content type. Videos are hard to tell from images, but mosaicStyleAlt seems to exist only on images
        const isImage = contentType?.startsWith("image/") ?? (typeof mosaicStyleAlt === "boolean");
        if (!isImage || src.startsWith("data:")) return undefined;
        const url = new URL(src);
        if (!url.pathname.startsWith("/attachments/")) return undefined;
        url.searchParams.set("animated", String(!freeze));
        // GIFs cannot be asked not to animate, so a still one has to be a WebP
        if (freeze && url.pathname.endsWith(".gif")) url.searchParams.set("format", "webp");
        const isViewer = !!trigger;
        if (!originalInChat && !isViewer) {
            const pixels = width * height;
            if (pixels <= LIMIT_PIXELS) return url.toString();
            const scale = Math.sqrt(pixels / LIMIT_PIXELS);
            url.searchParams.set("width", Math.round(width / scale).toString());
            url.searchParams.set("height", Math.round(height / scale).toString());
            return url.toString();
        }
        url.hostname = "cdn.discordapp.com";
        return url.toString();
    } catch {
        return undefined;
    }
}

const plugin: PluginCode & { getSrc(props: ImageProps | undefined, freeze?: boolean): string | undefined; } = {
    settings,
    patches: [
        {
            find: ".handleImageLoad)",
            lazy: true,
            required: false,
            replacements: [{ match: /getSrc\(\i\)\{/, replace: "$&var _vcSrc=$self.getSrc(this?.props,arguments[1]);if(_vcSrc)return _vcSrc;" }]
        }
    ],

    getSrc(props, freeze) {
        return imageSource(props, freeze, settings.store.originalImagesInChat);
    }
};

export default plugin;
