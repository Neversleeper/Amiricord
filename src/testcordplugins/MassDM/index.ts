/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MassDM (by Neversleeper, who posted it in TestCord as nnenaza) as found in TestCord.
// `/massdm message [delay]` sends one message, as a direct message, to your friends or to everyone you have an open direct-message chat with, optionally only to
// (whitelist) or except (blacklist) a list of user ids. The owner made it to tell her friends the name of her new account when she changes account.
// Differences from the original, NOT verified in a real Discord (the owner knows them; they were chosen by Claude, not by her):
//  - it asks first: it says how many people will get the message and shows the text, and nothing is sent until you accept;
//  - the wait between messages is at least 1 second (1.5 seconds when you give none; the original took any number and 100 ms when you gave none), which also keeps
//    Discord's own spam checks from catching your account; `/massdm-stop` stops a run that is going on (the original had no way to stop);
//  - the automatic replies ("answer this word with that message") are NOT carried over: they answered anybody, in any channel, without being asked;
//  - the option "only friends" is gone: it did nothing the option "include friends" did not already do;
//  - the answers are small notices (toasts) instead of messages only you could see, and the direct-message chat is opened with Discord's own request.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

export const MIN_DELAY_MS = 1000;
export const DEFAULT_DELAY_MS = 1500;
export const MAX_MESSAGE_CHARS = 2000;
const SNOWFLAKE = /^\d{15,25}$/;
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

/** The wait between messages: what was asked for when it is a number of at least 1000 ms, 1000 when it is lower, 1500 when none was given. */
export function delayOf(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DELAY_MS;
    return Math.max(MIN_DELAY_MS, Math.floor(value));
}

/** The ids in a list written with commas, spaces or new lines; whatever is not an id is left out. */
export function parseIds(text: string): string[] {
    return [...new Set(text.split(/[\s,;]+/).map(part => part.trim()).filter(part => SNOWFLAKE.test(part)))];
}

export interface RecipientSources { friendIds: readonly string[]; openDmUserIds: readonly string[]; selfId: string | undefined; }
export interface RecipientRules { friends: boolean; allOpenDMs: boolean; useWhitelist: boolean; userIds: string; }

/** Who gets the message: the people of the chats you have open, or your friends; without yourself, each once, filtered by the list of ids. */
export function recipients(sources: RecipientSources, rules: RecipientRules): string[] {
    const base = rules.allOpenDMs ? sources.openDmUserIds : rules.friends ? sources.friendIds : [];
    const unique = [...new Set(base)].filter(id => id !== sources.selfId);
    const list = parseIds(rules.userIds);
    if (list.length === 0) return unique;
    return rules.useWhitelist ? unique.filter(id => list.includes(id)) : unique.filter(id => !list.includes(id));
}

/** The question asked before anything is sent. */
export function confirmationText(count: number, message: string, delay: number, allOpenDMs: boolean): string {
    const preview = message.length > 200 ? `${message.slice(0, 200)}...` : message;
    const seconds = Math.ceil((count * delay) / 1000);
    return `Send this message to ${count} ${count === 1 ? "person" : "people"} (${allOpenDMs ? "everyone you have an open chat with" : "your friends"}) as a direct message?\n\n"${preview}"\n\nIt takes about ${seconds} seconds. You can stop it with /massdm-stop. Messages that were already sent cannot be taken back.`;
}

const settings = definePluginSettings({
    friends: { type: "boolean", default: true, description: "Include friends in mass DM" },
    allOpenDMs: { type: "boolean", default: false, description: "Send to everyone you have an open direct-message chat with instead of your friends" },
    useWhitelist: { type: "boolean", default: false, description: "Treat the user ids list as a whitelist (only message them) instead of a blacklist (leave them out)" },
    userIds: { type: "string", default: "", maxLength: 5000, description: "User ids separated by commas, used as a blacklist or a whitelist depending on the setting above" }
});

interface Rest { post(request: { url: string; body: unknown; rejectWithError?: boolean; }): Promise<{ body?: unknown; }>; }

let running = false;
let stopRequested = false;
let generation = 0;

const nonce = () => String((BigInt(Date.now()) - DISCORD_EPOCH_MS) << 22n);

const plugin: PluginCode = {
    settings,

    start(ctx) {
        const mine = ++generation;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const channelStore = ctx.common.ChannelStore;
        const relationshipStore = ctx.common.RelationshipStore;
        const users = ctx.common.UserStore;
        const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

        ctx.commands.add({
            name: "massdm",
            description: "Send a message to your friends (or open chats), asking first",
            options: [
                { name: "message", description: "The message to send", type: "string", required: true },
                { name: "delay", description: "Wait between messages in milliseconds (at least 1000, default 1500)", type: "number", required: false }
            ],
            async execute(args) {
                const message = String(args.find(argument => argument.name === "message")?.value ?? "").trim();
                const delay = delayOf(args.find(argument => argument.name === "delay")?.value);
                if (message === "") { ctx.toasts.show("Please give a message.", "failure"); return; }
                if (message.length > MAX_MESSAGE_CHARS) { ctx.toasts.show(`The message is too long (at most ${MAX_MESSAGE_CHARS} characters).`, "failure"); return; }
                if (running) { ctx.toasts.show("A mass message is already going out. Use /massdm-stop to stop it.", "failure"); return; }
                const api = rest.get();
                if (!api) { ctx.toasts.show("Discord's request function was not found.", "failure"); return; }

                const dms = (channelStore.get() as unknown as { getMutableDMsByUserIds?(): Record<string, string>; getDMFromUserId?(id: string): string | undefined; } | undefined);
                const friendIds = (relationshipStore.get() as unknown as { getFriendIDs?(): string[]; } | undefined)?.getFriendIDs?.() ?? [];
                const targets = recipients({ friendIds, openDmUserIds: Object.keys(dms?.getMutableDMsByUserIds?.() ?? {}), selfId: users.get()?.getCurrentUser()?.id }, settings.store);
                if (targets.length === 0) { ctx.toasts.show("No one to message with the current settings.", "failure"); return; }
                if (!(globalThis as unknown as { confirm(question: string): boolean; }).confirm(confirmationText(targets.length, message, delay, settings.store.allOpenDMs))) return;

                running = true;
                stopRequested = false;
                let sent = 0;
                let failed = 0;
                ctx.toasts.show(`Sending to ${targets.length} people...`, "info");
                try {
                    for (let index = 0; index < targets.length; index++) {
                        if (stopRequested || mine !== generation) break;
                        const userId = targets[index];
                        try {
                            let channelId = dms?.getDMFromUserId?.(userId);
                            if (!channelId) {
                                const opened = (await api.post({ url: "/users/@me/channels", body: { recipient_id: userId }, rejectWithError: true })).body;
                                const id = (opened as { id?: unknown; } | undefined)?.id;
                                channelId = typeof id === "string" ? id : undefined;
                            }
                            if (!channelId) { failed++; continue; }
                            await api.post({ url: `/channels/${channelId}/messages`, body: { content: message, tts: false, nonce: nonce() }, rejectWithError: true });
                            sent++;
                        } catch {
                            failed++;
                        }
                        if (index < targets.length - 1) await pause(delay);
                    }
                } finally {
                    running = false;
                }
                const stopped = stopRequested || mine !== generation;
                ctx.toasts.show(`${stopped ? "Stopped" : "Done"}: sent to ${sent}${failed > 0 ? `, ${failed} could not be reached` : ""}.`, failed > 0 || stopped ? "failure" : "success");
            }
        });

        ctx.commands.add({
            name: "massdm-stop",
            description: "Stop the mass message that is going out",
            execute() {
                if (!running) { ctx.toasts.show("Nothing is being sent.", "info"); return; }
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
