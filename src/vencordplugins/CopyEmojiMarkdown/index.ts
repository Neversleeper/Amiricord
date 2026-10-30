/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CopyEmojiMarkdown (authors HappyEnderman, Vishnya) as found in TestCord's copy of Vencord's plugins. The original adds the item to Discord's own menu; here it is added to Amiricord's right-click menu and the emoji is read from the clicked picture (`data-type="emoji"`, `data-id`, `data-name`). For a default emoji, Discord's own name-to-character function is used when it can be found, else the `:name:` form. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    copyUnicode: { type: "boolean", default: true, description: "For default emojis, copy the character itself instead of :name:" }
});

/** The text of an emoji: `<:name:id>` (with `a` when animated) for a server emoji, the character or `:name:` for a default one. */
export function emojiMarkdown(emoji: { id?: string; name: string; animated: boolean; }, copyUnicode: boolean, toCharacter: (name: string) => string | undefined): string {
    if (!emoji.id) return copyUnicode ? (toCharacter(emoji.name) ?? `:${emoji.name}:`) : `:${emoji.name}:`;
    return `<${emoji.animated ? "a" : ""}:${emoji.name.replace(/~\d+$/, "")}:${emoji.id}>`;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const surrogates = ctx.finders.byProps<{ convertNameToSurrogate(name: string): string; }>("convertNameToSurrogate");
        ctx.menuItems.add("copy-emoji-markdown", click => {
            const element = (click.target as Element).closest?.("[data-type=\"emoji\"]") as HTMLElement | null | undefined;
            if (!element) return null;
            const image = element.querySelector("img");
            let animated = false;
            try {
                const url = new URL(image?.src ?? "", "https://cdn.discordapp.com");
                animated = url.searchParams.get("animated") === "true" || url.pathname.endsWith(".gif");
            } catch { /* not an address */ }
            const emoji = { id: element.dataset.id || undefined, name: element.dataset.name ?? "", animated };
            if (emoji.name === "") return null;
            return {
                label: "Copy Emoji Markdown",
                action: async () => {
                    try {
                        await navigator.clipboard.writeText(emojiMarkdown(emoji, settings.store.copyUnicode, name => surrogates.get()?.convertNameToSurrogate(name)));
                        ctx.toasts.show("Copied the emoji markdown!", "success");
                    } catch (error) {
                        ctx.reportError("CopyEmojiMarkdown", error);
                        ctx.toasts.show("Could not copy the emoji", "failure");
                    }
                }
            };
        });
    }
};

export default plugin;
