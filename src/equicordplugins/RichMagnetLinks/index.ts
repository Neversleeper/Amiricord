/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin RichMagnetLinks (authors cassie, mochienya, secp192k1) as found in Equicord's copy of Vencord's plugins. Same two patches (a new markdown rule placed before mentions, and the same rule for the message box) and the same reading of the name (`dn`). The link is drawn with a plain element and a small style of its own. Not checked against this Discord build.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCode } from "../../renderer/engine";

const CSS = `
.amiricord-magnet-link { display: inline-flex; align-items: center; gap: 4px; }
.amiricord-magnet-link svg { width: 1em; height: 1em; flex-shrink: 0; }
`;

/** The name of the file in a magnet link, or "unknown filename". */
export function magnetName(link: string): string {
    try {
        const search = link.split("?")[1];
        const name = search ? new URLSearchParams(search).get("dn") : null;
        if (name) return decodeURIComponent(name.replace(/\+/g, " "));
    } catch { /* keep the default */ }
    return "unknown filename";
}

const plugin: PluginCode & { magnetLink(order: number): unknown; } = {
    patches: [
        {
            find: "AUTO_MODERATION_SYSTEM_MESSAGE_RULES:",
            lazy: true,
            required: false,
            replacements: [{ match: /mention:\{order:(\i\.\i\.order)/, replace: "magnet:$self.magnetLink($1),$&" }]
        },
        {
            find: "before:\"@silent\"",
            lazy: true,
            required: false,
            replacements: [{ match: /mention:\{type:/, replace: "magnet:{type:\"inlineObject\"},$&" }]
        }
    ],
    start(ctx) {
        ctx.addStyle(CSS, "magnet-links");
    },
    magnetLink: (order: number) => ({
        order,
        requiredFirstCharacters: ["magnet:?"],
        match: (content: string) => /^magnet:\?[\w\W]+?(?=\s|$)/.exec(content),
        parse: (matched: RegExpExecArray, _parse: unknown, parseProps: Record<string, unknown>) => {
            if (!parseProps.messageId || parseProps.isInsideOfLink) return { type: "text", content: matched[0] };
            return { type: "magnet", filename: magnetName(matched[0]), magnetLink: matched[0] };
        },
        react: ({ magnetLink, filename }: { magnetLink: string; filename: string; }) => {
            const h = (currentReact() as unknown as { createElement(type: unknown, props: unknown, ...children: unknown[]): unknown; }).createElement;
            return h("a", { href: magnetLink, className: "amiricord-magnet-link interactive" },
                h("svg", { xmlns: "http://www.w3.org/2000/svg", fill: "currentColor", viewBox: "0 0 16 16" }, h("path", { d: "M15 12h-4v3h4zM5 12H1v3h4zM0 8a8 8 0 1 1 16 0v8h-6V8a2 2 0 1 0-4 0v8H0z" })),
                filename);
        }
    })
};

export default plugin;
