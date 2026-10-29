/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FriendInvites (authors afn and Dziurwa) as found in TestCord's copy of Vencord's plugins.
// Three commands with the original's names: /create friend invite, /view friend invites, /revoke friend invites (the commands API accepts single spaces in a name). They use Discord's own friend invite functions, found by name
// (`createFriendInvite`); that was NOT checked on a live page. The answers are shown as short Amiricord messages at the bottom of the page (300 characters at most) instead of a bot message in the channel.

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface Invite { code: string; expires_at: string; max_uses: number; uses?: number; }
interface FriendInvites {
    createFriendInvite(): Promise<Invite>;
    getAllFriendInvites(): Promise<Invite[]>;
    revokeFriendInvites(): Promise<unknown>;
}

const TITLE = "Friend invites";
const expiry = (invite: Invite) => {
    const time = new Date(invite.expires_at).getTime();
    return Number.isFinite(time) ? new Date(time).toLocaleString() : "unknown";
};

async function run(ctx: EnginePluginContext, work: (api: FriendInvites) => Promise<string>): Promise<void> {
    try {
        const api = await ctx.finders.byProps<FriendInvites>("createFriendInvite").ready();
        ctx.toasts.show(`${TITLE}: ${await work(api)}`, "success");
    } catch (error) {
        ctx.toasts.show(`${TITLE}: that did not work. Discord refused or the function was not found.`, "failure");
        ctx.reportError("FriendInvites", error);
    }
}

const plugin: PluginCode = {
    start(ctx) {
        const commands: Array<[string, string, (api: FriendInvites) => Promise<string>]> = [
            ["create friend invite", "Generates a friend invite link.", async api => {
                const invite = await api.createFriendInvite();
                return `discord.gg/${invite.code} - expires ${expiry(invite)} - max uses ${invite.max_uses}`;
            }],
            ["view friend invites", "View a list of all generated friend invites.", async api => {
                const invites = await api.getAllFriendInvites();
                return invites.map(i => `discord.gg/${i.code} - expires ${expiry(i)} - used ${i.uses ?? 0}/${i.max_uses}`).join("\n") || "You have no active friend invites!";
            }],
            ["revoke friend invites", "Revokes all generated friend invites.", async api => {
                await api.revokeFriendInvites();
                return "All friend invites have been revoked.";
            }]
        ];
        for (const [name, description, work] of commands) {
            const added = ctx.commands.add({ name, description, input: "builtin", execute: () => { void run(ctx, work); } });
            if (!added) throw new Error(`the command /${name} could not be added (the name is taken or the commands API refused it)`);
        }
    }
};

export default plugin;
