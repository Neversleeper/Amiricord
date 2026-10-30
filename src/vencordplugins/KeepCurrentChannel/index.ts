/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin KeepCurrentChannel (author Nuckyz) as found in TestCord's copy of Vencord's plugins. A smaller version of the original (which also handles switching accounts): the last channel you opened is kept in this plugin's storage, and when Discord starts you are taken there using the page history. If the channel does not exist any more Discord just shows its own page.

import type { PluginCode } from "../../renderer/engine";

const KEY = "last-channel";

/** The address of the channel, or nothing when there is none to go to. */
export function restorePath(saved: unknown): string | undefined {
    if (typeof saved !== "object" || saved === null) return undefined;
    const { channelId, guildId } = saved as { channelId?: unknown; guildId?: unknown; };
    if (typeof channelId !== "string" || !/^\d+$/.test(channelId)) return undefined;
    if (guildId !== null && guildId !== undefined && (typeof guildId !== "string" || !/^\d+$/.test(guildId))) return undefined;
    return `/channels/${guildId ?? "@me"}/${channelId}`;
}

const plugin: PluginCode & { onSelect?: (event: { channelId?: string | null; guildId?: string | null; }) => void; } = {
    async start(ctx) {
        const saved = await ctx.storage.get(KEY);
        const path = restorePath(saved);
        const selected = ctx.common.SelectedChannelStore;
        const now = selected.get()?.getChannelId();
        if (path && !now) ctx.navigate(path);
        plugin.onSelect = ({ channelId, guildId }) => {
            if (channelId) ctx.storage.set(KEY, { channelId, guildId: guildId ?? null } as never).catch(() => undefined);
        };
    },
    flux: {
        CHANNEL_SELECT(event: { channelId?: string | null; guildId?: string | null; }) { plugin.onSelect?.(event); }
    },
    stop() { plugin.onSelect = undefined; }
};

export default plugin;
