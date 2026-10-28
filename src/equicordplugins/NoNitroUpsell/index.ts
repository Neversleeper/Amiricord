/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin NoNitroUpsell (author thororen) as found in TestCord's copy of Equicord's plugins (commit af92dba).
// Written against Amiricord's engine: Discord's dispatcher and store are found through the plugin's own finders, the plugin waits for them, and
// stopping it unsubscribes and puts the store back.
// One deliberate difference, NOT verified against a real Discord: the original reacts to a new connection only when the account really has
// Nitro (`premiumTypeActual === 2`), so on an account without Nitro the override would not be set again after a reconnect. Here it is set again
// whenever it is not already set, which is what the original's own `start()` does.

import type { PluginCode } from "../../renderer/engine";

const NITRO = 2;

interface Dispatcher {
    subscribe(type: string, callback: () => void): void;
    unsubscribe(type: string, callback: () => void): void;
}

interface PremiumState {
    premiumTypeActual?: number;
    premiumTypeOverride?: number;
}

interface PremiumStore {
    getState(): PremiumState;
}

let running: { dispatcher: Dispatcher; store: PremiumStore; onOpen(): void; } | undefined;
/** Changes at every stop, so a start that was still waiting for Discord's code knows it must not apply anything. */
let generation = 0;

const plugin: PluginCode = {
    async start(ctx) {
        const mine = ++generation;
        const [dispatcher, store] = await Promise.all([
            ctx.finders.byProps<Dispatcher>("dispatch", "subscribe").ready(),
            ctx.finders.byStore<PremiumStore>("OverridePremiumTypeStore").ready()
        ]);
        if (mine !== generation) return;
        const onOpen = () => {
            const state = store.getState();
            if (state.premiumTypeOverride === NITRO) return;
            state.premiumTypeOverride = NITRO;
        };
        onOpen();
        dispatcher.subscribe("CONNECTION_OPEN", onOpen);
        running = { dispatcher, store, onOpen };
    },

    stop() {
        generation++;
        if (!running) return;
        running.dispatcher.unsubscribe("CONNECTION_OPEN", running.onOpen);
        running.store.getState().premiumTypeOverride = undefined;
        running = undefined;
    }
};

export default plugin;
