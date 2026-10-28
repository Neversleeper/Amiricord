/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GlassPanels (author Sharp) as found in TestCord's plugins (commit af92dba). The original asked
// TestCord for Discord's class names of the sidebar and the member list and wrote them into its style sheet; here the plugin finds the module
// that holds them with the engine's finders and builds the selectors itself. Differences, none tried in a real Discord yet:
//  - a class name is used only if it is made of letters, digits, `_` and `-` (so a odd value cannot add CSS of its own);
//  - if Discord's module is not found, or none of the three names is usable, the start fails and is reported, instead of the plugin looking
//    switched on while doing nothing.

import type { PluginCode } from "../../renderer/engine";

const NAMES = ["sidebar", "membersWrap", "members"] as const;

const GLASS = `{
    background-color: rgba(25, 0, 51, 0.45) !important;
    backdrop-filter: blur(10px) saturate(1.3);
    -webkit-backdrop-filter: blur(10px) saturate(1.3);
}`;

/** `.a.b` for the class value `"a b"`, or undefined when the value is not made only of safe class names. */
export function selectorOf(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const classes = value.trim().split(/\s+/);
    if (!classes.every(name => /^[A-Za-z0-9_-]+$/.test(name))) return undefined;
    return classes.map(name => `.${name}`).join("");
}

/** The style sheet for the class names Discord gave, or undefined when none of them is usable. */
export function buildCss(classes: Record<string, unknown>): string | undefined {
    const selectors = NAMES.map(name => selectorOf(classes[name])).filter((selector): selector is string => selector !== undefined);
    return selectors.length > 0 ? `${selectors.join(", ")} ${GLASS}` : undefined;
}

const plugin: PluginCode = {
    async start(ctx) {
        const classes = await ctx.finders.byProps<Record<string, unknown>>(...NAMES).ready();
        const css = buildCss(classes);
        if (css === undefined) throw new Error("GlassPanels: Discord's class names for the sidebar and the member list were not found");
        ctx.addStyle(css);
    }
};

export default plugin;
