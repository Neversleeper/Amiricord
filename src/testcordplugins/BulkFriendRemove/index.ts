/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BulkFriendRemove (author Nightcord) as found in TestCord. Removes several friends at once. Removing a friend cannot be undone
// by this plugin (they would have to be asked again), so it never removes anybody without showing the names first.
// Differences, NOT verified in a real Discord:
//  - the original had a window with a search box and a list of check boxes; this one is two commands: `/friends-list` shows the names with their ids (a toast cannot hold
//    them all, so it shows how many and the first ones; the full list is in the console of the window) and `/friends-remove ids:<id, id, ...>` removes the ones you name,
//    after a question that lists the names (and says which ids are not your friends, which are skipped);
//  - the friends are removed with Discord's own request function (`DELETE /users/@me/relationships/<id>`), which adds the token by itself; the original could read the token
//    and call the address itself when Discord's function was missing, and that is gone;
//  - it waits 800 ms between friends like the original, and `/friends-remove-stop` stops a run.

import type { PluginCode } from "../../renderer/engine";

const SNOWFLAKE = /^\d{15,25}$/;
export const PAUSE_MS = 800;
export const MAX_SHOWN = 30;

/** The ids in a list written with commas, spaces or new lines; whatever is not an id is left out; each once. */
export function parseIds(text: string): string[] {
    return [...new Set(text.split(/[\s,;]+/).filter(part => SNOWFLAKE.test(part)))];
}

/** Of the ids asked for, the ones that are friends (in the order asked) and the ones that are not. */
export function split(asked: readonly string[], friendIds: readonly string[]): { friends: string[]; others: string[]; } {
    const have = new Set(friendIds);
    return { friends: asked.filter(id => have.has(id)), others: asked.filter(id => !have.has(id)) };
}

export function confirmationText(names: readonly string[], skipped: number): string {
    const shown = names.slice(0, MAX_SHOWN).join("\n");
    const more = names.length > MAX_SHOWN ? `\n...and ${names.length - MAX_SHOWN} more` : "";
    const tail = skipped > 0 ? `\n\n${skipped} of the ids you gave ${skipped === 1 ? "is" : "are"} not your friend and will be skipped.` : "";
    return `Remove ${names.length} ${names.length === 1 ? "friend" : "friends"}?\n\n${shown}${more}${tail}\n\nThis cannot be undone from here. You can stop it with /friends-remove-stop.`;
}

interface Rest { del(request: { url: string; rejectWithError?: boolean; }): Promise<unknown>; }
interface Relationships { getFriendIDs?(): string[]; }
interface Users { getUser?(id: string): { username?: string; globalName?: string | null; } | undefined; }

let running = false;
let stopRequested = false;
let generation = 0;

const plugin: PluginCode = {
    start(ctx) {
        const mine = ++generation;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const relationships = ctx.common.RelationshipStore;
        const users = ctx.common.UserStore;
        const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
        const friendIds = () => (relationships.get() as unknown as Relationships | undefined)?.getFriendIDs?.() ?? [];
        const nameOf = (id: string) => {
            const user = (users.get() as unknown as Users | undefined)?.getUser?.(id);
            const name = user?.globalName || user?.username;
            return name ? `${name} (${id})` : id;
        };

        ctx.commands.add({
            name: "friends-list",
            description: "Show how many friends you have and write their names and ids in the console",
            execute() {
                const ids = friendIds();
                if (ids.length === 0) { ctx.toasts.show("No friends found.", "info"); return; }
                console.info("[BulkFriendRemove] friends:\n" + ids.map(nameOf).join("\n"));
                ctx.toasts.show(`${ids.length} friends. The names and ids are in the console of this window.`, "info");
            }
        });

        ctx.commands.add({
            name: "friends-remove",
            description: "Remove several friends at once (give their user ids), asking first",
            options: [{ name: "ids", description: "User ids separated by commas or spaces", type: "string", required: true }],
            async execute(args) {
                if (running) { ctx.toasts.show("Friends are already being removed. Use /friends-remove-stop to stop.", "failure"); return; }
                const asked = parseIds(String(args.find(argument => argument.name === "ids")?.value ?? ""));
                if (asked.length === 0) { ctx.toasts.show("Give at least one user id.", "failure"); return; }
                const api = rest.get();
                if (!api) { ctx.toasts.show("Discord's request function was not found.", "failure"); return; }
                const { friends, others } = split(asked, friendIds());
                if (friends.length === 0) { ctx.toasts.show("None of those ids is one of your friends.", "failure"); return; }
                if (!(globalThis as unknown as { confirm(question: string): boolean; }).confirm(confirmationText(friends.map(nameOf), others.length))) return;

                running = true;
                stopRequested = false;
                let removed = 0;
                let failed = 0;
                try {
                    for (let index = 0; index < friends.length; index++) {
                        if (stopRequested || mine !== generation) break;
                        try {
                            await api.del({ url: `/users/@me/relationships/${friends[index]}`, rejectWithError: true });
                            removed++;
                        } catch {
                            failed++;
                        }
                        if (index < friends.length - 1) await pause(PAUSE_MS);
                    }
                } finally {
                    running = false;
                }
                const stopped = stopRequested || mine !== generation;
                ctx.toasts.show(`${stopped ? "Stopped" : "Done"}: removed ${removed}${failed > 0 ? `, ${failed} failed` : ""}.`, failed > 0 || stopped ? "failure" : "success");
            }
        });

        ctx.commands.add({
            name: "friends-remove-stop",
            description: "Stop removing friends",
            execute() {
                if (!running) { ctx.toasts.show("Nothing is being removed.", "info"); return; }
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
