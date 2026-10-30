/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifTransfer (by Neversleeper, who was called nnenaza) as found in TestCord (commit af92dba of its public repository).
// Export, import and verify the favourite GIFs of the account as a JSON file, and lift Discord's limit on how many favourites there can be. The favourites are
// Discord's own "frecency" user settings: they are read from its store and added through its own action (the same call its heart button makes), so the GIFs
// appear in Discord as any other favourite. The import file is read here and nothing is sent anywhere but to Discord's own settings.
// Differences, NOT verified against a real Discord: Discord's functions are found through the plugin's finders (the original used `@webpack/common`); the limit
// patch keeps whatever name Discord gave the value it measures (the original wrote the letter `t`); the setting "Lift the limit at runtime" is NOT carried over
// (it ran a new copy of Discord's code, `eval`, which Amiricord's rules do not allow: restart Discord after switching the plugin on); the toolbox menu and the
// about text are not carried over, the buttons in the GIF picker are the way in.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { type ButtonAction, type ButtonsPage, makeButtons } from "./buttons";
import { buildExport, type ExportFile, makeTransfer, type NewGif, type TransferDeps } from "./transfer";

export const settings = definePluginSettings({
    skipDuplicates: { type: "boolean", default: true, description: "Skip GIFs that are already in your favorites when importing" },
    delayBetweenImports: { type: "number", default: 800, min: 0, max: 60_000, integer: true, description: "Wait between each GIF when importing (ms). Prevents Discord rate-limits." },
    autoIncreaseDelay: { type: "boolean", default: true, description: "Automatically increase delay when hitting rate limits. Prevents 429 errors." },
    ensureCompleteImport: { type: "boolean", default: true, description: "Re-check favorites after importing and re-add any missing GIFs until fully imported." },
    maxRetryPasses: { type: "number", default: 3, min: 0, max: 20, integer: true, description: "How many extra passes to re-add missing GIFs when ensuring a complete import." },
    retryPassDelay: { type: "number", default: 2000, min: 0, max: 60_000, integer: true, description: "Wait between verification passes when ensuring a complete import (ms)." },
    settleWatch: { type: "boolean", default: true, description: "Keep watching favorites after importing and re-add any GIFs Discord removes." },
    settleWatchDuration: { type: "number", default: 15_000, min: 0, max: 120_000, integer: true, description: "How long to watch favorites for late removals after importing (ms)." }
});

type FavouriteMap = ReturnType<TransferDeps["current"]>;

interface FrecencyActions {
    updateAsync(name: string, update: (value: { gifs?: Record<string, unknown>; } | undefined) => void, delay: number): Promise<void>;
    loadIfNecessary?(): void;
}

interface UserSettingsCreators { FrecencyUserSettingsActionCreators?: FrecencyActions; }

/** Whether this is the "frecency" action set (the one that holds the favourite GIFs) and not another of Discord's settings. */
export function holdsFavourites(candidate: FrecencyActions | undefined): candidate is FrecencyActions {
    if (!candidate || typeof candidate.updateAsync !== "function") return false;
    try {
        return (candidate as { getCurrentValue?(): { favoriteGifs?: unknown; } | undefined; }).getCurrentValue?.()?.favoriteGifs !== undefined;
    } catch {
        return false;
    }
}

/**
 * Discord's own "add this GIF to my favourites" (read from Discord's code, 2026-10-28: the function in the module that also fetches the trending GIFs, which writes
 * `favoriteGifs` through its action set and puts the new GIF after the last one). It is found by two pieces of its text; the action set itself is not exported
 * by name, which is why the search by name could not find it.
 */
export type AddFavourite = (gif: { url: string; src: string; width: number; height: number; format: number; }) => void;
export const ADD_FAVOURITE_SNIPPETS = ["updateAsync(\"favoriteGifs\"", "order:"] as const;
/** Discord's own "take this GIF out of my favourites": the function that writes `favoriteGifs` and reports the event named GIF_UNFAVORITED. It gets the address. */
export type RemoveFavourite = (url: string) => void;
export const REMOVE_FAVOURITE_SNIPPETS = ["updateAsync(\"favoriteGifs\"", "GIF_UNFAVORITED"] as const;

const namesOf = (value: unknown) => (value && typeof value === "object" ? Object.keys(value).slice(0, 40) : typeof value);

interface ProtoStore { frecencyWithoutFetchingLatest?: { favoriteGifs?: { gifs?: FavouriteMap; }; }; }

/** How Discord's own "update a setting" wants to be told how often it is used; 3 is the value of its INFREQUENT_USER_ACTION. */
export const INFREQUENT_USER_ACTION = 3;
export const IDLE_START_MS = 500;
const DOWNLOAD_KEEP_MS = 10_000;

let running: { stop(): void; } | undefined;
/** Changes at every stop, so a start that was still waiting knows it must not go on. */
let generation = 0;

interface Page extends ButtonsPage {
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    confirm(message: string): boolean;
}

const pageOf = () => globalThis as unknown as Page;

/** Saves a text as a file through a download link. The address is released a little later. */
function saveText(name: string, text: string) {
    const page = pageOf();
    const address = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = page.document.createElement("a");
    link.href = address;
    link.download = name;
    page.document.body.append(link);
    link.click();
    link.remove();
    page.setTimeout(() => { URL.revokeObjectURL(address); }, DOWNLOAD_KEEP_MS);
}

/** Lets the person pick a .json file and gives its text. */
function pickText(onText: (text: string) => void) {
    const input = pageOf().document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = () => {
        const file = input.files?.[0];
        if (file) void file.text().then(onText);
    };
    input.click();
}

const plugin: PluginCode = {
    settings,
    patches: [
        {
            find: "toBinary(t).length>",
            replacements: [{ match: /\.toBinary\((\i)\)\.length>\d+/, replace: ".toBinary($1).length>Number.MAX_SAFE_INTEGER" }]
        }
    ],

    start(ctx: EnginePluginContext) {
        const mine = ++generation;
        const creators = ctx.finders.byProps<UserSettingsCreators>("FrecencyUserSettingsActionCreators");
        const store = ctx.finders.byStore<ProtoStore>("UserSettingsProtoStore");
        // Two ways to reach Discord's action set for the favourite GIFs: by its name inside the module that exports it, and by the three methods every action set has
        // (several settings share them, so the one that really holds `favoriteGifs` is the one taken).
        const generic = ctx.finders.byProps<FrecencyActions>("updateAsync", "getCurrentValue", "loadIfNecessary");
        const discordAdd = ctx.finders.byCode<AddFavourite>(...ADD_FAVOURITE_SNIPPETS);
        const discordRemove = ctx.finders.byCode<RemoveFavourite>(...REMOVE_FAVOURITE_SNIPPETS);
        const actions = () => {
            const named = creators.get()?.FrecencyUserSettingsActionCreators;
            if (named && typeof named.updateAsync === "function") return named;
            const byMethods = generic.get();
            return holdsFavourites(byMethods) ? byMethods : undefined;
        };
        /** What each way of looking found, by name only, for the console when nothing worked. Never values. */
        const diagnose = () => ({
            byName: namesOf(creators.get()),
            byNameFrecency: namesOf(creators.get()?.FrecencyUserSettingsActionCreators),
            byMethods: namesOf(generic.get()),
            byMethodsHoldsFavourites: holdsFavourites(generic.get()),
            discordAdd: typeof discordAdd.get(),
            discordRemove: typeof discordRemove.get(),
            store: namesOf(store.get()),
            storeFrecency: namesOf(store.get()?.frecencyWithoutFetchingLatest)
        });
        const current = (): FavouriteMap => store.get()?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {};

        let nextOrder: number | null = null;
        const deps: TransferDeps = {
            current,
            async add(gif: NewGif) {
                // The way Discord's own heart button does it, when its function is found.
                const add = discordAdd.get();
                if (typeof add === "function") {
                    add({ url: gif.url, src: gif.src, width: gif.width, height: gif.height, format: gif.format });
                    return;
                }
                const frecency = actions();
                if (!frecency) {
                    console.warn("[GifTransfer] What was found instead of Discord's favourite GIFs function:", diagnose());
                    throw new Error("Could not find Discord's internal GIF function. Try reloading Discord.");
                }
                const orders = Object.values(current()).map(entry => Number(entry?.order) || 0);
                const storeMax = orders.length > 0 ? Math.max(...orders) : 0;
                nextOrder = nextOrder === null ? storeMax + 1 : Math.max(nextOrder + 1, storeMax + 1);
                const order = nextOrder;
                await frecency.updateAsync("favoriteGifs", favourites => {
                    if (!favourites) return;
                    favourites.gifs ??= {};
                    if (favourites.gifs[gif.url]) return;
                    favourites.gifs[gif.url] = { src: gif.src, width: gif.width, height: gif.height, format: gif.format, order };
                }, INFREQUENT_USER_ACTION);
            },
            async remove(url: string) {
                const remove = discordRemove.get();
                if (typeof remove === "function") {
                    remove(url);
                    return;
                }
                const frecency = actions();
                if (!frecency) throw new Error("Could not find Discord's internal GIF function. Try reloading Discord.");
                await frecency.updateAsync("favoriteGifs", favourites => {
                    if (favourites?.gifs) delete favourites.gifs[url];
                }, INFREQUENT_USER_ACTION);
            },
            confirm: count => pageOf().confirm(`Delete ALL ${count} of your favorite GIFs? This cannot be undone. Press Cancel and use Export first if you want a copy.`),
            sleep: ms => new Promise(resolve => { pageOf().setTimeout(() => { resolve(); }, ms); }),
            now: () => Date.now(),
            toast: (message, kind) => { ctx.toasts.show(message, kind); },
            log: message => { console.info("[GifTransfer]", message); },
            warn: (message, detail) => { console.warn("[GifTransfer]", message, detail); },
            options: () => ({ ...settings.store })
        };
        const transfer = makeTransfer(deps);

        const run = (action: ButtonAction) => {
            if (action === "export") {
                const file: ExportFile | null = buildExport(current(), new Date().toISOString());
                if (!file) { ctx.toasts.show("No favorite GIFs found to export.", "failure"); return; }
                saveText(`gif-favorites-${Date.now()}.json`, JSON.stringify(file, null, 2));
                ctx.toasts.show(`Exported ${file.totalGifs} GIFs successfully!`, "success");
            } else if (action === "import") {
                pickText(text => { void transfer.importText(text).catch((error: unknown) => { ctx.reportError("GifTransfer import", error); }); });
            } else if (action === "verify") {
                pickText(text => { transfer.verifyText(text); });
            } else if (action === "clear") {
                void transfer.clearAll().catch((error: unknown) => { ctx.reportError("GifTransfer delete all", error); });
            }
        };

        const buttons = makeButtons(pageOf(), run);
        // After the first drawing, once Discord's code is there: ask Discord to load the settings if it has not, then show the buttons.
        const timer = pageOf().setTimeout(() => {
            if (mine !== generation) return;
            try { actions()?.loadIfNecessary?.(); } catch { /* the settings load by themselves */ }
            buttons.start();
        }, IDLE_START_MS);
        running = { stop() { pageOf().clearTimeout(timer); buttons.stop(); } };
    },

    stop() {
        generation++;
        running?.stop();
        running = undefined;
    }
};

export default plugin;
