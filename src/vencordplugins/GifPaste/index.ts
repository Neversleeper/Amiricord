/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifPaste (author Ven) as found in TestCord's copy of Vencord's plugins. Same patch (checked on build 653945: it matches once).
// Differences: the text goes into the chat box through Discord's own `ComponentDispatch` (found by its function name, not checked on a live page), and the picker
// is closed through Discord's expression picker store when it can be found; if it cannot, the link is still pasted and the picker stays open.

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface Dispatch { dispatchToLastSubscribed(event: string, data: { plainText: string; }): void; }
interface PickerStore { closeExpressionPicker(): void; }

let context: EnginePluginContext | undefined;

const plugin: PluginCode & { handleSelect(gif?: { url?: string; }): void; } = {
    patches: [
        {
            find: "handleSelectGIF=",
            lazy: true,
            replacements: [{
                match: /handleSelectGIF=\((\i),\i\)=>\{/,
                replace: "$&if (!this?.props?.className) return $self.handleSelect($1);"
            }]
        }
    ],

    start(ctx) {
        context = ctx;
    },

    stop() {
        context = undefined;
    },

    handleSelect(gif) {
        const ctx = context;
        if (!ctx || typeof gif?.url !== "string") return;
        try {
            ctx.finders.byProps<Dispatch>("dispatchToLastSubscribed", "dispatch").get()?.dispatchToLastSubscribed("INSERT_TEXT", { plainText: `${gif.url} ` });
            ctx.finders.byProps<PickerStore>("closeExpressionPicker").get()?.closeExpressionPicker();
        } catch (error) {
            ctx.reportError("GifPaste", error);
        }
    }
};

export default plugin;
