/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ComposeMode (author x2b) as found in TestCord. The Enter key is caught in the message box before Discord sees it: a plain Enter inserts a line break and Ctrl+Enter is passed on as Enter so Discord sends. The original adds a button; here the switch is the setting and the /compose command. Not tried in a real Discord, so whether the editor accepts the line break is not known.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    active: { type: "boolean", default: true, description: "Enter writes a new line; Ctrl+Enter sends" }
});

/** What to do with a key press in the box: add a line break, let Discord send, or leave it alone. */
export function composeAction(key: string, ctrl: boolean, shift: boolean, alt: boolean, active: boolean): "newline" | "send" | "none" {
    if (!active || key !== "Enter" || shift || alt) return "none";
    return ctrl ? "send" : "newline";
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        let passing = false;
        const onKey = (event: KeyboardEvent) => {
            if (passing || !event.isTrusted) return;
            const target = event.target as Element | null;
            if (!target?.closest?.("[role=\"textbox\"][data-slate-editor]")) return;
            const action = composeAction(event.key, event.ctrlKey || event.metaKey, event.shiftKey, event.altKey, settings.store.active);
            if (action === "none") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (action === "newline") { document.execCommand("insertLineBreak"); return; }
            passing = true;
            try { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })); } finally { passing = false; }
        };
        document.addEventListener("keydown", onKey, true);
        ctx.onDispose(() => { document.removeEventListener("keydown", onKey, true); });
        ctx.commands.add({
            name: "compose",
            description: "Turn Compose Mode on or off",
            execute() {
                settings.store.active = !settings.store.active;
                ctx.toasts.show(`Compose Mode is ${settings.store.active ? "on" : "off"}.`, "success");
            }
        });
    }
};

export default plugin;
