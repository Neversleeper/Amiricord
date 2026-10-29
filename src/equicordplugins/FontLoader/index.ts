/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FontLoader (author vmohammad) as found in Equicord. Loads a font from Google Fonts and makes Discord use it
// (`--font-primary`, `--font-display`, `--font-headline`, and `--font-code` when asked). Differences, NOT verified in a real Discord:
//  - the original had a search box that asked fonts.google.com for the whole catalogue; this one asks you to type the name of the font as Google Fonts writes it
//    (for example "Nunito" or "Fira Sans"), so the only address contacted is the one that gives the font. The plugin's card says so (permissions);
//  - the name is checked (letters, digits and spaces) before it goes into the style, so a name cannot carry other CSS;
//  - Discord's own page rules (its security policy) may refuse the font address; if the font does not appear, that is the first thing to look at.
// Privacy: loading a font tells Google's servers your address and that you use that font. Nothing is requested while the plugin is off or no font is chosen.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/;
const WEIGHTS = "300;400;500;600;700";

/** The font name when it is plain (letters, digits, single spaces), or undefined. */
export function cleanFamily(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const name = value.trim().replace(/\s+/g, " ");
    return NAME.test(name) ? name : undefined;
}

/** The style that loads the font and puts it in Discord's font variables; an empty text when there is no valid font. */
export function fontCss(family: unknown, onCode: boolean): string {
    const name = cleanFamily(family);
    if (!name) return "";
    return [
        `@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@${WEIGHTS}&display=swap");`,
        "* {",
        `    --font-primary: '${name}', sans-serif !important;`,
        `    --font-display: '${name}', sans-serif !important;`,
        `    --font-headline: '${name}', sans-serif !important;`,
        onCode ? `    --font-code: '${name}', monospace !important;` : "",
        "}"
    ].filter(line => line !== "").join("\n");
}

const settings = definePluginSettings({
    font: { type: "string", default: "", maxLength: 60, description: "The name of a font from Google Fonts, written as Google writes it (for example Nunito or Fira Sans). Empty keeps Discord's font." },
    applyOnCodeBlocks: { type: "boolean", default: false, description: "Use the font in code blocks too" }
});

const plugin: PluginCode = {
    settings,

    start(ctx) {
        const handle = ctx.addStyle("", "font");
        const apply = () => { handle.update(fontCss(settings.store.font, settings.store.applyOnCodeBlocks)); };
        apply();
        const offFont = settings.onChange("font", apply);
        const offCode = settings.onChange("applyOnCodeBlocks", apply);
        ctx.onDispose(() => { offFont(); offCode(); });
        if (settings.store.font.trim() !== "" && cleanFamily(settings.store.font) === undefined) ctx.toasts.show("The font name can only have letters, digits and spaces.", "failure");
    }
};

export default plugin;
