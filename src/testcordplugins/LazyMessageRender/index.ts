/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin LazyMessageRender (author x2b) as found in TestCord's plugins (commit af92dba). The original
// asked TestCord for Discord's class name of a message row and wrote it into its style sheet; here the plugin finds the module that holds it
// with the engine's finders and builds the selectors itself. Differences, none tried in a real Discord yet:
//  - a class name is used only if it is made of letters, digits, `_` and `-`;
//  - if Discord's module is not found or the name is not usable, the start fails and is reported, instead of the plugin looking switched on
//    while doing nothing.
// What it does: the message under the pointer (or with the focus inside) is lifted one level, so its action toolbar is not cut off by the row
// above it.

import type { PluginCode } from "../../renderer/engine";

/** `.a.b` for the class value `"a b"`, or undefined when the value is not made only of safe class names. */
export function selectorOf(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const classes = value.trim().split(/\s+/);
    if (!classes.every(name => /^[A-Za-z0-9_-]+$/.test(name))) return undefined;
    return classes.map(name => `.${name}`).join("");
}

/** The style sheet for the class value Discord gave, or undefined when it is not usable. */
export function buildCss(messageListItem: unknown): string | undefined {
    const item = selectorOf(messageListItem);
    if (item === undefined) return undefined;
    return `${item}:hover,
${item}:focus-within {
    position: relative;
    z-index: 2;
}

${item}:hover + ${item},
${item}:focus-within + ${item},
${item}:has(+ ${item}:hover),
${item}:has(+ ${item}:focus-within) {
    z-index: 1;
}`;
}

const plugin: PluginCode = {
    async start(ctx) {
        const classes = await ctx.finders.byProps<Record<string, unknown>>("messageListItem").ready();
        const css = buildCss(classes.messageListItem);
        if (css === undefined) throw new Error("LazyMessageRender: Discord's class name for a message row was not found");
        ctx.addStyle(css);
    }
};

export default plugin;
