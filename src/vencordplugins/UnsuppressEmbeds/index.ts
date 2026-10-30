/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin UnsuppressEmbeds (authors rad, HypedDomi) as found in TestCord's copy of Vencord's plugins. The original adds the item to Discord's own message menu with its icon; here it is added to Amiricord's right-click menu and the message is found from the clicked place (`src/api/clickTargets.ts`) and Discord's message store. The same request is made (a message's `flags` changed, bit 4 = embeds suppressed). Not checked live.

import { messageFromTarget } from "../../api/clickTargets";
import type { PluginCode } from "../../renderer/engine";

const EMBED_SUPPRESSED = 1 << 2;

interface Rest { patch(request: { url: string; body: unknown; }): Promise<unknown>; }
interface StoredMessage { flags?: number; embeds?: unknown[]; messageSnapshots?: Array<{ message?: { embeds?: unknown[]; }; }>; }
interface Messages { getMessage(channelId: string, messageId: string): StoredMessage | undefined; }

/** The `flags` to send to switch the previews of a message. */
export function flagsToggled(flags: number): number {
    return (flags & EMBED_SUPPRESSED) !== 0 ? flags & ~EMBED_SUPPRESSED : flags | EMBED_SUPPRESSED;
}

/** Whether a message has previews or has them hidden, so that the menu item is worth showing. */
export function hasEmbedState(message: StoredMessage): boolean {
    const suppressed = ((message.flags ?? 0) & EMBED_SUPPRESSED) !== 0;
    const inSnapshots = (message.messageSnapshots ?? []).some(snapshot => (snapshot.message?.embeds?.length ?? 0) > 0);
    return suppressed || (message.embeds?.length ?? 0) > 0 || inSnapshots;
}

const plugin: PluginCode = {
    start(ctx) {
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const messages = ctx.common.MessageStore;
        ctx.menuItems.add("toggle-embeds", click => {
            const ref = messageFromTarget(click.target);
            const message = ref ? (messages.get() as unknown as Messages | undefined)?.getMessage(ref.channelId, ref.messageId) : undefined;
            if (!ref || !message || !hasEmbedState(message)) return null;
            const suppressed = ((message.flags ?? 0) & EMBED_SUPPRESSED) !== 0;
            return {
                label: suppressed ? "Unsuppress Embeds" : "Suppress Embeds",
                action: async () => {
                    try {
                        await rest.get()?.patch({ url: `/channels/${ref.channelId}/messages/${ref.messageId}`, body: { flags: flagsToggled(message.flags ?? 0) } });
                    } catch (error) {
                        ctx.reportError("UnsuppressEmbeds", error);
                        ctx.toasts.show("Could not change the previews of that message", "failure");
                    }
                }
            };
        });
    }
};

export default plugin;
