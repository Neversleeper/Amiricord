/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SilentMessageToggle (authors Nuckyz, CatNoir, Z1xus) as found in TestCord's copy of Vencord's plugins. Same rule: Discord's "@silent " prefix is put at the start of the message. The three ways of remembering the state became one option (reset when you change channel is not possible without a channel hook, so "off" means it turns itself off after one message, or stays on). Uses ctx.chatBar and the before-send hook.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    autoDisable: { type: "boolean", default: true, description: "Turn it off again after sending one silent message" },
    enabled: { type: "boolean", default: false, description: "The next message is sent silently" }
});

/** The message with Discord's silent prefix, once. */
export function silently(content: string): string {
    return content.startsWith("@silent ") ? content : `@silent ${content}`;
}

const plugin: PluginCode = {
    settings,
    start(ctx) {
        ctx.messageEvents.onBeforeSend(content => {
            if (!settings.store.enabled) return content;
            if (settings.store.autoDisable) { settings.store.enabled = false; ctx.chatBar.refresh(); }
            return silently(content);
        });
        ctx.chatBar.add({
            id: "silent-message",
            label: () => settings.store.enabled ? "Disable Silent Message" : "Enable Silent Message",
            icon: {
                viewBox: "0 0 24 24",
                path: "M18 10.7101C15.1085 9.84957 13 7.17102 13 4c0-.30736.0198-.6101.0582-.907C12.7147 3.03189 12.3611 3 12 3 8.686 3 6 5.686 6 9v5c0 1.657-1.344 3-3 3v1h18v-1c-1.656 0-3-1.343-3-3v-3.2899ZM8.55493 19c.693 1.19 1.96897 2 3.44497 2s2.752-.81 3.445-2H8.55493ZM18.2624 5.50209 21 2.5V1h-4.9651v1.49791h2.4411L16 5.61088V7h5V5.50209h-2.7376Z"
            },
            active: () => settings.store.enabled,
            onClick: () => { settings.store.enabled = !settings.store.enabled; ctx.chatBar.refresh(); }
        });
    }
};

export default plugin;
