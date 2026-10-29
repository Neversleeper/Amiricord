/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin GifCollections (author creations) as found in Equicord. Your own collections of GIFs: they show in Discord's GIF picker
// as categories, and a GIF in a message or in the picker can be added to one from the right-click menu.
// What was checked against the real code of Discord (build 653945, in a running Discord): the picker's component (found by `renderCategoryExtras`; it has the `render(){...getItemGrid`
// start, the category name `"span",{className:X.Y,children:Z` and `renderContent(){...resultItems`) and the search action (found by `type:"GIF_PICKER_QUERY"`; its function
// starts `function C(e,t,r){...GIFS_SEARCH,query:`). Each regular expression matched the real module of that build.
// Differences from the original, NOT seen working in a real Discord with a click yet:
//  - the collections are kept in the plugin's own storage (one value, at most 1500 GIFs in all) and managed in the plugin's settings window (rename, delete, remove a GIF,
//    move it, export and import), not from right-clicking a category (Discord's category tile is not known to pass a right-click on);
//  - "Add to collection" is one item per collection in the right-click menu (the first 12), plus "Add to a new collection" (named "New collection N"; rename it in the settings);
//  - an empty collection shows a transparent picture of ours, not a GIF fetched from tenor.com; nothing here contacts any site except Discord's own address that renews pictures;
//  - the prefix texts and the "skip confirmation" and "copy image link" options of the original are not carried (the prefixes are fixed, the settings window asks before deleting).

import { currentReact } from "../../api/jsxRuntime";
import { PANEL_CSS, panelKit } from "../../api/panelKit";
import { definePluginSettings } from "../../api/pluginSettings";
import type { StyleHandle } from "../../api/styles";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { JsonValue } from "../../shared/settings";
import { addGif, type Change, type Collection, COLLECTION_PREFIX, createCollection, deleteCollection, displayName, exportText, formatOf, type Gif, gifAddress, isCdnUrlExpired, ITEM_PREFIX, MAX_GIFS_TOTAL, moveGif, readCollections, readExport, removeGif, renameCollection, sortCollections, type SortOrder, type SortType, totalGifs, withRefreshed } from "./model";

/* eslint-disable @typescript-eslint/no-explicit-any -- the settings window is built with React's createElement, which has no types here (as in TokenLogin) */

const KEY = "collections";
const MENU_ITEMS = 12;

const settings = definePluginSettings({
    onlyShowCollections: { type: "boolean", default: false, description: "Only show your collections in the GIF picker (not Discord's trending categories)." },
    preventDuplicates: { type: "boolean", default: false, description: "Do not add the same GIF to a collection twice." },
    sortType: { type: "select", default: "name", description: "How to sort the collections in the picker.", options: [{ label: "Name", value: "name" }, { label: "Date created", value: "created" }, { label: "Date modified", value: "modified" }] },
    sortOrder: { type: "select", default: "asc", description: "The order of that sorting.", options: [{ label: "Ascending", value: "asc" }, { label: "Descending", value: "desc" }] }
});

interface PickerInstance {
    props: {
        query: string;
        resultItems: Array<{ id: string; format: number; src: string; url: string; width: number; height: number; }>;
        trendingCategories: Array<{ type?: string; }>;
    };
}
interface Dispatcher { dispatch(event: { type: string; query: string; }): void; }
interface Rest { post(request: { url: string; body: unknown; }): Promise<{ ok?: boolean; body?: any; }>; }

let context: EnginePluginContext | undefined;
let panelStyle: StyleHandle | undefined;
let rest: { get(): Rest | undefined; } | undefined;
let dispatcher: { get(): Dispatcher | undefined; } | undefined;
let collections: Collection[] = [];
let oldTrending: Array<{ type?: string; }> | null = null;
let refreshing = false;
const listeners = new Set<() => void>();
const changed = () => { for (const listener of [...listeners]) listener(); };
const toast = (text: string, kind: "info" | "success" | "failure" = "info") => { context?.toasts.show(text, kind); };

async function save(list: Collection[]) {
    collections = list;
    await context?.storage.set(KEY, list as unknown as JsonValue);
    changed();
}

/** Applies a change to the list and saves it; a refusal is said in a short message. */
async function apply(change: Change, done?: string): Promise<boolean> {
    if (!change.ok) { toast(change.error, "failure"); return false; }
    await save(change.list);
    if (done) toast(done, "success");
    return true;
}

/** The GIF under a right-click: the picture or video that was clicked, its page when it is a GIF site's, and its size as drawn. */
function gifFromClick(click: { target: Element; src: string | undefined; href: string | undefined; }): Gif | undefined {
    const src = click.src;
    if (src === undefined || !/^https:\/\//i.test(src)) return undefined;
    const media = click.target.closest("img, video") as (HTMLImageElement & HTMLVideoElement) | null;
    const width = media?.naturalWidth || media?.videoWidth || media?.clientWidth || 200;
    const height = media?.naturalHeight || media?.videoHeight || media?.clientHeight || 200;
    return { id: `${ITEM_PREFIX}${crypto.randomUUID()}`, src, url: gifAddress(src, click.href), width, height };
}

function menuItemsFor(gif: Gif) {
    const items = collections.slice(0, MENU_ITEMS).map(collection => ({
        label: `Add to collection: ${displayName(collection.name)}`,
        action: async () => { await apply(addGif(collections, collection.name, gif, Date.now(), settings.store.preventDuplicates), `Added to "${displayName(collection.name)}".`); }
    }));
    items.push({
        label: "Add to a new collection",
        action: async () => {
            let n = collections.length + 1;
            while (collections.some(collection => collection.name === `${COLLECTION_PREFIX}New collection ${n}`)) n++;
            await apply(createCollection(collections, `New collection ${n}`, [gif], Date.now()), `Added to "New collection ${n}". Rename it in the plugin's settings.`);
        }
    });
    return items;
}

/** The picker shows the query again, so a changed collection is drawn again. */
function redraw(query: string) {
    dispatcher?.get()?.dispatch({ type: "GIF_PICKER_QUERY", query: "" });
    dispatcher?.get()?.dispatch({ type: "GIF_PICKER_QUERY", query });
}

async function refreshExpired(addresses: string[], expired: Gif[], query: string) {
    refreshing = true;
    try {
        const map: Record<string, string> = {};
        for (let at = 0; at < addresses.length; at += 50) {
            try {
                const answer = await rest?.get()?.post({ url: "/attachments/refresh-urls", body: { attachment_urls: addresses.slice(at, at + 50) } });
                for (const entry of Array.isArray(answer?.body?.refreshed_urls) ? answer.body.refreshed_urls : []) {
                    if (typeof entry?.original === "string" && typeof entry?.refreshed === "string" && /^https:\/\//i.test(entry.refreshed)) map[entry.original] = entry.refreshed;
                }
            } catch {
                // the pictures stay as they are; the next time the collection is opened it is tried again
            }
        }
        let list = collections;
        let any = false;
        for (const gif of expired) {
            const src = map[gif.src] ?? gif.src;
            const url = map[gif.url] ?? gif.url;
            if (src !== gif.src || url !== gif.url) { list = withRefreshed(list, gif.id, src, url); any = true; }
        }
        if (any) { await save(list); redraw(query); }
    } finally {
        refreshing = false;
    }
}

const plugin: PluginCode & {
    insertCollections(instance: PickerInstance): void;
    hidePrefix(name: unknown): unknown;
    renderContent(instance: PickerInstance): void;
    shouldStopFetch(query: unknown): boolean;
} = {
    settings,
    settingsComponent: (() => (currentReact() as any).createElement(CollectionsPanel)) as never,

    patches: [
        {
            // The picker: before it draws, the collections go in with the categories; the name of a category shows without the prefix.
            find: "renderCategoryExtras",
            required: false,
            replacements: [
                { match: /(render\(\)\{)(.{1,50}getItemGrid)/, replace: "$1;$self.insertCollections(this);$2" },
                { match: /("span",\{className:\i\.\i,children:)(\i)/, replace: "$1$self.hidePrefix($2)" }
            ]
        },
        {
            // What the picker shows when a collection is opened: its GIFs.
            find: "renderHeaderContent()",
            required: false,
            replacements: [{ match: /(renderContent\(\)\{)(.{1,50}resultItems)/, replace: "$1$self.renderContent(this);$2" }]
        },
        {
            // Opening a collection does not search Discord's GIFs for its name.
            find: "type:\"GIF_PICKER_QUERY\"",
            required: false,
            replacements: [{ match: /(function \i\(.{1,10}\)\{)(.{1,200}.GIFS_SEARCH,query:)/, replace: "$1if($self.shouldStopFetch(arguments[0]))return;$2" }]
        }
    ],

    insertCollections(instance) {
        try {
            const categories = instance.props.trendingCategories;
            if (categories.length > 0 && categories[0]!.type === "Trending") oldTrending = categories;
            const mine = sortCollections(collections, settings.store.sortType as SortType, settings.store.sortOrder as SortOrder);
            if (settings.store.onlyShowCollections) instance.props.trendingCategories = mine;
            else if (oldTrending !== null) instance.props.trendingCategories = [...mine, ...oldTrending];
        } catch (error) {
            context?.reportError("GifCollections", error);
        }
    },

    hidePrefix(name) {
        return typeof name === "string" && name.startsWith(COLLECTION_PREFIX) ? displayName(name) : name;
    },

    renderContent(instance) {
        if (!instance.props.query.startsWith(COLLECTION_PREFIX)) return;
        const collection = collections.find(candidate => candidate.name === instance.props.query);
        if (!collection) return;
        instance.props.resultItems = collection.gifs.map(gif => ({ id: gif.id, format: formatOf(gif.src), src: gif.src, url: gif.url, width: gif.width, height: gif.height })).reverse();
        const expired = collection.gifs.filter(gif => isCdnUrlExpired(gif.src, Date.now()) || isCdnUrlExpired(gif.url, Date.now()));
        if (expired.length === 0 || refreshing) return;
        const addresses = [...new Set(expired.flatMap(gif => [gif.src, gif.url].filter(address => isCdnUrlExpired(address, Date.now()))))];
        void refreshExpired(addresses, expired, instance.props.query);
    },

    shouldStopFetch(query) {
        return typeof query === "string" && query.startsWith(COLLECTION_PREFIX) && collections.some(collection => collection.name === query);
    },

    async start(ctx) {
        context = ctx;
        panelStyle = ctx.addStyle(PANEL_CSS, "panel");
        rest = ctx.finders.byProps<Rest>("get", "post", "put", "patch", "del", "!Request", "!getXHR");
        dispatcher = ctx.common.FluxDispatcher as never;
        collections = readCollections(await ctx.storage.get(KEY));
        ctx.menuItems.add("gif-collections", click => {
            const gif = gifFromClick(click);
            return gif ? menuItemsFor(gif) : null;
        });
    },

    stop() {
        panelStyle?.remove();
        panelStyle = undefined;
        listeners.clear();
        collections = [];
        oldTrending = null;
        context = rest = dispatcher = undefined;
    }
};

// ---------------------------------------------------------------------------------------------------------------------
// The settings window: the collections, their GIFs, and the file that carries them

function saveFile(name: string, text: string) {
    const page = globalThis as unknown as { document: Document; URL: typeof URL; setTimeout: typeof setTimeout; };
    const address = page.URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = page.document.createElement("a");
    link.href = address;
    link.download = name;
    link.click();
    page.setTimeout(() => { page.URL.revokeObjectURL(address); }, 10_000);
}

function pickFile(): Promise<string | undefined> {
    const page = globalThis as unknown as { document: Document; };
    return new Promise(resolve => {
        const input = page.document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) { resolve(undefined); return; }
            file.text().then(resolve, () => { resolve(undefined); });
        };
        input.click();
    });
}

function CollectionsPanel() {
    const react = currentReact() as any;
    const [, tick] = react.useState(0) as [number, (value: number) => void];
    const [open, setOpen] = react.useState(null) as [string | null, (value: string | null) => void];
    const [names, setNames] = react.useState({}) as [Record<string, string>, (value: Record<string, string>) => void];
    const [fresh, setFresh] = react.useState("") as [string, (value: string) => void];
    react.useEffect(() => {
        const listener = () => { tick(Date.now()); };
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const kit = panelKit({ react, Button: context?.components.Button.get() });
    const confirm = (question: string) => (globalThis as unknown as { confirm(text: string): boolean; }).confirm(question);
    const run = (work: () => Promise<unknown>) => () => { work().catch(error => { context?.reportError("GifCollections", error); toast("Something went wrong in GifCollections.", "failure"); }); };
    const sorted = sortCollections(collections, settings.store.sortType as SortType, settings.store.sortOrder as SortOrder);

    return kit.panel(
        kit.card([
            kit.title(`Your collections (${collections.length}, ${totalGifs(collections)}/${MAX_GIFS_TOTAL} GIFs)`),
            kit.note("They show in Discord's GIF picker. Add a GIF by right-clicking it in a message or in the picker."),
            kit.row(
                kit.input({ value: fresh, placeholder: "Name of a new collection", maxLength: 40, onChange: setFresh }),
                kit.button("Create", run(async () => { if (await apply(createCollection(collections, fresh, [], Date.now()))) setFresh(""); }), { variant: "primary" })),
            sorted.length === 0 ? kit.note("No collections yet.") : sorted.map(collection => react.createElement("div", { key: collection.name },
                kit.item(collection.name, kit.avatar(collection.format === 1 ? collection.src : undefined), displayName(collection.name), `${collection.gifs.length} GIFs`, [
                    kit.input({ value: names[collection.name] ?? displayName(collection.name), maxLength: 40, onChange: value => { setNames({ ...names, [collection.name]: value }); } }),
                    kit.button("Rename", run(async () => { await apply(renameCollection(collections, collection.name, names[collection.name] ?? displayName(collection.name), Date.now())); }), { key: "rename" }),
                    kit.button(open === collection.name ? "Hide GIFs" : "GIFs", () => { setOpen(open === collection.name ? null : collection.name); }, { key: "gifs" }),
                    kit.button("Delete", run(async () => { if (confirm(`Delete the collection "${displayName(collection.name)}" and its ${collection.gifs.length} GIFs from here?`)) await save(deleteCollection(collections, collection.name)); }), { key: "delete", variant: "danger" })]),
                open !== collection.name ? null : react.createElement("div", { className: "amiricord-panel-grid" }, collection.gifs.length === 0 ? kit.note("This collection is empty.") : collection.gifs.map(gif => react.createElement("div", { key: gif.id, className: "amiricord-panel-tile" },
                    react.createElement(formatOf(gif.src) === 2 ? "video" : "img", { className: "amiricord-panel-thumb", src: gif.src, muted: true, loop: true, autoPlay: true, alt: "" }),
                    kit.row(
                        kit.button("Remove", run(async () => { await apply(removeGif(collections, gif.id, Date.now())); }), { key: "remove", variant: "danger" }),
                        ...collections.filter(other => other.name !== collection.name).slice(0, 3).map(other => kit.button(`To ${displayName(other.name)}`, run(async () => { await apply(moveGif(collections, gif.id, other.name, Date.now())); }), { key: other.name }))))))))
        ]),
        kit.card([
            kit.title("Export and import"),
            kit.note("One file with all your collections. Importing adds the collections that are not here yet (by name); the ones with the same name stay as they are."),
            kit.row(
                kit.button("Export", () => { saveFile(`amiricord-gif-collections-${new Date().toISOString().slice(0, 10)}.json`, exportText(collections)); toast("Exported.", "success"); }, { variant: "primary" }),
                kit.button("Import", run(async () => {
                    const text = await pickFile();
                    if (text === undefined) return;
                    const read = readExport(text);
                    if (!read) { toast("That file is not an export of GIF collections.", "failure"); return; }
                    const have = new Set(collections.map(collection => collection.name));
                    let list = collections;
                    let added = 0;
                    for (const collection of read) {
                        if (have.has(collection.name)) continue;
                        const change = createCollection(list, displayName(collection.name), collection.gifs.map(gif => ({ ...gif, id: `${ITEM_PREFIX}${crypto.randomUUID()}` })), Date.now());
                        if (change.ok) { list = change.list; added++; }
                    }
                    await save(list);
                    toast(`Imported ${added} collections.`, added > 0 ? "success" : "info");
                })))
        ])
    );
}

export default plugin;
