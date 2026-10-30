/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FollowMe (author Nightcord) as found in TestCord, kept as the original does it (the owners decided that, 2026-10-29: if
// people misuse it they will ask for it to be taken out). Right-click a person and press "Follow Me": whenever you change voice channel in a server, that person is moved to
// yours, and if they change channel on their own they are moved back to yours. It needs the Discord permission Move Members in the channel; without it nothing happens.
// Differences, NOT verified in a real Discord:
//  - the person is found from what was right-clicked (an element with the id, a list item id that ends in the id, or a picture from Discord's avatar address);
//    `/followme <id>` does the same without a right-click and `/followme-stop` stops it (the original had a button in the header bar);
//  - who is followed is kept in this plugin's storage and is picked up again at the next start, as in the original.

import type { PluginCode } from "../../renderer/engine";

const SNOWFLAKE = /^\d{15,25}$/;
const KEY = "target";
export const MOVE_MEMBERS = 1n << 24n;

export interface Place { channelId?: string | null; guildId?: string | null; }

/** The channel to move the followed person to: yours, when you are in voice in a server and they are not already there. Same server only. */
export function moveTarget(mine: Place | undefined, theirs: Place | undefined): string | undefined {
    if (!mine?.channelId || !mine.guildId) return undefined;
    if (theirs?.channelId === mine.channelId) return undefined;
    if (theirs?.guildId && theirs.guildId !== mine.guildId) return undefined;
    return mine.channelId;
}

export function userIdFromTarget(target: unknown): string | undefined {
    let element = target as { getAttribute?(name: string): string | null; parentElement?: unknown; src?: unknown; } | null | undefined;
    for (let level = 0; element && level < 8; level++) {
        for (const value of [element.getAttribute?.("data-user-id"), element.getAttribute?.("data-author-id")]) if (typeof value === "string" && SNOWFLAKE.test(value)) return value;
        const listId = element.getAttribute?.("data-list-item-id");
        const fromList = typeof listId === "string" ? /___(\d{15,25})$/.exec(listId)?.[1] : undefined;
        if (fromList) return fromList;
        const fromPicture = typeof element.src === "string" ? /\/(?:avatars|users)\/(\d{15,25})\//.exec(element.src)?.[1] : undefined;
        if (fromPicture) return fromPicture;
        element = element.parentElement as typeof element;
    }
    return undefined;
}

interface Rest { patch(request: { url: string; body: unknown; }): Promise<unknown>; }
interface VoiceStore { getVoiceStateForUser?(id: string): Place | undefined; }
interface Permissions { can?(permission: bigint, channel: unknown): boolean; }
interface VoiceEvent { voiceStates?: Array<{ userId?: string; channelId?: string | null; guildId?: string | null; }>; }

let handler: ((event: VoiceEvent) => void) | undefined;

const plugin: PluginCode = {
    flux: {
        VOICE_STATE_UPDATES: (event: unknown) => { handler?.(event as VoiceEvent); }
    },

    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const channels = ctx.common.ChannelStore;
        const voice = ctx.common.VoiceStateStore;
        const permissions = ctx.common.PermissionStore;
        const users = ctx.common.UserStore;
        let target: string | undefined;
        let loaded = false;

        const voiceOf = (id: string | undefined) => (id ? (voice.get() as unknown as VoiceStore | undefined)?.getVoiceStateForUser?.(id) : undefined);
        const nameOf = (id: string) => users.get()?.getUser(id)?.username ?? id;
        const me = () => users.get()?.getCurrentUser()?.id;

        const bring = async () => {
            if (!target) return;
            const mine = voiceOf(me());
            const channelId = moveTarget(mine, voiceOf(target));
            if (!channelId || !mine?.guildId) return;
            const channel = channels.get()?.getChannel(channelId);
            const can = (permissions.get() as unknown as Permissions | undefined)?.can?.(MOVE_MEMBERS, channel) === true;
            if (!channel || !can) return;
            try {
                await rest.get()?.patch({ url: `/guilds/${mine.guildId}/members/${target}`, body: { channel_id: channelId } });
            } catch {
                // Discord said no (the person is not in voice, a limit): the next voice change tries again.
            }
        };

        handler = event => {
            if (!loaded || !target) return;
            const myId = me();
            if ((event.voiceStates ?? []).some(state => state.userId === myId || state.userId === target)) void bring();
        };

        void ctx.storage.get(KEY).then(saved => {
            if (typeof saved === "string" && SNOWFLAKE.test(saved)) target = saved;
            loaded = true;
        }).catch(() => { loaded = true; });

        const follow = async (id: string) => {
            if (id === me()) { ctx.toasts.show("That is you.", "failure"); return; }
            target = id;
            loaded = true;
            await ctx.storage.set(KEY, id);
            ctx.toasts.show(`Following Me: ${nameOf(id)}`, "success");
            void bring();
        };
        const unfollow = async () => {
            if (!target) { ctx.toasts.show("Nobody is following you.", "info"); return; }
            const name = nameOf(target);
            target = undefined;
            await ctx.storage.set(KEY, null);
            ctx.toasts.show(`Stopped forcing ${name} to follow`, "info");
        };

        ctx.menuItems.add("follow-me", click => {
            const id = userIdFromTarget(click.target);
            if (!id) return null;
            return { label: id === target ? "Stop Follow Me" : "Follow Me", action: () => { void (id === target ? unfollow() : follow(id)); } };
        });

        ctx.commands.add({
            name: "followme",
            description: "Move a person to your voice channel whenever you or they change channel (give their user id)",
            options: [{ name: "user", description: "The person's user id", type: "string", required: true }],
            execute(args) {
                const id = String(args.find(argument => argument.name === "user")?.value ?? "").trim();
                if (!SNOWFLAKE.test(id)) { ctx.toasts.show("Give the person's user id (a number of 17 to 20 digits).", "failure"); return; }
                void follow(id);
            }
        });

        ctx.commands.add({
            name: "followme-stop",
            description: "Stop moving the person who follows you",
            execute() { void unfollow(); }
        });
    },

    stop() {
        handler = undefined;
    }
};

export default plugin;
