/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GhostTyping (author sirphantom89) as found in TestCord. A button in the message box (and /ghosttyping) makes you look like you are typing in a channel until you switch it off: Discord's own "start typing" call is repeated every 8 seconds. New: a channel switches itself off after the time in the settings (default 10 minutes, so it cannot be left on by accident), and everything stops when the plugin stops. Not tried in a real Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    maxMinutes: { type: "number", default: 10, min: 1, max: 240, integer: true, description: "Switch it off by itself after this many minutes" }
});

export const PING_MS = 8000;

/** The channels still within their time, given when each was switched on. */
export function stillActive(started: ReadonlyMap<string, number>, now: number, maxMinutes: number): string[] {
    return [...started].filter(([, at]) => now - at < maxMinutes * 60000).map(([id]) => id);
}

interface Typing { startTyping(channelId: string): void; stopTyping(channelId: string): void; }

const ICON = { viewBox: "0 0 24 24", path: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm4 5.5a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm4 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm4 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z" };

let stop: (() => void) | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        const typing = ctx.finders.byProps<Typing>("startTyping", "stopTyping");
        const selected = ctx.common.SelectedChannelStore;
        const started = new Map<string, number>();
        let timer: ReturnType<typeof setInterval> | undefined;
        const ping = () => {
            const live = stillActive(started, Date.now(), settings.store.maxMinutes);
            for (const id of [...started.keys()]) if (!live.includes(id)) { started.delete(id); typing.get()?.stopTyping(id); }
            for (const id of live) typing.get()?.startTyping(id);
            if (started.size === 0 && timer !== undefined) { clearInterval(timer); timer = undefined; }
            ctx.chatBar.refresh();
        };
        const toggle = (channelId: string): boolean => {
            if (started.has(channelId)) {
                started.delete(channelId);
                typing.get()?.stopTyping(channelId);
            } else {
                started.set(channelId, Date.now());
            }
            if (started.size > 0 && timer === undefined) timer = setInterval(ping, PING_MS);
            ping();
            return started.has(channelId);
        };
        const here = () => selected.get()?.getChannelId();
        ctx.chatBar.add({
            id: "ghost-typing",
            label: () => (here() && started.has(here()!) ? "Ghost Typing: on (click to stop)" : "Ghost Typing: look like you are typing"),
            icon: ICON,
            active: () => { const id = here(); return !!id && started.has(id); },
            onClick: () => { const id = here(); if (id) toggle(id); }
        });
        ctx.commands.add({
            name: "ghosttyping",
            description: "Toggle looking like you are typing in this channel",
            execute() {
                const id = here();
                if (!id) return undefined;
                ctx.toasts.show(toggle(id) ? "Ghost Typing is on in this channel." : "Ghost Typing is off.", "info");
                return undefined;
            }
        });
        stop = () => {
            if (timer !== undefined) clearInterval(timer);
            for (const id of started.keys()) typing.get()?.stopTyping(id);
            started.clear();
        };
    },
    stop() {
        stop?.();
        stop = undefined;
    }
};

export default plugin;
