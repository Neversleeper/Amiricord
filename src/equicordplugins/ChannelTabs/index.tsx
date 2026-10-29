/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores have no types */

// Adapted for Amiricord (2026) from the plugin ChannelTabs (authors TheSun, TheKodeToad, keifufu, Nickyux, DiabeloDEV, justjxke and keircn) of Equicord. Differences from the original:
//  - NOT brought: remembering the scroll position of each tab, Ctrl+click in the inbox and in search results to open a tab, unread badges, folders of bookmarks, dragging bookmarks, the
//    animation switches, tab numbers, the preview of start-up tabs. The first two need patches in parts of Discord that were not in the readable part of build 653945 (the message list, the
//    inbox and the search results are in files loaded later); the rest is looks, left out to keep the port small. What is here: the tab bar (top or bottom), new / close / reorder /
//    compact tabs, a right-click menu, a bar of bookmarks, shortcuts, "Open in new tab" in Discord's menus, and remembering the tabs between sessions.
//  - the tabs and bookmarks are kept in the plugin's own storage (`ctx.storage`), not in Vencord's DataStore;
//  - Discord's router is not found by name (its exports are minified in this build): the patch in `transitionToGuild` hands the two functions to the plugin;
//  - the tab bar is put next to the main part of the app (patch `"AppView"`) with the original text and `className` kept, so Discord's layout is not touched.
// Patches `"AppView"` and `transitionToGuild` were checked against Discord's web build 653945 and match once. Whether the bar looks right (its place in Discord's layout) and the right-click
// names (`channel-context`, `gdm-context`, `user-context`, `channel-mention-context`: Vencord's, not in the readable part of the build) were NOT seen in a real Discord.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { matchesKeybind, numberKey } from "./keybinds";
import { type Bookmark, type ChannelRef, cleanSaved, type SavedTabs, SPECIAL_PAGES, specialPageForPath, type Tab, TabsModel } from "./model";

const settings = definePluginSettings({
    onStartup: {
        type: "select", default: "nothing", description: "On startup",
        options: [
            { label: "Open one tab on the page you are on", value: "nothing" },
            { label: "Remember the tabs from the last session", value: "remember" }
        ]
    },
    tabBarPosition: {
        type: "select", default: "top", description: "Where to show the tab bar.", restartNeeded: true,
        options: [{ label: "Top", value: "top" }, { label: "Bottom", value: "bottom" }]
    },
    showBookmarkBar: { type: "boolean", default: true, description: "Show the bar of bookmarks." },
    openNewTabsInCompactMode: { type: "boolean", default: false, description: "Open new tabs in compact mode (only the icon)." },
    tabHeightScale: { type: "number", default: 100, min: 60, max: 160, integer: true, description: "Tab height, in percent." },
    maxOpenTabs: { type: "number", default: 0, min: 0, max: 50, integer: true, description: "Largest number of tabs (0 for no limit). At the limit a new tab replaces the selected one." },
    oneTabPerServer: { type: "boolean", default: false, description: "Only one tab for each server: going to another channel of it changes that tab." },
    switchToExistingTab: { type: "boolean", default: false, description: "Switch to the tab if one already shows the channel you go to." },
    createNewTabIfNotExists: { type: "boolean", default: false, description: "Open a new tab when you go to a channel that has none." },
    enableRapidNavigation: { type: "boolean", default: false, description: "Going quickly from channel to channel changes the selected tab instead of opening new ones." },
    rapidNavigationThreshold: { type: "number", default: 3, min: 1, max: 60, integer: true, description: "Seconds that count as quick for the setting above." },
    openInNewTabAutoSwitch: { type: "boolean", default: false, description: "\"Open in new tab\" also goes to the new tab." },
    newTabButtonBehavior: { type: "boolean", default: false, description: "Draw the new tab button right after the last tab instead of at the end of the bar." },
    enableNumberKeySwitching: { type: "boolean", default: true, description: "Number keys (1 to 9) switch tabs, when you are not typing." },
    numberKeySwitchCount: { type: "number", default: 3, min: 1, max: 9, integer: true, description: "How many tabs the number keys reach." },
    enableCloseTabShortcut: { type: "boolean", default: true, description: "Shortcut that closes the selected tab." },
    closeTabKeybind: { type: "string", default: "CTRL+W", maxLength: 40, description: "Shortcut to close the selected tab (modifiers CTRL, SHIFT, ALT, then the key)." },
    enableNewTabShortcut: { type: "boolean", default: true, description: "Shortcut that opens a new tab." },
    newTabKeybind: { type: "string", default: "CTRL+T", maxLength: 40, description: "Shortcut to open a new tab." },
    enableTabCycleShortcut: { type: "boolean", default: true, description: "Shortcuts that go to the next and the previous tab." },
    cycleTabForwardKeybind: { type: "string", default: "CTRL+TAB", maxLength: 40, description: "Shortcut to go to the next tab." },
    cycleTabBackwardKeybind: { type: "string", default: "CTRL+SHIFT+TAB", maxLength: 40, description: "Shortcut to go to the previous tab." }
});

const STORAGE_KEY = "tabs";
const NAVIGATION_FLAG_MS = 1000;

const CSS = `
.ac-ct-container { position: absolute; left: 0; right: 0; display: flex; flex-direction: column; background: var(--background-base-lowest, var(--background-tertiary)); color: var(--text-default, var(--text-normal)); user-select: none; z-index: 1; }
.ac-ct-row { display: flex; align-items: center; gap: 4px; padding: 4px 8px; box-sizing: border-box; min-height: calc(34px * var(--ac-ct-scale, 1)); overflow-x: auto; scrollbar-width: none; }
.ac-ct-row::-webkit-scrollbar { display: none; }
.ac-ct-marks { border-bottom: 1px solid var(--background-modifier-accent, rgba(128,128,128,0.3)); }
.ac-ct-tab, .ac-ct-mark { display: flex; align-items: center; gap: 6px; flex: 0 1 180px; min-width: 56px; height: calc(26px * var(--ac-ct-scale, 1)); padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.ac-ct-tab:hover, .ac-ct-mark:hover { background: var(--background-modifier-hover, rgba(128,128,128,0.15)); }
.ac-ct-tab[data-selected="true"] { background: var(--background-modifier-selected, rgba(128,128,128,0.3)); box-shadow: inset 0 -2px 0 var(--brand-500, #5865f2); }
.ac-ct-tab[data-compact="true"] { flex: 0 0 auto; min-width: 0; }
.ac-ct-tab[data-compact="true"] .ac-ct-name { display: none; }
.ac-ct-tab[data-compact="true"][data-selected="true"] .ac-ct-name { display: inline; }
.ac-ct-tab[data-drop="true"] { box-shadow: inset 2px 0 0 var(--brand-500, #5865f2); }
.ac-ct-mark { flex: 0 0 auto; max-width: 160px; }
.ac-ct-icon { width: 18px; height: 18px; border-radius: 50%; flex: 0 0 auto; object-fit: cover; display: inline-flex; align-items: center; justify-content: center; background: var(--background-mod-strong, #4e5058); color: var(--text-default, #fff); font-size: 11px; }
.ac-ct-name { overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; text-align: left; }
.ac-ct-close { width: 16px; height: 16px; flex: 0 0 auto; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; line-height: 16px; padding: 0; opacity: 0.6; }
.ac-ct-close:hover { opacity: 1; background: var(--background-modifier-hover, rgba(128,128,128,0.3)); }
.ac-ct-new { width: calc(26px * var(--ac-ct-scale, 1)); height: calc(26px * var(--ac-ct-scale, 1)); flex: 0 0 auto; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
.ac-ct-new:hover { background: var(--background-modifier-hover, rgba(128,128,128,0.15)); }
.ac-ct-spacer { flex: 1 1 auto; }
`;

// --- Everything the tab bar draws from ---------------------------------------------------------------------------------------------------

let context: EnginePluginContext | undefined;
// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
let users: { get(): any; } | undefined;
let channels: { get(): any; } | undefined;
let guilds: { get(): any; } | undefined;
let selectedChannel: { get(): any; } | undefined;
let selectedGuild: { get(): any; } | undefined;

// The two navigation functions of Discord's router, given by the patch.
let transitionToGuild: ((guildId: string, channelId: string) => void) | undefined;
let transitionTo: ((path: string) => void) | undefined;

let navigating = false;
let navigationTimer: ReturnType<typeof setTimeout> | undefined;
let loadedFor: string | undefined;
let started = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let allSaved: Record<string, SavedTabs> = {};
let uiVersion = 0;
const uiListeners = new Set<() => void>();
let stopWatching: Array<() => void> = [];

function bumpUi(): void {
    uiVersion++;
    for (const listener of [...uiListeners]) listener();
}

const model = new TabsModel(() => ({
    maxOpenTabs: settings.store.maxOpenTabs,
    oneTabPerServer: settings.store.oneTabPerServer,
    switchToExistingTab: settings.store.switchToExistingTab,
    createNewTabIfNotExists: settings.store.createNewTabIfNotExists,
    enableRapidNavigation: settings.store.enableRapidNavigation,
    rapidNavigationThreshold: settings.store.rapidNavigationThreshold,
    openNewTabsInCompactMode: settings.store.openNewTabsInCompactMode
}), goTo);

/** Take the page to a tab. The CHANNEL_SELECT that follows is ours, so the tabs must not react to it. */
function goTo(tab: Tab): void {
    navigating = true;
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => { navigating = false; }, NAVIGATION_FLAG_MS);
    const special = SPECIAL_PAGES[tab.channelId];
    if (special) {
        transitionTo?.(special.route);
        return;
    }
    if (tab.messageId) {
        transitionTo?.(`/channels/${tab.guildId}/${tab.channelId}/${tab.messageId}`);
        return;
    }
    const sameChannel = selectedChannel?.get()?.getChannelId?.() === tab.channelId && (selectedGuild?.get()?.getGuildId?.() || "@me") === (tab.guildId || "@me");
    if (!sameChannel) transitionToGuild?.(tab.guildId, tab.channelId);
}

function currentLocation(): ChannelRef {
    const channelId = selectedChannel?.get()?.getChannelId?.() as string | undefined;
    if (channelId) return { guildId: selectedGuild?.get()?.getGuildId?.() || "@me", channelId };
    return { guildId: "@me", channelId: specialPageForPath(window.location.pathname) ?? "__friends__" };
}

function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        if (!started || !loadedFor || !context) return;
        allSaved[loadedFor] = model.snapshot();
        void context.storage.set(STORAGE_KEY, allSaved as never);
    }, 300);
}

/** Load the saved tabs of the account in use, once per account. */
async function begin(): Promise<void> {
    const ctx = context;
    const userId = users?.get()?.getCurrentUser?.()?.id as string | undefined;
    if (!ctx || !userId || loadedFor === userId) return;
    loadedFor = userId;
    started = false;
    const stored = await ctx.storage.get(STORAGE_KEY);
    if (context !== ctx || loadedFor !== userId) return;
    allSaved = {};
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
            const clean = cleanSaved(value);
            if (clean) allSaved[id] = clean;
        }
    }
    const saved = allSaved[userId];
    const remember = settings.store.onStartup === "remember";
    model.start(saved ? { ...saved, openTabs: remember ? saved.openTabs : [] } : undefined, currentLocation());
    started = true;
    bumpUi();
    const selected = model.selectedTab();
    if (selected && remember) goTo(selected);
}

// --- Names and pictures -------------------------------------------------------------------------------------------------------------------

interface Label { name: string; icon?: string; letter: string; }

function labelOf(ref: ChannelRef): Label {
    const special = SPECIAL_PAGES[ref.channelId];
    if (special) return { name: special.label, letter: special.label.slice(0, 1) };
    const channel = channels?.get()?.getChannel?.(ref.channelId);
    if (!channel) return { name: "Unknown channel", letter: "?" };
    if (ref.guildId === "@me" || !channel.guild_id) {
        const store = users?.get();
        const people = ((channel.recipients ?? []) as string[]).map(id => store?.getUser?.(id)).filter(Boolean);
        const name = channel.name || people.map((user: any) => user.globalName || user.username).join(", ") || "Direct message";
        const first = people[0];
        const icon = people.length === 1 && first?.avatar ? `https://cdn.discordapp.com/avatars/${first.id}/${first.avatar}.png?size=32` : undefined;
        return { name, icon, letter: name.slice(0, 1).toUpperCase() };
    }
    const guild = guilds?.get()?.getGuild?.(ref.guildId);
    const icon = guild?.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32` : undefined;
    const name = `#${channel.name ?? "channel"}`;
    return { name: guild ? `${name} · ${guild.name}` : name, icon, letter: (guild?.name ?? "#").slice(0, 1).toUpperCase() };
}

// --- Drawing ---------------------------------------------------------------------------------------------------------------------------------

function useUiVersion(): number {
    const react = currentReact();
    return react.useSyncExternalStore(listener => {
        uiListeners.add(listener);
        return () => { uiListeners.delete(listener); };
    }, () => uiVersion);
}

function Icon({ label }: { label: Label; }) {
    return label.icon
        ? <img className="ac-ct-icon" alt="" src={label.icon} />
        : <span className="ac-ct-icon" aria-hidden="true">{label.letter}</span>;
}

let dragFrom = -1;

function TabView({ tab, index, selected }: { tab: Tab; index: number; selected: boolean; }) {
    const react = currentReact();
    const [dropHere, setDropHere] = react.useState(false);
    const label = labelOf(tab);
    const menu = (event: { clientX: number; clientY: number; preventDefault(): void; }) => {
        event.preventDefault();
        const ctx = context;
        if (!ctx) return;
        const count = model.openTabs.length;
        ctx.contextMenu.open(event, [
            { id: "close", label: "Close tab", disabled: count < 2, action: () => model.close(tab.id) },
            { id: "others", label: "Close other tabs", disabled: count < 2, action: () => model.closeOthers(tab.id) },
            { id: "right", label: "Close tabs to the right", disabled: index >= count - 1, action: () => model.closeToTheRight(tab.id) },
            { id: "left", label: "Close tabs to the left", disabled: index === 0, action: () => model.closeToTheLeft(tab.id) },
            { separator: true },
            { id: "compact", label: tab.compact ? "Show the full name" : "Compact tab", action: () => model.toggleCompact(tab.id) },
            { id: "bookmark", label: "Bookmark this channel", disabled: model.isBookmarked(tab), action: () => model.addBookmark(tab, label.name) },
            { id: "reopen", label: "Reopen closed tab", disabled: !model.hasClosedTabs, action: () => model.reopenClosed() }
        ]);
    };
    return (
        <div
            className="ac-ct-tab" role="tab" tabIndex={0} aria-selected={selected} title={label.name}
            data-selected={selected} data-compact={tab.compact} data-drop={dropHere}
            draggable={true}
            onClick={() => model.select(tab.id)}
            onAuxClick={(event: MouseEvent) => { if (event.button === 1) { event.preventDefault(); model.close(tab.id); } }}
            onContextMenu={menu}
            onDragStart={() => { dragFrom = index; }}
            onDragOver={(event: DragEvent) => { event.preventDefault(); setDropHere(true); }}
            onDragLeave={() => setDropHere(false)}
            onDrop={(event: DragEvent) => { event.preventDefault(); setDropHere(false); if (dragFrom >= 0) model.move(dragFrom, index); dragFrom = -1; }}
            onKeyDown={(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); model.select(tab.id); } }}
        >
            <Icon label={label} />
            <span className="ac-ct-name">{label.name}</span>
            {model.openTabs.length > 1 && <button className="ac-ct-close" aria-label="Close tab" onClick={(event: MouseEvent) => { event.stopPropagation(); model.close(tab.id); }}>×</button>}
        </div>
    );
}

function BookmarkView({ mark, index }: { mark: Bookmark; index: number; }) {
    const live = labelOf(mark);
    const name = SPECIAL_PAGES[mark.channelId] || live.name !== "Unknown channel" ? live.name : mark.name || live.name;
    const menu = (event: { clientX: number; clientY: number; preventDefault(): void; }) => {
        event.preventDefault();
        context?.contextMenu.open(event, [
            { id: "open-tab", label: "Open in new tab", action: () => model.create(mark, true, undefined, true) },
            { id: "left", label: "Move left", disabled: index === 0, action: () => model.moveBookmark(index, index - 1) },
            { id: "right", label: "Move right", disabled: index >= model.bookmarks.length - 1, action: () => model.moveBookmark(index, index + 1) },
            { id: "remove", label: "Remove bookmark", danger: true, action: () => model.removeBookmark(index) }
        ]);
    };
    return (
        <button className="ac-ct-mark" title={name} onClick={() => { model.channelChanged(mark); const id = model.selectedId; if (id >= 0) model.select(id); }} onContextMenu={menu}>
            <Icon label={live} />
            <span className="ac-ct-name">{name}</span>
        </button>
    );
}

function TabBar({ channel }: { channel: Partial<ChannelRef> | undefined; }) {
    const react = currentReact();
    useUiVersion();
    react.useEffect(() => {
        void begin();
        // The account may not be known yet when the bar is first drawn: try again until the tabs have started.
        const timer = setInterval(() => {
            if (started) clearInterval(timer);
            else void begin();
        }, 500);
        return () => clearInterval(timer);
    }, [channel?.guildId, channel?.channelId]);
    // A state holds the bar's element (a callback ref), so the effect below runs once it is drawn.
    const [element, setElement] = react.useState<HTMLElement | null>(null);
    const bottom = settings.store.tabBarPosition === "bottom";
    // Discord's app is a grid that has no room for a third row, so the bar floats over its own strip, and the main part gets that much padding.
    react.useEffect(() => {
        const main = (bottom ? element?.previousElementSibling : element?.nextElementSibling) as HTMLElement | null | undefined;
        if (!element || !main) return;
        const place = () => {
            element.style.top = bottom ? "" : `${main.offsetTop}px`;
            element.style.bottom = bottom ? "0" : "";
            main.style[bottom ? "paddingBottom" : "paddingTop"] = `${element.offsetHeight}px`;
        };
        place();
        const watcher = new ResizeObserver(place);
        watcher.observe(element);
        return () => {
            watcher.disconnect();
            main.style.paddingTop = main.style.paddingBottom = "";
        };
    }, [element, bottom]);
    if (!started) return null;
    const here = (): ChannelRef => (channel?.channelId ? { guildId: channel.guildId || "@me", channelId: channel.channelId } : currentLocation());
    const button = <button key="new" className="ac-ct-new" aria-label="New tab" title="New tab" onClick={() => model.create(here(), true)}>+</button>;
    const follow = settings.store.newTabButtonBehavior;
    const bar = (
        <div className="ac-ct-container" ref={setElement} style={{ "--ac-ct-scale": settings.store.tabHeightScale / 100 } as never}
            onContextMenu={(event: MouseEvent) => {
                if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains("ac-ct-row") && !(event.target as HTMLElement).classList.contains("ac-ct-spacer")) return;
                event.preventDefault();
                context?.contextMenu.open(event, [
                    { id: "new", label: "New tab", action: () => model.create(here(), true) },
                    { id: "reopen", label: "Reopen closed tab", disabled: !model.hasClosedTabs, action: () => model.reopenClosed() }
                ]);
            }}>
            {settings.store.showBookmarkBar && model.bookmarks.length > 0 && (
                <div className="ac-ct-row ac-ct-marks">
                    {model.bookmarks.map((mark, index) => <BookmarkView key={`${mark.guildId}/${mark.channelId}`} mark={mark} index={index} />)}
                </div>
            )}
            <div className="ac-ct-row" role="tablist">
                {model.openTabs.map((tab, index) => <TabView key={tab.id} tab={tab} index={index} selected={model.isSelected(tab.id)} />)}
                {follow && button}
                <span className="ac-ct-spacer" />
                {!follow && button}
            </div>
        </div>
    );
    return bar;
}

function addMenuItem(children: unknown[], props: unknown, ctx: EnginePluginContext): void {
    const channel = (props as { channel?: any; messageId?: string; } | undefined)?.channel;
    const messageId = (props as { messageId?: string; } | undefined)?.messageId;
    const parts = ctx.contextMenu.parts();
    const react = ctx.components.react.get() as any;
    if (!channel?.id || !parts || !react) return;
    children.push(react.createElement(parts.MenuItem as any, {
        id: "ac-open-in-tab", key: "ac-open-in-tab", label: "Open in New Tab",
        action: () => model.create({ guildId: channel.guild_id || "@me", channelId: channel.id }, settings.store.openInNewTabAutoSwitch, messageId, true)
    }));
}

const plugin: PluginCode & {
    render(props: { currentChannel?: Partial<ChannelRef>; children?: unknown; [key: string]: unknown; }): unknown;
    setRouter(toGuild: (guildId: string, channelId: string) => void, to: (path: string) => void): void;
} = {
    settings,

    patches: [
        // The tab bar goes next to the main part of the app: the element that holds the channel list and the chat is kept (with its `className`), as `render` draws it again.
        {
            find: "\"AppView\"",
            replacements: [{
                match: /((\i\?\.params)\.guildId===.{0,300}?)"div",\{(?=className:\i\.\i,children:\[)/,
                replace: "$1$self.render,{currentChannel:$2,"
            }]
        },
        // Discord's router is not reachable by name: hand its two functions (the one that goes to a channel and the one that goes to an address) to the plugin.
        {
            find: "`transitionToGuild - Transitioning to",
            replacements: [{
                match: /function (\i)\((\i),\i,\i,\i\)\{(?=.{0,25}`transitionToGuild.{0,160}?,(\i)\(\i\.\i\.CHANNEL\()/,
                replace: "$self.setRouter($1,$3);$&"
            }]
        }
    ],

    setRouter(toGuild, to) {
        transitionToGuild = toGuild;
        transitionTo = to;
    },

    render({ currentChannel, children, ...rest }) {
        const react = currentReact();
        const bar = react.createElement(TabBar, { channel: currentChannel ?? undefined, key: "channel-tabs" });
        const main = react.createElement("div", { ...rest, key: "channel-tabs-main" }, ...(Array.isArray(children) ? children : [children]));
        return react.createElement(react.Fragment, null, ...(settings.store.tabBarPosition === "top" ? [bar, main] : [main, bar]));
    },

    flux: {
        CHANNEL_SELECT(event: { channelId?: string | null; guildId?: string | null; }) {
            if (navigating) {
                navigating = false;
                clearTimeout(navigationTimer);
                return;
            }
            if (!started) return;
            let channelId = event.channelId ?? undefined;
            let guildId = event.guildId ?? "@me";
            if (!channelId) {
                // A page with no channel (friends, quests, the shop...) is told by its address.
                channelId = specialPageForPath(window.location.pathname);
                guildId = "@me";
                if (!channelId) return;
            }
            model.channelChanged({ guildId, channelId });
        }
    },

    start(ctx) {
        context = ctx;
        users = ctx.common.UserStore;
        channels = ctx.common.ChannelStore;
        guilds = ctx.common.GuildStore;
        selectedChannel = ctx.common.SelectedChannelStore;
        selectedGuild = ctx.common.SelectedGuildStore;
        ctx.addStyle(CSS, "channel-tabs");
        stopWatching = [
            model.subscribe(() => { bumpUi(); scheduleSave(); }),
            settings.subscribe(bumpUi)
        ];
        const onKeyDown = (event: KeyboardEvent) => {
            if (!started) return;
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const store = settings.store;
            const digit = store.enableNumberKeySwitching ? numberKey(event) : 0;
            if (digit > 0 && digit <= store.numberKeySwitchCount && model.selectPosition(digit - 1)) {
                event.preventDefault();
            } else if (store.enableCloseTabShortcut && matchesKeybind(event, store.closeTabKeybind)) {
                event.preventDefault();
                const selected = model.selectedTab();
                if (selected) model.close(selected.id);
            } else if (store.enableNewTabShortcut && matchesKeybind(event, store.newTabKeybind)) {
                event.preventDefault();
                event.stopPropagation();
                model.create(currentLocation(), true);
            } else if (store.enableTabCycleShortcut && matchesKeybind(event, store.cycleTabForwardKeybind)) {
                event.preventDefault();
                event.stopPropagation();
                model.cycle(1);
            } else if (store.enableTabCycleShortcut && matchesKeybind(event, store.cycleTabBackwardKeybind)) {
                event.preventDefault();
                event.stopPropagation();
                model.cycle(-1);
            }
        };
        document.addEventListener("keydown", onKeyDown, true);
        stopWatching.push(() => document.removeEventListener("keydown", onKeyDown, true));
        for (const navId of ["channel-context", "gdm-context", "user-context", "channel-mention-context"]) {
            ctx.contextMenu.addNative(navId, (children, props) => addMenuItem(children as unknown[], props, ctx));
        }
    },

    stop() {
        for (const stop of stopWatching) stop();
        stopWatching = [];
        clearTimeout(saveTimer);
        clearTimeout(navigationTimer);
        navigating = false;
        started = false;
        loadedFor = undefined;
        allSaved = {};
        model.clear();
        context = users = channels = guilds = selectedChannel = selectedGuild = undefined;
        transitionToGuild = transitionTo = undefined;
        uiListeners.clear();
    }
};

export default plugin;
