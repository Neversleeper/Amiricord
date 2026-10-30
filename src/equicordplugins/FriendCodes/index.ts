/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FriendCodes (author HypedDomi) as found in Equicord's copy of Vencord's plugins. The original puts the list inside the Add Friend page; the engine cannot add to that page, so it is a window opened by a command. Making and revoking codes use Discord's own functions, the same ones the page uses. Not tried in a real Discord, so whether those functions are found in this build is not known.

import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface FriendInvite { code: string; expires_at?: string; uses?: number; max_uses?: number; }

interface Actions {
    createFriendInvite(): Promise<FriendInvite>;
    getAllFriendInvites(): Promise<FriendInvite[]>;
    revokeFriendInvites(): Promise<unknown>;
}

/** The link that is shared for a code. */
export function inviteLink(code: string): string {
    return `https://discord.gg/${code}`;
}

/** A line about a code: when it ends and how often it was used. */
export function inviteSummary(invite: FriendInvite, now: number): string {
    const expires = invite.expires_at ? new Date(invite.expires_at).getTime() : NaN;
    const left = Number.isFinite(expires) ? (expires <= now ? "expired" : `expires ${new Date(expires).toLocaleString()}`) : "no end date";
    return `${left}, used ${invite.uses ?? 0}/${invite.max_uses ?? "?"}`;
}

const plugin: PluginCode = {
    start(ctx) {
        const actions = ctx.finders.byProps<Actions>("createFriendInvite", "getAllFriendInvites", "revokeFriendInvites");
        ctx.commands.add({
            name: "friendcodes",
            description: "Show, make and revoke your friend codes",
            async execute() {
                const found = actions.get();
                if (!found) { ctx.toasts.show("Discord's friend code functions were not found.", "failure"); return; }
                let invites: FriendInvite[] = [];
                try { invites = (await found.getAllFriendInvites()) ?? []; } catch (error) { ctx.reportError("FriendCodes", error); ctx.toasts.show("Could not read your friend codes.", "failure"); return; }
                openPanelWindow(ctx, "Friend codes", (kit, react) => {
                    const [list, setList] = react.useState(invites) as [FriendInvite[], (value: FriendInvite[]) => void];
                    return kit.panel(
                        kit.card([
                            kit.title(`Friend codes (${list.length})`),
                            kit.row(
                                kit.button("Make a friend code", () => { found.createFriendInvite().then(invite => { if (invite) setList([...list, invite]); }).catch(error => { ctx.reportError("FriendCodes", error); ctx.toasts.show("Could not make a friend code.", "failure"); }); }),
                                kit.button("Revoke all", () => { found.revokeFriendInvites().then(() => { setList([]); }).catch(error => { ctx.reportError("FriendCodes", error); ctx.toasts.show("Could not revoke the codes.", "failure"); }); }, { variant: "danger" })
                            )
                        ]),
                        kit.card(list.length === 0
                            ? [kit.note("You have no friend codes.")]
                            : list.map(invite => kit.item(invite.code, null, invite.code, inviteSummary(invite, Date.now()), [
                                kit.button("Copy link", () => { navigator.clipboard.writeText(inviteLink(invite.code)).then(() => ctx.toasts.show("Link copied.", "success"), () => ctx.toasts.show("Could not copy.", "failure")); })
                            ])))
                    );
                });
            }
        });
    }
};

export default plugin;
