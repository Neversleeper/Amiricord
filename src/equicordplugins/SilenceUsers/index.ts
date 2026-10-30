/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SilenceUsers (author dka) as found in Equicord's copy of Vencord's plugins. Same rule, same interceptor on Discord's dispatcher (found by name when the plugin starts). The interceptor is taken off when the plugin stops.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    mutedUserIds: { type: "string", default: "", description: "IDs of the people to silence, separated by commas" }
});

interface Interceptable { addInterceptor?(interceptor: (event: unknown) => unknown): void; _interceptors?: unknown[]; }
interface Author { author?: { id?: unknown; }; }
interface Event { type?: string; message?: Author & { mention_everyone?: boolean; mention_roles?: unknown[]; mentions?: unknown[]; }; notification?: { message?: Author; }; }

/** The ids in a "1, 2, 3" list. */
export function mutedIds(text: string): Set<string> {
    return new Set(text.split(",").map(id => id.trim()).filter(Boolean));
}

/** Takes the pings out of a message by a silenced person, or returns false for a notification that should not be shown. */
export function silence(event: Event, muted: Set<string>): false | undefined {
    if (muted.size === 0) return undefined;
    if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
        const message = event.message;
        if (!message || !muted.has(String(message.author?.id ?? ""))) return undefined;
        message.mention_everyone = false;
        message.mention_roles = [];
        message.mentions = [];
    }
    if (event.type === "NOTIFICATION_CREATE") {
        const message = event.message ?? event.notification?.message;
        if (message && muted.has(String(message.author?.id ?? ""))) return false;
    }
    return undefined;
}

const interceptor = (event: unknown) => {
    try {
        return silence(event as Event, mutedIds(settings.store.mutedUserIds));
    } catch {
        return undefined;
    }
};

let dispatcher: { get(): Interceptable | undefined; } | undefined;

const plugin: PluginCode = {
    settings,
    start(ctx) {
        dispatcher = ctx.common.FluxDispatcher as unknown as typeof dispatcher;
        void ctx.common.FluxDispatcher.ready().then(found => (found as Interceptable).addInterceptor?.(interceptor)).catch(error => ctx.reportError("SilenceUsers", error));
    },
    stop() {
        const list = dispatcher?.get()?._interceptors;
        const index = list?.indexOf(interceptor) ?? -1;
        if (index !== -1) list?.splice(index, 1);
        dispatcher = undefined;
    }
};

export default plugin;
