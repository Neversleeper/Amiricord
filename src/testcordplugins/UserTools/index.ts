/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UserTools (author x2b) as found in TestCord, kept as the original does it (the owners decided that, 2026-10-29: if people
// misuse it they will ask for it to be taken out). Right-click a person in a server and switch on "Disconnect", "Server Mute" or "Server Deafen": whenever that person is in
// a voice channel where you have the matching Discord permission (Move Members, Mute Members, Deafen Members), the action is applied again. Discord itself decides what is
// allowed: without the permission nothing happens. Differences, NOT verified in a real Discord:
//  - the person is found from what was right-clicked (an element with the id, a list item id that ends in the id, or a picture from Discord's avatar address); the original
//    got the user from Discord's own menu. `/usertools-add` (with the id) does the same without a right-click;
//  - the list of who is on lives in this plugin's storage (the original kept it in a setting); `/usertools-list` shows it and `/usertools-clear` switches everybody off,
//    undoing mute and deafen where it can; the icon in the header bar and its separate window are not carried over;
//  - the menu items are added at the end of Discord's menu, as lines that say on or off.

import type { PluginCode } from "../../renderer/engine";

const SNOWFLAKE = /^\d{15,25}$/;
const KEY = "actions";

export const MOVE_MEMBERS = 1n << 24n;
export const MUTE_MEMBERS = 1n << 22n;
export const DEAFEN_MEMBERS = 1n << 23n;

export interface UserActions { disconnect: boolean; mute: boolean; deafen: boolean; }
export type Actions = Record<string, UserActions>;
export interface VoiceFacts { channelId?: string | null; mute?: boolean; deaf?: boolean; }
export type Permission = "move" | "mute" | "deafen";
export type Change = { channel_id: null; } | { mute: true; } | { deaf: true; };

const off = (): UserActions => ({ disconnect: false, mute: false, deafen: false });
export const isActive = (actions: UserActions | undefined): boolean => actions !== undefined && (actions.disconnect || actions.mute || actions.deafen);

/** The saved list read back: only plain ids with at least one action on; anything else is left out. */
export function readActions(value: unknown): Actions {
    const result: Actions = {};
    if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
    for (const [id, raw] of Object.entries(value)) {
        if (!SNOWFLAKE.test(id) || typeof raw !== "object" || raw === null) continue;
        const entry = raw as Partial<UserActions>;
        const actions: UserActions = { disconnect: entry.disconnect === true, mute: entry.mute === true, deafen: entry.deafen === true };
        if (isActive(actions)) result[id] = actions;
    }
    return result;
}

/** The list with one action of one person switched; a person with nothing on is taken out. */
export function withAction(list: Actions, id: string, action: keyof UserActions, on: boolean): Actions {
    const next: Actions = { ...list };
    const actions = { ...(next[id] ?? off()), [action]: on };
    if (isActive(actions)) next[id] = actions; else delete next[id];
    return next;
}

/** What to ask Discord for, given what is on for a person, what they are doing in voice, and what the owner may do there. */
export function changesFor(actions: UserActions | undefined, voice: VoiceFacts | undefined, can: (permission: Permission) => boolean): Change[] {
    if (!actions || !voice?.channelId) return [];
    const changes: Change[] = [];
    if (actions.disconnect && can("move")) changes.push({ channel_id: null });
    if (actions.mute && voice.mute !== true && can("mute")) changes.push({ mute: true });
    if (actions.deafen && voice.deaf !== true && can("deafen")) changes.push({ deaf: true });
    return changes;
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
interface VoiceStore { getVoiceStateForUser?(id: string): VoiceFacts | undefined; }
interface Permissions { can?(permission: bigint, channel: unknown): boolean; }
interface VoiceEvent { voiceStates?: Array<{ userId?: string; channelId?: string | null; }>; }

let handler: ((event: VoiceEvent) => void) | undefined;

const plugin: PluginCode = {
    flux: {
        VOICE_STATE_UPDATES: (event: unknown) => { handler?.(event as VoiceEvent); }
    },

    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const channels = ctx.common.ChannelStore;
        const selectedGuild = ctx.common.SelectedGuildStore;
        const voice = ctx.common.VoiceStateStore;
        const permissions = ctx.common.PermissionStore;
        const users = ctx.common.UserStore;
        let list: Actions = {};
        let loaded = false;

        const load = async () => {
            list = readActions(await ctx.storage.get(KEY));
            loaded = true;
        };
        const save = async () => { await ctx.storage.set(KEY, list as never); };
        const voiceOf = (id: string) => (voice.get() as unknown as VoiceStore | undefined)?.getVoiceStateForUser?.(id);
        const nameOf = (id: string) => users.get()?.getUser(id)?.username ?? id;

        const apply = async (id: string, guildId: string, channel: unknown, state: VoiceFacts | undefined) => {
            const store = permissions.get() as unknown as Permissions | undefined;
            const can = (permission: Permission) => store?.can?.(permission === "move" ? MOVE_MEMBERS : permission === "mute" ? MUTE_MEMBERS : DEAFEN_MEMBERS, channel) === true;
            const api = rest.get();
            if (!api) return;
            for (const change of changesFor(list[id], state, can)) {
                try {
                    await api.patch({ url: `/guilds/${guildId}/members/${id}`, body: change });
                } catch {
                    // Discord said no (no permission, the person left, a limit): the next voice change tries again.
                }
            }
        };
        const check = (id: string) => {
            const state = voiceOf(id);
            const channel = state?.channelId ? channels.get()?.getChannel(state.channelId) : undefined;
            const guildId = channel?.guild_id;
            if (channel && guildId) void apply(id, guildId, channel, state);
        };

        handler = event => {
            if (!loaded) return;
            for (const { userId } of event.voiceStates ?? []) if (userId && isActive(list[userId])) check(userId);
        };

        const toggle = async (id: string, action: keyof UserActions, on: boolean) => {
            if (!loaded) await load();
            const me = users.get()?.getCurrentUser()?.id;
            if (id === me) { ctx.toasts.show("That is you.", "failure"); return; }
            list = withAction(list, id, action, on);
            await save();
            ctx.toasts.show(`${nameOf(id)}: ${action} ${on ? "on" : "off"}`, "success");
            if (on) check(id);
            else if (action !== "disconnect") {
                // Switching mute or deafen off puts the person back, as the original does.
                const state = voiceOf(id);
                const guildId = (state?.channelId ? channels.get()?.getChannel(state.channelId)?.guild_id : undefined) ?? selectedGuild.get()?.getGuildId();
                if (guildId) void rest.get()?.patch({ url: `/guilds/${guildId}/members/${id}`, body: action === "mute" ? { mute: false } : { deaf: false } }).catch(() => undefined);
            }
        };

        void load().catch(() => { ctx.toasts.show("UserTools could not read its saved list.", "failure"); });

        ctx.menuItems.add("user-tools", click => {
            const id = userIdFromTarget(click.target);
            if (!id) return null;
            const actions = list[id] ?? off();
            return [
                { label: `UserTools: Disconnect (${actions.disconnect ? "on" : "off"})`, action: () => { void toggle(id, "disconnect", !actions.disconnect); } },
                { label: `UserTools: Server Mute (${actions.mute ? "on" : "off"})`, action: () => { void toggle(id, "mute", !actions.mute); } },
                { label: `UserTools: Server Deafen (${actions.deafen ? "on" : "off"})`, action: () => { void toggle(id, "deafen", !actions.deafen); } }
            ];
        });

        ctx.commands.add({
            name: "usertools-add",
            description: "Switch an UserTools action on for a person (give their user id)",
            options: [
                { name: "user", description: "The person's user id", type: "string", required: true },
                { name: "action", description: "disconnect, mute or deafen", type: "string", required: true }
            ],
            execute(args) {
                const id = String(args.find(argument => argument.name === "user")?.value ?? "").trim();
                const action = String(args.find(argument => argument.name === "action")?.value ?? "").trim().toLowerCase();
                if (!SNOWFLAKE.test(id)) { ctx.toasts.show("Give the person's user id (a number of 17 to 20 digits).", "failure"); return; }
                if (action !== "disconnect" && action !== "mute" && action !== "deafen") { ctx.toasts.show("The action is disconnect, mute or deafen.", "failure"); return; }
                void toggle(id, action, true);
            }
        });

        ctx.commands.add({
            name: "usertools-list",
            description: "Show who has an UserTools action on",
            execute() {
                const lines = Object.entries(list).map(([id, actions]) => `${nameOf(id)}: ${(["disconnect", "mute", "deafen"] as const).filter(name => actions[name]).join(", ")}`);
                ctx.toasts.show(lines.length > 0 ? lines.join(" | ") : "Nobody has an action on.", "info");
            }
        });

        ctx.commands.add({
            name: "usertools-clear",
            description: "Switch every UserTools action off (mute and deafen are undone where possible)",
            async execute() {
                if (!loaded) await load();
                const api = rest.get();
                const guildId = selectedGuild.get()?.getGuildId();
                for (const [id, actions] of Object.entries(list)) {
                    const state = voiceOf(id);
                    const guild = (state?.channelId ? channels.get()?.getChannel(state.channelId)?.guild_id : undefined) ?? guildId;
                    if (!api || !guild) continue;
                    if (actions.mute) void api.patch({ url: `/guilds/${guild}/members/${id}`, body: { mute: false } }).catch(() => undefined);
                    if (actions.deafen) void api.patch({ url: `/guilds/${guild}/members/${id}`, body: { deaf: false } }).catch(() => undefined);
                }
                list = {};
                await save();
                ctx.toasts.show("Every UserTools action is off.", "success");
            }
        });
    },

    stop() {
        handler = undefined;
    }
};

export default plugin;
