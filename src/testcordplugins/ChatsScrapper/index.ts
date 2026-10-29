/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ChatsScrapper (author x2b) as found in TestCord. `/chats-scrapper` closes every one-to-one direct-message chat except
// the ones with the people in the "keep" list (user ids in the plugin's settings). Closing only hides a chat from your list: the messages stay.
// Differences, NOT verified in a real Discord:
//  - the original was a button with a window to pick the people to keep; this one is a command and the list is a setting (the person's id: right-click them, Copy User ID);
//  - it asks first and says how many chats it will close and how many it keeps; the original closed at the first press of "Start";
//  - it closes with Discord's own function and waits 300 ms between chats (the original sent a DELETE to `/channels/<id>` for each chat, with no wait and no way to stop);
//    `/chats-scrapper-stop` stops a run.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const SNOWFLAKE = /^\d{15,25}$/;
export const PAUSE_MS = 300;
const DM_TYPE = 1;

export interface DmLike { id: string; type: number; recipients?: readonly string[]; }

/** The ids in a list written with commas, spaces or new lines; whatever is not an id is left out; each once. */
export function parseIds(text: string): string[] {
    return [...new Set(text.split(/[\s,;]+/).filter(part => SNOWFLAKE.test(part)))];
}

/** The chats to close and the ones kept: one-to-one chats only; a chat is kept when its other person is in `keep`. */
export function plan(channels: readonly DmLike[], keep: readonly string[]): { close: string[]; kept: number; } {
    const close: string[] = [];
    let kept = 0;
    for (const channel of channels) {
        if (channel.type !== DM_TYPE) continue;
        const other = channel.recipients?.[0];
        if (other !== undefined && keep.includes(other)) kept++;
        else close.push(channel.id);
    }
    return { close, kept };
}

export function confirmationText(close: number, kept: number): string {
    return `Close ${close} direct-message ${close === 1 ? "chat" : "chats"} and keep ${kept}?\n\nGroup chats are always kept. The messages are not deleted: a chat comes back when either of you writes. You can stop it with /chats-scrapper-stop.`;
}

const settings = definePluginSettings({
    keep: { type: "string", default: "", maxLength: 5000, description: "User ids of the people whose chats are kept, separated by commas or spaces" }
});

interface ChannelActions { closePrivateChannel(id: string): unknown; }
interface SortStore { getPrivateChannelIds(): string[]; }

let running = false;
let stopRequested = false;
let generation = 0;

const plugin: PluginCode = {
    settings,

    start(ctx) {
        const mine = ++generation;
        const actions = ctx.finders.byProps<ChannelActions>("openPrivateChannel", "closePrivateChannel");
        const sortStore = ctx.finders.byStore<SortStore>("PrivateChannelSortStore");
        const channels = ctx.common.ChannelStore;
        const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

        ctx.commands.add({
            name: "chats-scrapper",
            description: "Close all one-to-one chats except the people in the keep list, asking first",
            async execute() {
                if (running) { ctx.toasts.show("Chats are already being closed. Use /chats-scrapper-stop to stop.", "failure"); return; }
                const creators = actions.get();
                const store = sortStore.get();
                const channelStore = channels.get();
                if (!creators || !store || !channelStore) { ctx.toasts.show("Discord's chat functions were not found, so nothing was closed.", "failure"); return; }
                const known = store.getPrivateChannelIds().flatMap(id => {
                    const channel = channelStore.getChannel(id) as unknown as DmLike | undefined;
                    return channel ? [channel] : [];
                });
                const { close, kept } = plan(known, parseIds(settings.store.keep));
                if (close.length === 0) { ctx.toasts.show("There are no chats to close.", "info"); return; }
                if (!(globalThis as unknown as { confirm(question: string): boolean; }).confirm(confirmationText(close.length, kept))) return;

                running = true;
                stopRequested = false;
                let closed = 0;
                let failed = 0;
                try {
                    for (let index = 0; index < close.length; index++) {
                        if (stopRequested || mine !== generation) break;
                        try {
                            await creators.closePrivateChannel(close[index]);
                            closed++;
                        } catch {
                            failed++;
                        }
                        if (index < close.length - 1) await pause(PAUSE_MS);
                    }
                } finally {
                    running = false;
                }
                const stopped = stopRequested || mine !== generation;
                ctx.toasts.show(`${stopped ? "Stopped" : "Done"}: closed ${closed}${failed > 0 ? `, ${failed} failed` : ""}.`, failed > 0 || stopped ? "failure" : "success");
            }
        });

        ctx.commands.add({
            name: "chats-scrapper-stop",
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
