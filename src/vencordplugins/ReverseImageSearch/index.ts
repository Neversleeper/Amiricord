/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ReverseImageSearch (authors Ven, Nuckyz) as found in TestCord's copy of Vencord's plugins. The original adds a submenu to Discord's own menu with a patch that tells message images from other pictures; here Amiricord's right-click menu gives the picture address of what was clicked and adds one entry per site, so there is no submenu and no "All" entry. Opens the site in a new window.

import type { PluginCode } from "../../renderer/engine";

export const ENGINES = {
    Google: "https://lens.google.com/uploadbyurl?url=",
    Yandex: "https://yandex.com/images/search?rpt=imageview&url=",
    SauceNAO: "https://saucenao.com/search.php?url=",
    IQDB: "https://iqdb.org/?url=",
    Bing: "https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:",
    TinEye: "https://www.tineye.com/search?url=",
    ImgOps: "https://imgops.com/start?url="
} as const;

/** The address of a search for the picture on a site. */
export function searchUrl(engine: keyof typeof ENGINES, src: string): string {
    return ENGINES[engine] + encodeURIComponent(src);
}

const plugin: PluginCode = {
    start(ctx) {
        ctx.menuItems.add("search-image", click => {
            const src = click.href ?? click.src;
            if (!src || !/^https?:/.test(src)) return null;
            return (Object.keys(ENGINES) as Array<keyof typeof ENGINES>).map(engine => ({
                label: `Search Image: ${engine}`,
                action: () => { window.open(searchUrl(engine, src), "_blank"); }
            }));
        });
    }
};

export default plugin;
