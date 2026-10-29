/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CloseAllDms (author x2b) as found in TestCord. `/close-all-dms` closes every one-to-one direct-message chat (group chats are
// kept), one by one. Closing a chat only hides it from your list: the messages stay and the chat comes back when either of you writes. Differences, NOT verified in a real Discord:
//  - the original had a menu item on three different Discord menus that closed everything at the first click; this one is a command that asks first and says how many chats it will close;
//  - the original waited 50 ms between chats, which is stepped here to 300 ms, and `/close-all-dms-stop` stops a run; the original had no way to stop;
//  - Discord's own function is found by its properties (`openPrivateChannel`, `closePrivateChannel`); when it is missing nothing is closed (the original sent a made-up
//    event to Discord's dispatcher instead, which could leave the chat in the list while the page believed it was closed).

import type { PluginCode } from "../../renderer/engine";

export const PAUSE_MS = 300;
/** Discord's channel type for a one-to-one direct message. */
const DM_TYPE = 1;

export interface ChannelLike { id: string; type: number; }

/** The ids of the one-to-one chats among `ids`, in the same order; group chats and unknown channels are left out. */
export function oneToOneIds(ids: readonly string[], channelOf: (id: string) => ChannelLike | undefined): string[] {
    return ids.filter(id => channelOf(id)?.type === DM_TYPE);
}

export function confirmationText(count: number): string {
    return `Close ${count} direct-message ${count === 1 ? "chat" : "chats"}?\n\nGroup chats are kept. The messages are not deleted: a chat comes back when either of you writes. It takes about ${Math.ceil((count * PAUSE_MS) / 1000)} seconds. You can stop it with /close-all-dms-stop.`;
}

interface ChannelActions { closePrivateChannel(id: string): unknown; }
interface SortStore { getPrivateChannelIds(): string[]; }

let running = false;
let stopRequested = false;
let generation = 0;

const plugin: PluginCode = {
    start(ctx) {
        const mine = ++generation;
        const actions = ctx.finders.byProps<ChannelActions>("openPrivateChannel", "closePrivateChannel");
        const sortStore = ctx.finders.byStore<SortStore>("PrivateChannelSortStore");
        const channels = ctx.common.ChannelStore;
        const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

        ctx.commands.add({
            name: "close-all-dms",
            description: "Close all one-to-one direct-message chats (group chats are kept), asking first",
            async execute() {
                if (running) { ctx.toasts.show("Chats are already being closed. Use /close-all-dms-stop to stop.", "failure"); return; }
                const creators = actions.get();
                const store = sortStore.get();
                if (!creators || !store) { ctx.toasts.show("Discord's chat functions were not found, so nothing was closed.", "failure"); return; }
                const channelStore = channels.get();
                const ids = oneToOneIds(store.getPrivateChannelIds(), id => channelStore?.getChannel(id) as ChannelLike | undefined);
                if (ids.length === 0) { ctx.toasts.show("There are no one-to-one chats to close.", "info"); return; }
                if (!(globalThis as unknown as { confirm(question: string): boolean; }).confirm(confirmationText(ids.length))) return;

                running = true;
                stopRequested = false;
                let closed = 0;
                let failed = 0;
                try {
                    for (let index = 0; index < ids.length; index++) {
                        if (stopRequested || mine !== generation) break;
                        try {
                            await creators.closePrivateChannel(ids[index]);
                            closed++;
                        } catch {
                            failed++;
                        }
                        if (index < ids.length - 1) await pause(PAUSE_MS);
                    }
                } finally {
                    running = false;
                }
                const stopped = stopRequested || mine !== generation;
                ctx.toasts.show(`${stopped ? "Stopped" : "Done"}: closed ${closed}${failed > 0 ? `, ${failed} failed` : ""}.`, failed > 0 || stopped ? "failure" : "success");
            }
        });

        ctx.commands.add({
            name: "close-all-dms-stop",
            description: "Stop closing chats",
            execute() {
                if (!running) { ctx.toasts.show("Nothing is being closed.", "info"); return; }
                stopRequested = true;
                ctx.toasts.show("Stopping...", "info");
            }
        });
    },

    stop() {
        generation++;
        stopRequested = true;
    }
};

export default plugin;
