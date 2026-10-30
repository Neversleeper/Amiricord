/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WhoReacted (authors Ven, Nuckyz) as found in TestCord's copy of Vencord's plugins. The original draws the faces of the people under each reaction in the message. Here the same lists come from a right-click window, read from Discord (the first 100 people of each reaction, one request per reaction, spaced out). Not tried in a real Discord.

import { messageFromTarget } from "../../api/clickTargets";
import { openPanelWindow } from "../../api/panelHost";
import type { PluginCode } from "../../renderer/engine";

export interface Reaction { emoji: { id?: string | null; name?: string | null; }; count?: number; }

/** What Discord's address for the people of a reaction wants after the message: the emoji as `name` or `name:id`. */
export function reactionKey(emoji: Reaction["emoji"]): string {
    return encodeURIComponent((emoji.name ?? "") + (emoji.id ? `:${emoji.id}` : ""));
}

export const GAP_MS = 250;

interface Person { id: string; username?: string; global_name?: string | null; }
interface Rest { get(request: { url: string; query?: Record<string, unknown>; oldFormErrors?: boolean; }): Promise<{ body: Person[]; }>; }

const plugin: PluginCode = {
    start(ctx) {
        const messages = ctx.common.MessageStore;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        ctx.menuItems.add("who-reacted", click => {
            const ref = messageFromTarget(click.target);
            if (!ref) return null;
            const message = (messages.get() as unknown as { getMessage(channel: string, id: string): { reactions?: Reaction[]; } | undefined; } | undefined)?.getMessage(ref.channelId, ref.messageId);
            const reactions = message?.reactions ?? [];
            if (reactions.length === 0) return null;
            return {
                label: "Who Reacted",
                action: () => {
                    openPanelWindow(ctx, "Who reacted", (kit, react) => {
                        const [lists, setLists] = react.useState({}) as [Record<string, Person[] | "error">, (value: Record<string, Person[] | "error">) => void];
                        react.useEffect(() => {
                            let alive = true;
                            (async () => {
                                let found: Record<string, Person[] | "error"> = {};
                                for (const reaction of reactions) {
                                    const key = reactionKey(reaction.emoji);
                                    try {
                                        const response = await rest.get()?.get({ url: `/channels/${ref.channelId}/messages/${ref.messageId}/reactions/${key}`, query: { limit: 100, type: 0 }, oldFormErrors: true });
                                        found = { ...found, [key]: response?.body ?? [] };
                                    } catch {
                                        found = { ...found, [key]: "error" };
                                    }
                                    if (!alive) return;
                                    setLists(found);
                                    await new Promise(resolve => setTimeout(resolve, GAP_MS));
                                }
                            })().catch(() => undefined);
                            return () => { alive = false; };
                        }, []);
                        return kit.panel(...reactions.map(reaction => {
                            const key = reactionKey(reaction.emoji);
                            const list = lists[key];
                            const label = `${reaction.emoji.name ?? "?"} (${reaction.count ?? "?"})`;
                            return kit.card([
                                kit.title(label),
                                list === undefined ? kit.note("Loading...") : list === "error" ? kit.note("Could not load this reaction.") : kit.note(list.map(person => person.global_name ?? person.username ?? person.id).join(", ") || "Nobody.")
                            ]);
                        }));
                    });
                }
            };
        });
    }
};

export default plugin;
