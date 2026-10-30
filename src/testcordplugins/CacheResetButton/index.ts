/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CacheResetButton (author x2b) as found in TestCord. A cautious version of the original's header button: only stores with a clearing function of their own that are not the message list are cleared (the original also empties the message cache, which makes the open chat reload). Which stores were cleared is shown in a notice. Nothing is deleted from your account; Discord loads what it needs again.

import type { PluginCode } from "../../renderer/engine";

/** Discord's store names that are safe to clear: caches of things that load again on their own. */
export const CACHE_STORES = [
    "ApplicationStreamPreviewStore", "SpellCheckStore", "UserAffinitiesStore", "ApplicationCommandIndexStore", "StickersStore", "SoundboardStore",
    "ApplicationStreamingStore", "InviteStore", "TypingStore", "ActiveJoinedThreadsStore"
] as const;

/** Calls `clearCache` on each store that has it; returns the names that were cleared. A store that throws is skipped. */
export function clearStores(stores: Array<{ name: string; store: { clearCache?(): void; } | undefined; }>): string[] {
    const cleared: string[] = [];
    for (const { name, store } of stores) {
        try {
            if (store && typeof store.clearCache === "function") { store.clearCache(); cleared.push(name); }
        } catch { /* skip this store */ }
    }
    return cleared;
}

const plugin: PluginCode = {
    start(ctx) {
        const finders = CACHE_STORES.map(name => ({ name, finder: ctx.finders.byStore<{ clearCache?(): void; }>(name) }));
        ctx.commands.add({
            name: "clearcache",
            description: "Clear some of Discord's in-memory caches",
            execute() {
                const cleared = clearStores(finders.map(({ name, finder }) => ({ name, store: finder.get() })));
                ctx.toasts.show(cleared.length > 0 ? `Cleared: ${cleared.join(", ")}` : "No cache could be cleared.", cleared.length > 0 ? "success" : "failure");
            }
        });
    }
};

export default plugin;
