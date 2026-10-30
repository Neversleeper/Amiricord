/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BetterGifAltText (author Ven) as found in TestCord's copy of Vencord's plugins. Same two patches and same rules for the text. The second patch uses the `#{intl::}` key notation. Not checked live.

import type { PluginCode } from "../../renderer/engine";

interface GifProps { alt?: string; contentType?: string; original?: string; src?: string; }

/** The alt text a GIF should have: "GIF - name words", where the words come from the end of its address. */
export function altText(props: GifProps): string | undefined {
    if (props.contentType && props.contentType !== "image/gif") return props.alt;
    props.alt ??= "GIF";
    if (props.alt !== "GIF") return props.alt;
    let url = props.original || props.src || "";
    try {
        url = decodeURI(url);
    } catch { /* keep the address as it is */ }
    let name = url
        .slice(url.lastIndexOf("/") + 1)
        .replace(/\d/g, "")
        .replace(/.gif$/, "")
        .split(/[,\-_ ]+/g)
        .slice(0, 20)
        .join(" ");
    if (name.length > 300) name = name.slice(0, 300) + "...";
    if (name) props.alt += ` - ${name}`;
    return props.alt;
}

const plugin: PluginCode & { altify(props: GifProps): string | undefined; } = {
    patches: [
        {
            find: ".modalContext})};",
            lazy: true,
            required: false,
            replacements: [{ match: /(return.{0,10}\.jsx.{0,50}isWindowFocused)/, replace: "$self.altify(e);$1" }]
        },
        {
            find: "#{intl::GIF}",
            lazy: true,
            required: false,
            // The property is renamed so the default value can always be used
            replacements: [{ match: /alt:(\i)=(\i\.\i\.string\(\i\.\i#{intl::GIF}\))(?=,[^}]*\}=(\i))/, replace: "alt_$$:$1=$self.altify($3)||$2" }]
        }
    ],

    altify(props) {
        return altText(props);
    }
};

export default plugin;
