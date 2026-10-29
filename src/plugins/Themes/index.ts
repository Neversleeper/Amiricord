/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Themes core plugin: a "Themes" tab in the Amiricord section with (1) a Quick CSS box that changes Discord's look while you type, (2) themes: files of CSS, with or
// without BetterDiscord's header, that can be imported, made from scratch, edited live, switched on and off and deleted, and (3) one file that exports and imports the plugin
// choices, plugin settings, quick CSS and themes. TestCord has the same things spread over several parts; this is written from scratch for Amiricord. NOT seen in a real Discord.
// Decisions taken while writing it (the owners have not seen them yet):
//  - it is a core plugin because exporting and importing the plugin choices needs the core-only access to them; it does nothing until the person adds CSS;
//  - nothing from here is applied in safe mode (a theme that breaks Discord is a likely reason for safe mode), and the tab says so;
//  - a theme that asks other computers for files (`@import`, `url(https://...)`) is not switched on before the person has seen the list of addresses and agreed: loading
//    a file from a server tells that server your internet address;
//  - themes live in this plugin's storage in Discord's page, not in a folder of files: nothing needs to read or write files on disk except the ones the person picks
//    (import) or saves (export). A theme file on disk cannot be edited from outside and picked up live; edit it in the tab.
//  - the export has settings and choices of plugins, never secrets or tokens (those are not kept as settings); it may hold what the person typed in a setting.

import { currentReact } from "../../api/jsxRuntime";
import { nativeOf } from "../../api/native";
import { PANEL_CSS, panelKit } from "../../api/panelKit";
import type { StyleHandle } from "../../api/styles";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { PROJECT_VERSION } from "../../shared/project";
import type { JsonValue } from "../../shared/settings";
import { ThemesIcon } from "../Settings/icon";
import { addressProblem, buildExport, cssProblem, hostsQuestion, LIBRARY_SORTS, type LibrarySort, type LibraryTheme, makeId, MAX_NAME_CHARS, MAX_THEMES, parseExport, parseHeader, readIndex, remoteHosts, searchLibrary, THEME_HOSTS, type ThemeEntry } from "./model";
import type * as NativeModule from "./native";

/* eslint-disable @typescript-eslint/no-explicit-any -- the tab is built with React's createElement, which has no types here (as in ProfilePresets and TokenLogin) */

const INDEX_KEY = "index";
const QUICK_KEY = "quick";
const cssKey = (id: string) => `css:${id}`;

interface PageLike { document: Document; confirm(text: string): boolean; setTimeout: typeof setTimeout; URL: typeof URL; }
const page = () => globalThis as unknown as PageLike;

let context: EnginePluginContext | undefined;
let generation = 0;
let safeMode = false;
let quickCss = "";
let index: ThemeEntry[] = [];
const handles = new Map<string, StyleHandle>();
let quickHandle: StyleHandle | undefined;
let panelStyle: StyleHandle | undefined;
const listeners = new Set<() => void>();
const changed = () => { for (const listener of [...listeners]) listener(); };
const toast = (text: string, kind: "info" | "success" | "failure" = "info") => { context?.toasts.show(text, kind); };

async function saveIndex() { await context?.storage.set(INDEX_KEY, index as unknown as JsonValue); }
async function readCss(id: string): Promise<string> {
    const value = await context?.storage.get(cssKey(id));
    return typeof value === "string" ? value : "";
}

/** Puts the CSS of a theme on the page (or takes it off). Nothing is applied in safe mode. */
async function applyTheme(entry: ThemeEntry, css?: string) {
    const existing = handles.get(entry.id);
    if (safeMode || !entry.enabled) { existing?.remove(); handles.delete(entry.id); return; }
    const text = css ?? await readCss(entry.id);
    if (existing) existing.update(text);
    else if (context) handles.set(entry.id, context.addStyle(text, `theme-${entry.id}`));
}

function applyQuick() {
    if (safeMode || quickCss === "") { quickHandle?.remove(); quickHandle = undefined; return; }
    if (quickHandle) quickHandle.update(quickCss);
    else if (context) quickHandle = context.addStyle(quickCss, "quick-css");
}

async function setQuickCss(css: string) {
    const problem = cssProblem(css);
    if (problem) { toast(`Quick CSS: ${problem}`, "failure"); return; }
    quickCss = css;
    applyQuick();
    await context?.storage.set(QUICK_KEY, css);
}

async function addTheme(name: string, css: string, enabled: boolean, meta?: Partial<ThemeEntry>): Promise<ThemeEntry | undefined> {
    const problem = cssProblem(css);
    if (problem) { toast(`${name}: ${problem}`, "failure"); return undefined; }
    if (index.length >= MAX_THEMES) { toast(`There can be at most ${MAX_THEMES} themes.`, "failure"); return undefined; }
    const entry: ThemeEntry = { id: makeId(name, index.map(theme => theme.id)), name: name.slice(0, MAX_NAME_CHARS), author: meta?.author ?? "", description: meta?.description ?? "", version: meta?.version ?? "", enabled: false };
    await context?.storage.set(cssKey(entry.id), css);
    index = [...index, entry];
    await saveIndex();
    if (enabled) await setEnabled(entry.id, true);
    changed();
    return entry;
}

async function setEnabled(id: string, on: boolean) {
    const entry = index.find(theme => theme.id === id);
    if (!entry) return;
    if (on) {
        const hosts = remoteHosts(await readCss(id));
        if (hosts.length > 0 && !page().confirm(hostsQuestion(entry.name, hosts))) return;
    }
    entry.enabled = on;
    index = [...index];
    await saveIndex();
    await applyTheme(entry);
    changed();
}

async function setThemeCss(id: string, css: string) {
    const entry = index.find(theme => theme.id === id);
    const problem = cssProblem(css);
    if (!entry || problem) { if (problem) toast(`${entry?.name ?? id}: ${problem}`, "failure"); return; }
    await context?.storage.set(cssKey(id), css);
    await applyTheme(entry, css);
}

async function removeTheme(id: string) {
    const entry = index.find(theme => theme.id === id);
    if (!entry || !page().confirm(`Delete the theme "${entry.name}"? Its CSS is forgotten.`)) return;
    handles.get(id)?.remove();
    handles.delete(id);
    index = index.filter(theme => theme.id !== id);
    await context?.storage.delete(cssKey(id));
    await saveIndex();
    changed();
}

/** Asks for a file and gives its name and text. Resolves to undefined when none was picked. */
function pickFile(accept: string): Promise<{ name: string; text: string; } | undefined> {
    return new Promise(resolve => {
        const input = page().document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) { resolve(undefined); return; }
            file.text().then(text => { resolve({ name: file.name, text }); }, () => { resolve(undefined); });
        };
        input.click();
    });
}

function saveFile(name: string, text: string, type: string) {
    const address = page().URL.createObjectURL(new Blob([text], { type }));
    const link = page().document.createElement("a");
    link.href = address;
    link.download = name;
    link.click();
    page().setTimeout(() => { page().URL.revokeObjectURL(address); }, 10_000);
}

async function importThemeFile() {
    const file = await pickFile(".css,text/css");
    if (!file) return;
    const meta = parseHeader(file.text, file.name);
    const entry = await addTheme(meta.name, file.text, false, meta);
    if (entry) toast(`Theme "${entry.name}" added. Switch it on when you want it.`, "success");
}

async function exportAll() {
    const themes = await Promise.all(index.map(async entry => ({ name: entry.name, enabled: entry.enabled, css: await readCss(entry.id) })));
    const settings = context?.settingsAdmin?.snapshot;
    saveFile(`amiricord-export-${new Date().toISOString().slice(0, 10)}.json`, buildExport({ settings, quickCss, themes }, PROJECT_VERSION, new Date()), "application/json");
    toast("Exported: settings, plugin choices, quick CSS and themes.", "success");
}

async function importAll() {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    const parsed = parseExport(file.text);
    if (!parsed.ok) { toast(`Import: ${parsed.error}.`, "failure"); return; }
    const { settings, quickCss: css, themes, problems } = parsed.value;
    const known = new Set((context?.plugins?.cards() ?? []).map(card => card.id));
    const counts = Object.keys(settings?.plugins ?? {}).filter(id => known.has(id)).length;
    const question = `Import this file?\n\n${counts} plugins' choices and settings\n${css !== undefined ? "the quick CSS (replaces yours)\n" : ""}${themes.length} themes (added next to yours)\n${problems.length > 0 ? `\n${problems.length} things in the file were not valid and are left out.\n` : ""}\nPlugins you turn on this way may need a restart of Discord.`;
    if (!page().confirm(question)) return;
    let applied = 0;
    let skipped = 0;
    for (const [id, plugin] of Object.entries(settings?.plugins ?? {})) {
        if (!known.has(id)) { skipped++; continue; }
        for (const [key, value] of Object.entries(plugin.values ?? {})) {
            if (context?.settingsAdmin?.change({ type: "plugin-setting", plugin: id, key, value }) === null) applied++; else skipped++;
        }
        const card = context?.plugins?.card(id);
        if (plugin.enabled !== undefined && card && !card.core) { try { await context?.plugins?.toggle(id, plugin.enabled); applied++; } catch { skipped++; } }
    }
    if (css !== undefined) await setQuickCss(css);
    let added = 0;
    for (const theme of themes) {
        if (await addTheme(theme.name, theme.css, false)) added++;
    }
    changed();
    toast(`Imported: ${applied} settings and choices, ${added} themes${css !== undefined ? ", the quick CSS" : ""}${skipped > 0 ? `; ${skipped} left out` : ""}.`, skipped > 0 || problems.length > 0 ? "info" : "success");
}

// ---------------------------------------------------------------------------------------------------------------------
// Themes from the library and from an address

let libraryCache: LibraryTheme[] | undefined;

/** The catalogue of themes (themes.equicord.org, the one TestCord shows). Asked when the person presses the button, once per start. */
async function loadLibrary(): Promise<LibraryTheme[]> {
    if (libraryCache) return libraryCache;
    if (!context) throw new Error("the plugin is not running");
    // Discord's page may not talk to other computers (its content security policy), so the main process asks and sends the list back, without each theme's CSS.
    libraryCache = await nativeOf<typeof NativeModule>(context.native).library();
    return libraryCache;
}

async function addFromLibrary(theme: LibraryTheme) {
    if (!context) return;
    const css = await nativeOf<typeof NativeModule>(context.native).themeCss(theme.id);
    const entry = await addTheme(theme.name, css, false, { author: theme.author, description: theme.description });
    if (entry) toast(`Theme "${entry.name}" added. Switch it on when you want it.`, "success");
}

async function addFromAddress(address: string): Promise<boolean> {
    const problem = addressProblem(address);
    if (problem || !context) { toast(`Theme address: ${problem ?? "the plugin is not running"}.`, "failure"); return false; }
    const url = new URL(address.trim());
    let css: string;
    try {
        css = await nativeOf<typeof NativeModule>(context.native).textAt(url.href);
    } catch (error) {
        toast(`Theme address: ${error instanceof Error ? error.message : "no answer"}.`, "failure");
        return false;
    }
    const meta = parseHeader(css, decodeURIComponent(url.pathname.split("/").pop() ?? ""));
    const entry = await addTheme(meta.name, css, false, meta);
    if (entry) toast(`Theme "${entry.name}" added. Switch it on when you want it.`, "success");
    return entry !== undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// The tab

const SHOWN_STEP = 24;

/** The preview pictures read so far (address -> embedded image), and the ones being read: three at a time, so opening the library does not ask for all of them at once. */
const pictures = new Map<string, string>();
const waiting: Array<() => void> = [];
let reading = 0;

async function readPicture(address: string): Promise<string> {
    const known = pictures.get(address);
    if (known) return known;
    while (reading >= 3) await new Promise<void>(resolve => { waiting.push(resolve); });
    reading++;
    try {
        if (!context) throw new Error("the plugin is not running");
        const picture = await nativeOf<typeof NativeModule>(context.native).thumbnail(address);
        pictures.set(address, picture);
        return picture;
    } finally {
        reading--;
        waiting.shift()?.();
    }
}

/** The preview of a library theme: a grey box until the picture is read, and nothing more when it cannot be. */
function Preview({ address }: { address: string; }) {
    const react = currentReact() as any;
    const [picture, setPicture] = react.useState(pictures.get(address) ?? "") as [string, (value: string) => void];
    react.useEffect(() => {
        let alive = true;
        if (address !== "" && !pictures.has(address)) readPicture(address).then(found => { if (alive) setPicture(found); }, () => undefined);
        return () => { alive = false; };
    }, [address]);
    return picture === "" ? react.createElement("div", { className: "amiricord-panel-thumb" }) : react.createElement("img", { className: "amiricord-panel-thumb", src: picture, alt: "", draggable: false });
}

function ThemesTab() {
    const react = currentReact() as any;
    const [, tick] = react.useState(0) as [number, (value: number) => void];
    const [editing, setEditing] = react.useState(null) as [string | null, (value: string | null) => void];
    const [draft, setDraft] = react.useState("") as [string, (value: string) => void];
    const [quick, setQuick] = react.useState(quickCss) as [string, (value: string) => void];
    const [name, setName] = react.useState("") as [string, (value: string) => void];
    const [address, setAddress] = react.useState("") as [string, (value: string) => void];
    const [search, setSearch] = react.useState("") as [string, (value: string) => void];
    const [library, setLibrary] = react.useState(libraryCache ?? null) as [LibraryTheme[] | null, (value: LibraryTheme[] | null) => void];
    const [libraryState, setLibraryState] = react.useState("idle") as [string, (value: string) => void];
    const [libraryQuery, setLibraryQuery] = react.useState("") as [string, (value: string) => void];
    const [librarySort, setLibrarySort] = react.useState("downloads") as [LibrarySort, (value: LibrarySort) => void];
    const [shownCount, setShownCount] = react.useState(SHOWN_STEP) as [number, (value: number) => void];
    const timer = react.useRef(undefined) as { current: ReturnType<typeof setTimeout> | undefined; };

    react.useEffect(() => {
        const listener = () => { tick(Date.now()); };
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);

    const kit = panelKit({ react, Button: context?.components.Button.get() });
    const later = (work: () => void) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(work, 250); };
    const run = (work: () => Promise<void>) => () => { work().catch(error => { context?.reportError("Themes", error); toast("Something went wrong in Themes.", "failure"); }); };

    const editTheme = (entry: ThemeEntry) => run(async () => { setDraft(await readCss(entry.id)); setEditing(entry.id); });
    const openLibrary = run(async () => {
        setLibraryState("loading");
        try {
            setLibrary(await loadLibrary());
            setLibraryState("ready");
        } catch (error) {
            setLibraryState("error");
            toast(`The library could not be read: ${error instanceof Error ? error.message : "no answer"}.`, "failure");
        }
    });

    const editor = editing === null ? null : kit.card([
        kit.title(`Editing: ${index.find(theme => theme.id === editing)?.name ?? editing}`),
        kit.note("The page changes while you type."),
        kit.area({ value: draft, rows: 16, onChange: value => { setDraft(value); const id = editing; later(() => { void setThemeCss(id, value); }); } }),
        kit.row(kit.button("Close editor", () => { setEditing(null); }, { variant: "primary" }))
    ]);

    const wanted = search.trim().toLowerCase();
    const installed = index.filter(entry => wanted === "" || `${entry.name} ${entry.author} ${entry.description}`.toLowerCase().includes(wanted));
    const taken = new Set(index.map(entry => entry.name.toLowerCase()));
    const found = library ? searchLibrary(library, libraryQuery, librarySort) : [];

    return kit.panel(
        safeMode ? kit.card([kit.note("Safe mode is on, so no theme and no quick CSS is applied. You can still edit them here.")], true) : null,

        kit.card([
            kit.title("Quick CSS"),
            kit.note("CSS that applies at once, as you type. It stays after a restart."),
            kit.area({ value: quick, placeholder: "/* your CSS */", rows: 8, onChange: value => { setQuick(value); later(() => { void setQuickCss(value); }); } })
        ]),

        kit.card([
            kit.title(`Installed themes (${index.length}/${MAX_THEMES})`),
            index.length > 5 ? kit.input({ value: search, placeholder: "Search your themes", onChange: setSearch }) : null,
            index.length === 0 ? kit.note("No themes yet. Add one below, or look in the library.") : installed.length === 0 ? kit.note("None of your themes matches the search.") : installed.map(entry => kit.item(
                entry.id,
                kit.switch({ checked: entry.enabled, label: `Switch ${entry.name} on or off`, onChange: on => { void setEnabled(entry.id, on); } }),
                entry.name + (entry.version ? ` ${entry.version}` : ""),
                [entry.author && `by ${entry.author}`, entry.description].filter(Boolean).join(" - "),
                [
                    kit.button("Edit", editTheme(entry), { key: "edit" }),
                    kit.button("Save file", run(async () => { saveFile(`${entry.id}.theme.css`, await readCss(entry.id), "text/css"); }), { key: "save" }),
                    kit.button("Delete", run(() => removeTheme(entry.id)), { key: "delete", variant: "danger" })
                ]))
        ]),

        editor,

        kit.card([
            kit.title("Add a theme"),
            kit.note("A theme is a CSS file, with or without BetterDiscord's header (the lines that say its name and author). A theme that asks other computers for files asks you before it is switched on."),
            kit.row(
                kit.button("Import a theme file", run(importThemeFile), { variant: "primary" }),
                kit.input({ value: name, placeholder: "Name of a new theme", maxLength: MAX_NAME_CHARS, onChange: setName }),
                kit.button("Create", run(async () => {
                    const entry = await addTheme(name.trim() || "My theme", "/* Write your theme here */\n", false, { author: "me" });
                    if (entry) { setName(""); setDraft("/* Write your theme here */\n"); setEditing(entry.id); }
                }))),
            kit.row(
                kit.input({ value: address, placeholder: "https://raw.githubusercontent.com/.../theme.css", onChange: setAddress }),
                kit.button("Add from address", run(async () => { if (await addFromAddress(address)) setAddress(""); }))),
            kit.note(`From an address, only ${THEME_HOSTS.join(", ")}. The theme is copied here: it does not change when the page it came from changes.`)
        ]),

        kit.card([
            kit.title("Theme library"),
            kit.note("The themes of themes.equicord.org, the catalogue TestCord shows (many are BetterDiscord themes). Opening it asks that site for its list: it learns your internet address and nothing else. A theme you add is copied here, off until you switch it on."),
            library === null
                ? kit.row(kit.button(libraryState === "loading" ? "Loading..." : "Browse the library", openLibrary, { variant: "primary", disabled: libraryState === "loading" }))
                : kit.row(
                    kit.input({ value: libraryQuery, placeholder: `Search ${library.length} themes`, onChange: value => { setLibraryQuery(value); setShownCount(SHOWN_STEP); } }),
                    kit.select({ value: librarySort, options: LIBRARY_SORTS, onChange: value => { setLibrarySort(value as LibrarySort); setShownCount(SHOWN_STEP); } })),
            library !== null && found.length === 0 ? kit.note("No theme matches the search.") : null,
            library !== null && found.length > 0 ? react.createElement("div", { className: "amiricord-panel-grid" }, found.slice(0, shownCount).map(theme => react.createElement("div", { key: theme.id, className: "amiricord-panel-tile" },
                theme.thumbnail === "" ? null : react.createElement(Preview, { address: theme.thumbnail }),
                kit.title(theme.name),
                kit.note(`${theme.author ? `by ${theme.author} - ` : ""}${theme.downloads} downloads, ${theme.likes} likes`),
                theme.description === "" ? null : react.createElement("div", { className: "amiricord-panel-tile-text" }, theme.description),
                kit.chips(theme.tags),
                kit.row(taken.has(theme.name.toLowerCase()) ? kit.note("Already added") : kit.button("Add", run(() => addFromLibrary(theme)), { variant: "primary" }))))) : null,
            library !== null && found.length > shownCount ? kit.row(kit.button(`Show more (${found.length - shownCount} left)`, () => { setShownCount(shownCount + SHOWN_STEP); })) : null
        ]),

        kit.card([
            kit.title("Export and import"),
            kit.note("One file with the plugin choices, the plugin settings, the quick CSS and the themes. It holds what you typed into settings, so keep it to yourself; tokens and secrets are not in it."),
            kit.row(
                kit.button("Export everything", run(exportAll), { variant: "primary" }),
                kit.button("Import a file", run(importAll)))
        ]));
}

const plugin: PluginCode = {
    async start(ctx) {
        const mine = ++generation;
        context = ctx;
        safeMode = ctx.engine?.status().safeMode === true;
        const savedQuick = await ctx.storage.get(QUICK_KEY);
        quickCss = typeof savedQuick === "string" ? savedQuick : "";
        index = readIndex(await ctx.storage.get(INDEX_KEY));
        if (mine !== generation) return;
        applyQuick();
        for (const entry of index) await applyTheme(entry);
        panelStyle = ctx.addStyle(PANEL_CSS, "panel");
        ctx.settingsTabs.add({ title: "Themes", panelTitle: "Themes and Quick CSS", Component: ThemesTab, icon: ThemesIcon as () => unknown });
    },

    stop() {
        generation++;
        for (const handle of handles.values()) handle.remove();
        handles.clear();
        quickHandle?.remove();
        quickHandle = undefined;
        listeners.clear();
        panelStyle?.remove();
        panelStyle = undefined;
        libraryCache = undefined;
        pictures.clear();
        context = undefined;
    }
};

export default plugin;
