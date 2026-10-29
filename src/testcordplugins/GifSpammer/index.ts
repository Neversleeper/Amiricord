/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifSpammer (by Neversleeper, who posted it in TestCord as nnenaza) as found in TestCord.
// `/gifspam` sends the address of each of your favourite GIFs to the channel you are in, one message after another, waiting the number of milliseconds you
// give (2000 when you give none). The owner made it to move all her favourites into a backup server of her own.
// Differences, NOT verified in a real Discord:
//  - the original answered with messages only you could see; the engine has no such messages, so the progress is shown in small notices (toasts);
//  - the messages are sent through Discord's own request for a new message (like VoiceMessages), where the original called Discord's send function;
//  - `/gifspam-stop` is new: it stops a run that is going on (the original had no way to stop but to reload Discord); starting a second run while one is going is
//    refused; a message that Discord refuses (a rate limit, a channel you cannot write in) is skipped and counted instead of stopping the run;
//  - the favourites are read the way GifTransfer reads them, from Discord's settings store.

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface ProtoStore { frecencyWithoutFetchingLatest?: { favoriteGifs?: { gifs?: Record<string, { src?: string; } | undefined>; }; }; }
interface Rest { post(request: { url: string; body: Record<string, unknown>; }): Promise<unknown>; }

const DEFAULT_DELAY_MS = 2000;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/** The address of every favourite GIF, in the order Discord keeps them. Entries without an address are left out. */
export function favouriteUrls(store: ProtoStore | undefined): string[] {
    const gifs = store?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {};
    return Object.entries(gifs).map(([key, gif]) => gif?.src ?? key).filter(url => typeof url === "string" && url !== "");
}

/** The delay asked for: a number of milliseconds from 0 up, or the default when none was given or it was not a usable number. */
export function delayOf(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_DELAY_MS;
}

/** A message id Discord accepts as a nonce: the current time as one of its own ids. */
const nonce = () => String((BigInt(Date.now()) - DISCORD_EPOCH_MS) << 22n);

let running = false;
let cancelled = false;
let generation = 0;

const plugin: PluginCode = {
    start(ctx: EnginePluginContext) {
        const mine = ++generation;
        const store = ctx.finders.byStore<ProtoStore>("UserSettingsProtoStore");
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

        ctx.commands.add({
            name: "gifspam",
            description: "Send all your favorite GIFs to this channel",
            options: [{ name: "delay", description: "Delay between GIFs in milliseconds (default: 2000)", type: "number", required: false }],
            async execute(args) {
                if (running) { ctx.toasts.show("GIF spam is already running. Use /gifspam-stop to stop it.", "failure"); return; }
                const channelId = ctx.common.SelectedChannelStore.get()?.getChannelId();
                const api = rest.get();
                if (!channelId || !api) { ctx.toasts.show("Open a channel first (Discord's request function was not found otherwise).", "failure"); return; }
                const urls = favouriteUrls(store.get());
                if (urls.length === 0) { ctx.toasts.show("You have no favorite GIFs!", "failure"); return; }
                const delay = delayOf(args.find(argument => argument.name === "delay")?.value);

                running = true;
                cancelled = false;
                ctx.toasts.show(`Sending ${urls.length} GIFs with ${delay} ms between them...`, "info");
                let sent = 0;
                let skipped = 0;
                try {
                    for (let index = 0; index < urls.length; index++) {
                        if (cancelled || mine !== generation) break;
                        try {
                            await api.post({ url: `/channels/${channelId}/messages`, body: { content: urls[index], tts: false, nonce: nonce() } });
                            sent++;
                        } catch {
                            skipped++;
                        }
                        if (index < urls.length - 1) await sleep(delay);
                    }
                } finally {
                    running = false;
                }
                const stopped = cancelled || mine !== generation;
                ctx.toasts.show(`${stopped ? "Stopped" : "Done"}: ${sent} GIFs sent${skipped > 0 ? `, ${skipped} skipped (Discord did not accept them)` : ""}.`, skipped > 0 || stopped ? "failure" : "success");
            }
        });

        ctx.commands.add({
            name: "gifspam-stop",
            description: "Stop /gifspam while it is sending",
            execute() {
                if (!running) { ctx.toasts.show("Nothing is being sent.", "info"); return; }
                cancelled = true;
            }
        });
    },

    stop() {
        // A run that is going on ends at its next step.
        generation++;
        cancelled = true;
    }
};

export default plugin;
