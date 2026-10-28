/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CopyStatusUrls (authors sadan and x2b) as found in TestCord (commit af92dba of its public repository).
// The idea and the lookup of Discord's metadata function are the original's: the activity buttons of a status get a right-click that copies the link of the
// button. The patch's pattern is changed (see below) after reading Discord's build 652418. Differences, NOT verified against a real Discord: Discord's function is found through the plugin's own finder (the original used `findByCodeLazy`),
// the copy goes through `navigator.clipboard`, and the small message on the screen is the engine's own (`ctx.toasts`).

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface Activity { [key: string]: unknown; }

interface MenuProps {
    user: { id: string; };
    activity: Activity;
}

type MetadataOf = (activity: Activity, userId: string) => Promise<{ button_urls?: string[]; }>;

let context: EnginePluginContext | undefined;
let metadata: ReturnType<EnginePluginContext["finders"]["byCode"]> | undefined;

const plugin: PluginCode & { makeContextMenu(props: MenuProps, index: number): () => Promise<void>; } = {
    patches: [
        {
            find: "?\"PRESS_WATCH_ON_CRUNCHYROLL_BUTTON\"",
            // The original's `/(?=onClick)(?=.*index:(\i))/` took the FIRST `onClick` of the module, which in build 652418 is the "add to current games" button, not
            // the status buttons. This one starts from `.buttons.map((button, index) => <Button text=... onClick=...` (both layouts) and is the plugin's own.
            replacements: [{ match: /(\.buttons\.map\(\(\i,(\i)\)=>\(0,\i\.jsx\)\(\i\.\i,\{text:[^{}]*?),(onClick:)/g, replace: "$1,onContextMenu:$self.makeContextMenu(arguments[0],$2),$3" }]
        }
    ],

    start(ctx) {
        context = ctx;
        // Discord's function that gives the metadata of an activity; it asks Discord's servers when the answer is not already known.
        metadata = ctx.finders.byCode<MetadataOf>("null/undefined");
    },

    stop() {
        context = undefined;
        metadata = undefined;
    },

    /** Called by the patched Discord code: gives the right-click handler of the button number `index` of the status. */
    makeContextMenu(props, index) {
        return async () => {
            try {
                if (!metadata) throw new Error("Copy Status URLs is not running.");
                const lookup = await metadata.ready() as MetadataOf;
                const { button_urls: urls } = await lookup(props.activity, props.user.id);
                const url = urls?.[index];
                if (!url) throw new Error("button_urls does not contain index");
                await navigator.clipboard.writeText(url);
                context?.toasts.show("Copied URL", "success");
            } catch (error) {
                context?.reportError("CopyStatusUrls", error);
                context?.toasts.show("Error copying URL", "failure");
            }
        };
    }
};

export default plugin;
