/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin BiggerStreamPreview (author phil) as found in TestCord's copy of Vencord's plugins. Same behaviour: a right click on a person
// who is streaming, or on a stream tile, gets "View Stream Preview", which opens the preview picture in Discord's own picture viewer (found by its code, as the ViewIcons plugin
// does). Differences: the menu entry has no icon, and the preview is asked of Discord's stream preview store by name. NOT checked on a live page: the two store names, the
// menu names `user-context` and `stream-context`, and that the viewer accepts the preview address.

import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface Stream { guildId: string | null; channelId: string; ownerId: string; }
interface Streams { getAnyStreamForUser(userId: string): Stream | null | undefined; }
interface Previews { getPreviewURL(guildId: string | null, channelId: string, ownerId: string): Promise<string | null | undefined>; }

async function viewPreview(ctx: EnginePluginContext, stream: Stream): Promise<void> {
    try {
        const previews = await ctx.finders.byStore<Previews>("ApplicationStreamPreviewStore").ready();
        const url = await previews.getPreviewURL(stream.guildId, stream.channelId, stream.ownerId);
        const open = ctx.finders.byCode<(options: unknown) => void>("markSessionStarted", "numMediaItems").get();
        if (!url || typeof open !== "function") {
            ctx.toasts.show("There is no preview to show.", "failure");
            return;
        }
        open({ items: [{ type: "IMAGE", url, proxyUrl: url, original: url, width: 1280, height: 720, spoiler: false, srcIsAnimated: false }], startingIndex: 0, location: "BiggerStreamPreview" });
    } catch (error) {
        ctx.reportError("BiggerStreamPreview", error);
    }
}

const plugin: PluginCode = {
    start(ctx) {
        const streams = ctx.finders.byStore<Streams>("ApplicationStreamingStore");
        const add = (children: unknown[], ownerId: string | undefined) => {
            const stream = ownerId ? streams.get()?.getAnyStreamForUser(ownerId) : undefined;
            const parts = ctx.contextMenu.parts();
            if (!stream || !parts) return;
            const react = currentReact() as { createElement(...args: unknown[]): unknown; };
            children.push(react.createElement(parts.MenuItem as never, {
                id: "view-stream-preview",
                key: "view-stream-preview",
                label: "View Stream Preview",
                action: () => { void viewPreview(ctx, stream); }
            }));
        };
        ctx.contextMenu.addNative("user-context", (children, props) => add(children, (props as { user?: { id?: string; }; } | undefined)?.user?.id));
        ctx.contextMenu.addNative("stream-context", (children, props) => add(children, (props as { stream?: { ownerId?: string; }; } | undefined)?.stream?.ownerId));
    }
};

export default plugin;
