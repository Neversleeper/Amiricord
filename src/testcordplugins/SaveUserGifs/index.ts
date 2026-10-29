/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SaveUserGifs (by Neversleeper, who posted it in TestCord as nnenaza; it is also in her own repository Mixi-Plugins)
// as found in TestCord. Right-click a person, press "Save GIFs from user", and the plugin looks through that person's messages in the channel you are in (or in
// the whole server) for GIFs, then saves them in a file, in your Discord favourites, or both. It uses Discord's own message search, which does not always give
// the same answer twice: run it again to pick up what it missed (what you already have is skipped).
// Differences, NOT verified in a real Discord:
//  - the original read your token and called Discord's search address itself; this one asks Discord's own request function, which adds the token by itself, so the
//    plugin never sees it (and needs no network permission);
//  - the person is found from what was right-clicked (the engine only tells the plugin which element was clicked): an element that carries the id (`data-user-id`,
//    `data-author-id`, or a list item id that ends in the id) or a picture from Discord's avatar address. That was NOT checked against Discord's pages, so
//    `/save-user-gifs` (with the person's id) does the same without a right-click and `/save-user-gifs-stop` stops a scan;
//  - the "save to HeartGifs" option is not carried over (that plugin is not in Amiricord); favourites are added with the same function GifTransfer uses;
//  - what the original printed in the console for every page is not printed.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";

export interface GifEntry { url: string; src: string; width: number; height: number; format: number; order: number; }
export interface Filter { type: "content" | "has"; value: string; }
export interface Page { messages: unknown[]; total: number; }

const SNOWFLAKE = /^\d{15,25}$/;
const PAGE_SIZE = 25;
const PAUSE_MS = 800;
const RATE_LIMIT_WAIT_MS = 5000;
const MAX_RATE_LIMIT_RETRIES = 5;

export const SEARCHES: readonly (Filter & { label: string; })[] = [
    { type: "content", value: "tenor.com", label: "tenor" },
    { type: "content", value: "giphy.com", label: "giphy" },
    { type: "content", value: "klipy.com", label: "klipy" },
    { type: "has", value: "file", label: "files" }
];

const asText = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? value as Record<string, unknown> : {});

/** Every GIF in one message of Discord's search answer: attachments, embeds and addresses written in the text. A GIF is listed once per message. */
export function extractGifs(message: unknown): GifEntry[] {
    const found = new Map<string, GifEntry>();
    const add = (entry: GifEntry) => { if (entry.url !== "" && !found.has(entry.url)) found.set(entry.url, entry); };
    const data = record(message);

    for (const raw of Array.isArray(data.attachments) ? data.attachments : []) {
        const attachment = record(raw);
        const url = asText(attachment.url);
        if (/\.gif/i.test(url) || asText(attachment.content_type).includes("gif")) {
            add({ url, src: asText(attachment.proxy_url) || url, width: asNumber(attachment.width, 498), height: asNumber(attachment.height, 280), format: 1, order: 0 });
        }
    }

    for (const raw of Array.isArray(data.embeds) ? data.embeds : []) {
        const embed = record(raw);
        const video = record(embed.video);
        const thumbnail = record(embed.thumbnail);
        const image = record(embed.image);
        const embedUrl = asText(embed.url);
        const videoUrl = asText(video.url);
        const thumbUrl = asText(thumbnail.url) || asText(image.url);
        if (embed.type === "gifv" || embedUrl.includes("tenor.com") || embedUrl.includes("giphy.com") || videoUrl.includes("tenor.com") || /\.gif/i.test(embedUrl)) {
            const url = embedUrl || videoUrl || thumbUrl;
            add({ url, src: videoUrl || thumbUrl || url, width: asNumber(video.width, asNumber(thumbnail.width, 498)), height: asNumber(video.height, asNumber(thumbnail.height, 280)), format: 2, order: 0 });
        }
    }

    for (const url of asText(data.content).match(/https?:\/\/[^\s<>"]+/g) ?? []) {
        if (/\.gif(\?|$)/i.test(url) || url.includes("tenor.com/view/") || url.includes("giphy.com/gifs/") || url.includes("giphy.com/media/") || url.includes("klipy.com/gifs/") || url.includes("klipy.com/g/") || url.includes("media.tenor.com")) {
            add({ url, src: url, width: 498, height: 280, format: url.endsWith(".gif") ? 1 : 2, order: 0 });
        }
    }
    return [...found.values()];
}

export interface ScanDeps {
    /** One page of Discord's message search for this filter, or null when Discord gave nothing usable. Rejects with `{ status: 429 }` when it is being rate limited. */
    fetchPage(filter: Filter, offset: number): Promise<Page | null>;
    sleep(ms: number): Promise<void>;
    stopped(): boolean;
    /** Called for each new GIF the moment it is found. */
    onGif?(gif: GifEntry): void;
}

/** Looks through the pages of each search and gives every GIF once (a GIF already in `seen` is skipped). Stops when asked, at `maxMessages` per search, or when a search ends. */
export async function collectGifs(deps: ScanDeps, searches: readonly Filter[], maxMessages: number, seen: Set<string> = new Set()): Promise<GifEntry[]> {
    const all: GifEntry[] = [];
    for (const filter of searches) {
        if (deps.stopped()) break;
        let offset = 0;
        let retries = 0;
        while (!deps.stopped()) {
            let page: Page | null;
            try {
                page = await deps.fetchPage(filter, offset);
            } catch (error) {
                // A rate limit is waited out and the same page is asked for again; anything else (or too many limits in a row) ends this search.
                if ((error as { status?: unknown; } | null)?.status === 429 && retries < MAX_RATE_LIMIT_RETRIES) {
                    retries++;
                    await deps.sleep(RATE_LIMIT_WAIT_MS);
                    continue;
                }
                break;
            }
            retries = 0;
            if (!page || page.messages.length === 0) break;
            for (const message of page.messages) {
                for (const gif of extractGifs(message)) {
                    if (seen.has(gif.url)) continue;
                    seen.add(gif.url);
                    all.push(gif);
                    deps.onGif?.(gif);
                }
            }
            offset += PAGE_SIZE;
            if (page.messages.length < PAGE_SIZE || offset >= page.total || offset >= maxMessages || deps.stopped()) break;
            await deps.sleep(PAUSE_MS);
        }
    }
    return all;
}

/** The id of the person whose name, picture or list entry was clicked, or undefined. Looks at the clicked element and the ones around it. */
export function userIdFromTarget(target: unknown): string | undefined {
    let element = target as { getAttribute?(name: string): string | null; parentElement?: unknown; src?: unknown; } | null | undefined;
    for (let level = 0; element && level < 8; level++) {
        const attributes = [element.getAttribute?.("data-user-id"), element.getAttribute?.("data-author-id")];
        for (const value of attributes) if (typeof value === "string" && SNOWFLAKE.test(value)) return value;
        const listId = element.getAttribute?.("data-list-item-id");
        const fromList = typeof listId === "string" ? /___(\d{15,25})$/.exec(listId)?.[1] : undefined;
        if (fromList) return fromList;
        const fromPicture = typeof element.src === "string" ? /\/(?:avatars|users)\/(\d{15,25})\//.exec(element.src)?.[1] : undefined;
        if (fromPicture) return fromPicture;
        element = element.parentElement as typeof element;
    }
    return undefined;
}

export const SETTINGS_DEFAULT = { scanMode: "channel", saveMode: "export", maxMessages: 99999 } as const;

const settings = definePluginSettings({
    scanMode: { type: "select", default: "channel", description: "Where to scan for GIFs", options: [{ label: "Current channel only", value: "channel" }, { label: "Entire server", value: "server" }] },
    saveMode: { type: "select", default: "export", description: "What to do with found GIFs", options: [{ label: "Export to JSON file", value: "export" }, { label: "Add to favorites", value: "favorites" }, { label: "Both (export + add to favorites)", value: "both" }] },
    maxMessages: { type: "number", default: 99999, min: 1, max: 99999, integer: true, description: "Most messages to scan per search (99999 = all)" }
});

interface Rest { get(request: { url: string; query?: Record<string, unknown>; rejectWithError?: boolean; }): Promise<unknown>; }
interface ProtoStore { frecencyWithoutFetchingLatest?: { favoriteGifs?: { gifs?: Record<string, unknown>; }; }; }
type AddFavourite = (gif: { url: string; src: string; width: number; height: number; format: number; }) => void;
const ADD_FAVOURITE_SNIPPETS = ["updateAsync(\"favoriteGifs\"", "order:"] as const;

let scanning = false;
let stopRequested = false;
let found = 0;
let generation = 0;

const bodyOf = (answer: unknown): Record<string, unknown> => record(record(answer).body ?? answer);

function saveFile(name: string, text: string): void {
    const page = globalThis as unknown as { document: Document; setTimeout(run: () => void, ms: number): unknown; };
    const address = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = page.document.createElement("a");
    link.href = address;
    link.download = name;
    page.document.body.append(link);
    link.click();
    link.remove();
    page.setTimeout(() => { URL.revokeObjectURL(address); }, 10_000);
}

const plugin: PluginCode = {
    settings,

    start(ctx: EnginePluginContext) {
        const mine = ++generation;
        const rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        const add = ctx.finders.byCode<AddFavourite>(...ADD_FAVOURITE_SNIPPETS);
        const protoStore = ctx.finders.byStore<ProtoStore>("UserSettingsProtoStore");
        const favouriteUrls = () => new Set(Object.keys(protoStore.get()?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? {}));
        const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

        async function scan(userId: string): Promise<void> {
            if (scanning) { ctx.toasts.show("Already scanning! Use /save-user-gifs-stop to stop it.", "failure"); return; }
            const guildId = ctx.common.SelectedGuildStore.get()?.getGuildId();
            const api = rest.get();
            if (!guildId) { ctx.toasts.show("This plugin only works in servers, not in DMs.", "failure"); return; }
            if (!api) { ctx.toasts.show("Discord's request function was not found.", "failure"); return; }
            const username = ctx.common.UserStore.get()?.getUser(userId)?.username ?? userId;
            const mode = settings.store.scanMode;
            const saveMode = settings.store.saveMode;
            const channelId = mode === "channel" ? ctx.common.SelectedChannelStore.get()?.getChannelId() : undefined;
            const addGif = saveMode === "favorites" || saveMode === "both" ? add.get() : undefined;
            if ((saveMode === "favorites" || saveMode === "both") && typeof addGif !== "function") { ctx.toasts.show("Discord's favourite GIFs function was not found: use Export instead.", "failure"); return; }

            scanning = true;
            stopRequested = false;
            found = 0;
            const before = favouriteUrls();
            const requested = new Set<string>();
            ctx.toasts.show(`Scanning GIFs from ${username}...`, "info");
            let gifs: GifEntry[] = [];
            try {
                gifs = await collectGifs({
                    fetchPage: async (filter, offset) => {
                        const query: Record<string, unknown> = { author_id: userId, offset, limit: PAGE_SIZE };
                        if (filter.type === "content") query.content = filter.value; else query.has = filter.value;
                        if (channelId) query.channel_id = channelId;
                        const body = bodyOf(await api.get({ url: `/guilds/${guildId}/messages/search`, query, rejectWithError: true }));
                        const groups = Array.isArray(body.messages) ? body.messages : [];
                        return { messages: groups.flat(), total: typeof body.total_results === "number" ? body.total_results : 0 };
                    },
                    sleep: wait,
                    stopped: () => stopRequested || mine !== generation,
                    onGif: gif => {
                        found++;
                        if (typeof addGif === "function" && !before.has(gif.url) && !requested.has(gif.url)) {
                            requested.add(gif.url);
                            try { addGif({ url: gif.url, src: gif.src, width: gif.width, height: gif.height, format: gif.format }); } catch { requested.delete(gif.url); }
                        }
                    }
                }, SEARCHES, settings.store.maxMessages);
            } finally {
                scanning = false;
            }

            if (gifs.length === 0) { ctx.toasts.show(`No GIFs found from ${username}.`, "failure"); return; }
            if (saveMode === "export" || saveMode === "both") {
                saveFile(`gifs-from-${username.replace(/[^\w.-]/g, "_")}-${Date.now()}.json`, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), collectedFrom: { userId, username }, totalGifs: gifs.length, gifs }, null, 2));
            }
            if (addGif) {
                await wait(1000);
                const after = favouriteUrls();
                const saved = gifs.filter(gif => !before.has(gif.url) && after.has(gif.url)).length;
                const already = gifs.filter(gif => before.has(gif.url)).length;
                const failed = gifs.filter(gif => !before.has(gif.url) && !after.has(gif.url) && requested.has(gif.url)).length;
                ctx.toasts.show(`Found ${gifs.length}. Saved: ${saved}. Already had: ${already}.${failed > 0 ? ` Failed: ${failed}.` : ""}`, failed > 0 ? "failure" : "success");
            } else {
                ctx.toasts.show(`Found ${gifs.length} GIFs from ${username}.`, "success");
            }
        }

        ctx.menuItems.add("save-user-gifs", click => {
            const items: Array<{ label: string; action(): void; }> = [];
            const userId = userIdFromTarget(click.target);
            if (userId && !scanning) items.push({ label: "Save GIFs from user", action: () => { void scan(userId); } });
            if (scanning) {
                items.push({ label: "Stop saving GIFs", action: () => { stopRequested = true; ctx.toasts.show("Stopping...", "info"); } });
                items.push({ label: `${found} GIFs found so far`, action: () => { ctx.toasts.show(`${found} GIFs found so far`, "info"); } });
            }
            return items.length > 0 ? items : null;
        });

        ctx.commands.add({
            name: "save-user-gifs",
            description: "Save the GIFs a person sent in this channel or server (give their user id)",
            options: [{ name: "user", description: "The person's user id", type: "string", required: true }],
            execute(args) {
                const userId = String(args.find(argument => argument.name === "user")?.value ?? "").trim();
                if (!SNOWFLAKE.test(userId)) { ctx.toasts.show("Give the person's user id (a number of 17 to 20 digits).", "failure"); return; }
                void scan(userId);
            }
        });
        ctx.commands.add({
            name: "save-user-gifs-stop",
            description: "Stop saving GIFs",
            execute() {
                if (!scanning) { ctx.toasts.show("Nothing is being scanned.", "info"); return; }
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
