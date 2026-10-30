/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SilentCall (author x2b) as found in TestCord. Same idea: the function Discord uses to start the ringing for a call (found by the names ring and stopRinging) is wrapped, and when the switch is on it does nothing for the kinds of chat you picked. Everything is restored when the plugin stops. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const DM = 1;
const GROUP_DM = 3;

const settings = definePluginSettings({
    isEnabled: { type: "boolean", default: true, description: "Do not ring people when you start a call in a direct message or group chat" },
    silenceGroupCalls: { type: "boolean", default: true, description: "Also in group chats" },
    silenceDMCalls: { type: "boolean", default: true, description: "Also in one-to-one chats" }
});

/** Whether a call in a channel of this kind should not ring. */
export function shouldSilence(channelType: number | undefined, options: { isEnabled: boolean; silenceGroupCalls: boolean; silenceDMCalls: boolean; }): boolean {
    if (!options.isEnabled) return false;
    return (channelType === GROUP_DM && options.silenceGroupCalls) || (channelType === DM && options.silenceDMCalls);
}

interface CallActions { ring(channelId: string, ...rest: unknown[]): unknown; }

let restore: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const actions = ctx.finders.byProps<CallActions>("ring", "stopRinging");
        const channels = ctx.common.ChannelStore;
        const target = actions.get() as unknown as { ring: CallActions["ring"]; } | undefined;
        if (target && typeof target.ring === "function") {
            const original = target.ring;
            target.ring = function (this: unknown, channelId: string, ...rest: unknown[]) {
                const type = (channels.get()?.getChannel(channelId) as { type?: number; } | undefined)?.type;
                if (shouldSilence(type, settings.store)) return undefined;
                return original.call(this, channelId, ...rest);
            };
            restore = () => { target.ring = original; };
        }
        ctx.chatBar.add({
            id: "silent-call",
            label: () => settings.store.isEnabled ? "Calls ring: off (press to turn on)" : "Calls ring: on (press to silence)",
            icon: {
                viewBox: "0 0 24 24",
                path: "M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"
            },
            active: () => settings.store.isEnabled,
            onClick: () => { settings.store.isEnabled = !settings.store.isEnabled; ctx.chatBar.refresh(); }
        });
    },
    stop() {
        restore?.();
        restore = undefined;
    }
};

export default plugin;
