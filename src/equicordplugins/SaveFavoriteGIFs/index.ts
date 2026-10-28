/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SaveFavoriteGIFs (author thororen) as found in TestCord's copy of Equicord's plugins. Tried in a real Discord (Stable): `/savegifs` opens the save dialog and reports the amount saved; the file contents were not checked.
// The command `/savegifs` writes the addresses of your favourite GIFs to a text file, one per line. Differences from the original:
//  - the command is added with Amiricord's own commands API (`ctx.commands`), and the favourites are read from Discord's settings store the way the GifTransfer plugin does;
//  - the file is saved through a download link (the original asked Discord's desktop app for a save dialog);
//  - the second command of the original, `/saveworkinggifs`, is NOT carried over: it asks every GIF's own server whether the GIF still works, which means contacting
//    any host on the internet, and Amiricord only lets the page reach hosts that a plugin declares in advance;
//  - the toolbox menu entry and its setting are not carried over (Amiricord has no toolbox);
//  - the short messages are Amiricord's own notification cards.

import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

interface ProtoStore { frecencyWithoutFetchingLatest?: { favoriteGifs?: { gifs?: Record<string, unknown>; }; }; }

const TITLE = "Save Favorite GIFs";
const DOWNLOAD_KEEP_MS = 10_000;

let store: { get(): ProtoStore | undefined; } | undefined;

/** The addresses of the favourite GIFs, or an empty list when Discord's store is not there or holds none. */
export function favouriteAddresses(proto: ProtoStore | undefined): string[] {
    const gifs = proto?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs;
    return gifs && typeof gifs === "object" ? Object.keys(gifs) : [];
}

/** The file name for a day, like `favorite-gifs-2026-10-28.txt`. */
export function fileNameFor(date: Date): string {
    return `favorite-gifs-${date.toISOString().split("T")[0]}.txt`;
}

function saveText(name: string, text: string) {
    const page = globalThis as unknown as { document: Document; setTimeout(run: () => void, ms: number): unknown; };
    const address = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = page.document.createElement("a");
    link.href = address;
    link.download = name;
    page.document.body.append(link);
    link.click();
    link.remove();
    page.setTimeout(() => { URL.revokeObjectURL(address); }, DOWNLOAD_KEEP_MS);
}

function saveAll(ctx: EnginePluginContext) {
    const addresses = favouriteAddresses(store?.get());
    if (addresses.length === 0) {
        ctx.notifications.show({ title: TITLE, body: "No favorite GIFs were found." });
        return;
    }
    const name = fileNameFor(new Date());
    try {
        saveText(name, addresses.join("\n"));
        ctx.notifications.show({ title: TITLE, body: `Saved ${addresses.length} GIFs as ${name}` });
    } catch (error) {
        ctx.reportError("SaveFavoriteGIFs", error);
        ctx.notifications.show({ title: TITLE, body: "Failed to save the GIFs" });
    }
}

const plugin: PluginCode = {
    start(ctx) {
        store = ctx.finders.byStore<ProtoStore>("UserSettingsProtoStore");
        const added = ctx.commands.add({
            name: "savegifs",
            description: "Save all favorite GIF urls to a text file",
            input: "builtin",
            execute: () => { saveAll(ctx); }
        });
        if (!added) throw new Error("the command /savegifs could not be added (the name is taken or the commands API refused it)");
    },

    stop() {
        store = undefined;
    }
};

export default plugin;
