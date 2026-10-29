/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin ChannelTabs (authors TheSun, TheKodeToad, keifufu, Nickyux, DiabeloDEV, justjxke and keircn) of Equicord.
// The list of tabs, with no Discord in it, so it can be tested: which tabs are open, which one is selected, what happens when a tab is added, closed or
// moved, and what is kept between sessions. The plugin (`index.tsx`) draws it and tells it where the person went.

export interface ChannelRef {
    guildId: string;
    channelId: string;
}

export interface Tab extends ChannelRef {
    id: number;
    compact: boolean;
    messageId?: string;
}

export interface Bookmark extends ChannelRef {
    name: string;
}

/** The part of the plugin's settings the list of tabs depends on. */
export interface TabOptions {
    maxOpenTabs: number;
    oneTabPerServer: boolean;
    switchToExistingTab: boolean;
    createNewTabIfNotExists: boolean;
    enableRapidNavigation: boolean;
    /** In seconds. */
    rapidNavigationThreshold: number;
    openNewTabsInCompactMode: boolean;
}

export interface SavedTabs {
    openTabs: Tab[];
    openTabIndex: number;
    bookmarks: Bookmark[];
}

/** The direct message list, the friends page and so on have no channel: they get a name that starts with two underscores. */
export const SPECIAL_PAGES: Record<string, { route: string; label: string; }> = {
    __friends__: { route: "/channels/@me", label: "Friends" },
    __quests__: { route: "/quest-home", label: "Quests" },
    "__message-requests__": { route: "/message-requests", label: "Message requests" },
    __activity__: { route: "/channels/@me/activity", label: "Activity" },
    __shop__: { route: "/shop", label: "Shop" },
    __library__: { route: "/library", label: "Library" },
    __discovery__: { route: "/discovery", label: "Discover" },
    __nitro__: { route: "/store", label: "Nitro" },
    __icymi__: { route: "/icymi", label: "In case you missed it" }
};

/** The special page that belongs to an address, or undefined when it is none of them. The order matters: `/channels/@me/activity` before `/channels/@me`. */
export function specialPageForPath(path: string): string | undefined {
    if (path.includes("quest-home")) return "__quests__";
    if (path.includes("/message-requests")) return "__message-requests__";
    if (path === "/channels/@me/activity") return "__activity__";
    if (path === "/channels/@me") return "__friends__";
    if (path.includes("/shop")) return "__shop__";
    if (path.includes("/library")) return "__library__";
    if (path.includes("/discovery")) return "__discovery__";
    if (path.includes("/store")) return "__nitro__";
    if (path.includes("/icymi")) return "__icymi__";
    return undefined;
}

export const MAX_SAVED_TABS = 100;
export const MAX_BOOKMARKS = 200;

const text = (value: unknown, max: number): string | undefined => (typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined);

/** Tabs and bookmarks read back from storage: anything that does not have the right shape is dropped, never trusted. */
export function cleanSaved(value: unknown): SavedTabs | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const raw = value as { openTabs?: unknown; openTabIndex?: unknown; bookmarks?: unknown; };
    const openTabs: Tab[] = [];
    if (Array.isArray(raw.openTabs)) {
        for (const entry of raw.openTabs.slice(0, MAX_SAVED_TABS)) {
            const tab = entry as Partial<Tab> | null;
            const channelId = text(tab?.channelId, 64);
            const guildId = text(tab?.guildId, 64);
            if (!channelId || !guildId) continue;
            openTabs.push({ id: openTabs.length, guildId, channelId, compact: tab?.compact === true });
        }
    }
    const bookmarks: Bookmark[] = [];
    if (Array.isArray(raw.bookmarks)) {
        for (const entry of raw.bookmarks.slice(0, MAX_BOOKMARKS)) {
            const mark = entry as Partial<Bookmark> | null;
            const channelId = text(mark?.channelId, 64);
            const guildId = text(mark?.guildId, 64);
            if (!channelId || !guildId) continue;
            bookmarks.push({ guildId, channelId, name: text(mark?.name, 100) ?? "" });
        }
    }
    const index = typeof raw.openTabIndex === "number" && Number.isInteger(raw.openTabIndex) ? raw.openTabIndex : 0;
    return { openTabs, openTabIndex: index, bookmarks };
}

const normalize = (guildId: string | null | undefined) => guildId || "@me";

export class TabsModel {
    private tabs: Tab[] = [];
    private closed: Tab[] = [];
    private history: number[] = [];
    private marks: Bookmark[] = [];
    private currentId = -1;
    private nextId = 0;
    private lastNavigation = 0;
    private listeners = new Set<() => void>();
    private versionNumber = 0;

    constructor(
        private readonly options: () => TabOptions,
        /** Called when a tab becomes the selected one and the page has to go to it. */
        private readonly navigate: (tab: Tab) => void = () => undefined,
        private readonly clock: () => number = () => Date.now()
    ) { }

    // --- Reading ----------------------------------------------------------------------------------------------------------------------------

    get openTabs(): readonly Tab[] { return this.tabs; }
    get bookmarks(): readonly Bookmark[] { return this.marks; }
    get selectedId(): number { return this.currentId; }
    get version(): number { return this.versionNumber; }
    get hasClosedTabs(): boolean { return this.closed.length > 0; }
    isSelected(id: number): boolean { return id === this.currentId; }
    selectedTab(): Tab | undefined { return this.tabs.find(tab => tab.id === this.currentId); }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private changed(): void {
        this.versionNumber++;
        for (const listener of [...this.listeners]) listener();
    }

    snapshot(): SavedTabs {
        return {
            openTabs: this.tabs.map(tab => ({ id: tab.id, guildId: tab.guildId, channelId: tab.channelId, compact: tab.compact })),
            openTabIndex: Math.max(0, this.tabs.findIndex(tab => tab.id === this.currentId)),
            bookmarks: this.marks.map(mark => ({ ...mark }))
        };
    }

    // --- Starting and stopping --------------------------------------------------------------------------------------------------------------

    /** Forget everything (a different account, or the plugin stopped). */
    clear(): void {
        this.tabs = [];
        this.closed = [];
        this.history = [];
        this.marks = [];
        this.currentId = -1;
        this.nextId = 0;
        this.lastNavigation = 0;
        this.changed();
    }

    /** Start from what was saved (if anything), or from one tab on `fallback`. Does not navigate. */
    start(saved: SavedTabs | undefined, fallback: ChannelRef): void {
        this.tabs = [];
        this.closed = [];
        this.history = [];
        this.nextId = 0;
        this.marks = saved ? saved.bookmarks.map(mark => ({ ...mark })) : [];
        for (const tab of saved?.openTabs ?? []) this.tabs.push({ id: this.nextId++, guildId: tab.guildId, channelId: tab.channelId, compact: tab.compact });
        if (this.tabs.length === 0) this.tabs.push({ id: this.nextId++, ...fallback, compact: this.options().openNewTabsInCompactMode });
        const picked = this.tabs[saved?.openTabIndex ?? 0] ?? this.tabs[0];
        this.currentId = picked.id;
        this.history = [picked.id];
        this.changed();
    }

    // --- Tabs -------------------------------------------------------------------------------------------------------------------------------

    /** Open a tab. `bypassLimits` skips "one tab per server" and the largest number of tabs (used by "Open in new tab"). */
    create(channel: ChannelRef, switchTo: boolean, messageId?: string, bypassLimits = false, compact?: boolean): void {
        const options = this.options();
        const useCompact = compact ?? options.openNewTabsInCompactMode;
        if (!bypassLimits && options.oneTabPerServer && channel.guildId && channel.guildId !== "@me") {
            const same = this.tabs.find(tab => tab.guildId === channel.guildId);
            if (same) {
                same.channelId = channel.channelId;
                same.messageId = messageId;
                same.compact = useCompact;
                if (switchTo) this.select(same.id);
                else this.changed();
                return;
            }
        }
        if (!bypassLimits && options.maxOpenTabs > 0 && this.tabs.length >= options.maxOpenTabs) {
            const current = this.selectedTab();
            if (current) {
                current.guildId = channel.guildId;
                current.channelId = channel.channelId;
                current.messageId = messageId;
                current.compact = useCompact;
                if (switchTo) this.select(current.id);
                else this.changed();
            }
            return;
        }
        const tab: Tab = { id: this.nextId++, guildId: channel.guildId, channelId: channel.channelId, compact: useCompact, messageId };
        this.tabs.push(tab);
        if (switchTo) this.select(tab.id);
        else this.changed();
    }

    /** Make a tab the selected one and ask the page to go to it. */
    select(id: number): void {
        const tab = this.tabs.find(candidate => candidate.id === id);
        if (!tab) return;
        this.currentId = id;
        this.history.push(id);
        if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
        this.changed();
        this.navigate(tab);
        delete tab.messageId;
    }

    close(id: number): void {
        if (this.tabs.length <= 1) return;
        const index = this.tabs.findIndex(tab => tab.id === id);
        if (index === -1) return;
        const [removed] = this.tabs.splice(index, 1);
        this.closed.push(removed);
        if (this.closed.length > 50) this.closed.shift();
        this.history = this.history.filter(entry => entry !== id);
        if (id === this.currentId) {
            // The tab used before this one, otherwise the one on the right, otherwise the last.
            const previous = [...this.history].reverse().find(entry => this.tabs.some(tab => tab.id === entry));
            const next = previous ?? this.tabs[Math.min(index, this.tabs.length - 1)].id;
            this.select(next);
        } else this.changed();
    }

    closeOthers(id: number): void {
        const keep = this.tabs.find(tab => tab.id === id);
        if (!keep) return;
        this.closed.push(...this.tabs.filter(tab => tab.id !== id).reverse());
        const wasSelected = this.currentId === id;
        this.tabs = [keep];
        this.history = [id];
        if (wasSelected) this.changed();
        else this.select(id);
    }

    closeToTheRight(id: number): void {
        const index = this.tabs.findIndex(tab => tab.id === id);
        if (index === -1 || index === this.tabs.length - 1) return;
        this.closed.push(...this.tabs.slice(index + 1).reverse());
        this.tabs = this.tabs.slice(0, index + 1);
        this.afterRemoval(this.tabs[this.tabs.length - 1].id);
    }

    closeToTheLeft(id: number): void {
        const index = this.tabs.findIndex(tab => tab.id === id);
        if (index <= 0) return;
        this.closed.push(...this.tabs.slice(0, index).reverse());
        this.tabs = this.tabs.slice(index);
        this.afterRemoval(this.tabs[0].id);
    }

    private afterRemoval(replacement: number): void {
        const ids = new Set(this.tabs.map(tab => tab.id));
        this.history = this.history.filter(entry => ids.has(entry));
        if (ids.has(this.currentId)) this.changed();
        else this.select(replacement);
    }

    reopenClosed(): void {
        const tab = this.closed.pop();
        if (tab) this.create({ guildId: tab.guildId, channelId: tab.channelId }, true, undefined, true, tab.compact);
    }

    /** Move the tab at `from` so that it ends at `to` (the positions after the move). */
    move(from: number, to: number): void {
        if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length) return;
        const [tab] = this.tabs.splice(from, 1);
        this.tabs.splice(to, 0, tab);
        this.changed();
    }

    toggleCompact(id: number): void {
        const tab = this.tabs.find(candidate => candidate.id === id);
        if (!tab) return;
        tab.compact = !tab.compact;
        this.changed();
    }

    /** The next (1) or previous (-1) tab, wrapping around. */
    cycle(direction: 1 | -1): void {
        if (this.tabs.length < 2) return;
        const index = this.tabs.findIndex(tab => tab.id === this.currentId);
        if (index === -1) return;
        this.select(this.tabs[(index + direction + this.tabs.length) % this.tabs.length].id);
    }

    /** The tab at a position (0 based), for the number keys. */
    selectPosition(position: number): boolean {
        const tab = this.tabs[position];
        if (!tab) return false;
        this.select(tab.id);
        return true;
    }

    /**
     * The person went to a channel by themselves (a click in the channel list, a link): the selected tab follows, or another tab takes over, depending on
     * the settings. Never navigates (the page is already there).
     */
    channelChanged(channel: ChannelRef): void {
        if (!channel.channelId) return;
        const options = this.options();
        const guildId = normalize(channel.guildId);
        const current = this.selectedTab();
        const existing = this.tabs.find(tab => tab.channelId === channel.channelId && normalize(tab.guildId) === guildId);
        if (existing && (options.switchToExistingTab || existing.id === this.currentId)) {
            if (existing.id !== this.currentId) {
                this.currentId = existing.id;
                this.history.push(existing.id);
                this.changed();
            }
            return;
        }
        if (options.createNewTabIfNotExists) {
            const now = this.clock();
            const rapid = options.enableRapidNavigation && now - this.lastNavigation < options.rapidNavigationThreshold * 1000;
            this.lastNavigation = now;
            if (rapid && current && current.channelId !== channel.channelId) {
                current.guildId = guildId;
                current.channelId = channel.channelId;
                this.changed();
                return;
            }
            const tab: Tab = { id: this.nextId++, guildId, channelId: channel.channelId, compact: options.openNewTabsInCompactMode };
            this.tabs.push(tab);
            this.currentId = tab.id;
            this.history.push(tab.id);
            this.changed();
            return;
        }
        if (current && current.channelId !== channel.channelId) {
            current.guildId = guildId;
            current.channelId = channel.channelId;
            this.changed();
        }
    }

    // --- Bookmarks --------------------------------------------------------------------------------------------------------------------------

    addBookmark(channel: ChannelRef, name: string): void {
        if (this.marks.length >= MAX_BOOKMARKS) return;
        if (this.marks.some(mark => mark.channelId === channel.channelId && normalize(mark.guildId) === normalize(channel.guildId))) return;
        this.marks.push({ guildId: normalize(channel.guildId), channelId: channel.channelId, name: name.slice(0, 100) });
        this.changed();
    }

    removeBookmark(index: number): void {
        if (index < 0 || index >= this.marks.length) return;
        this.marks.splice(index, 1);
        this.changed();
    }

    renameBookmark(index: number, name: string): void {
        const mark = this.marks[index];
        if (!mark) return;
        mark.name = name.slice(0, 100);
        this.changed();
    }

    moveBookmark(from: number, to: number): void {
        if (from === to || from < 0 || to < 0 || from >= this.marks.length || to >= this.marks.length) return;
        const [mark] = this.marks.splice(from, 1);
        this.marks.splice(to, 0, mark);
        this.changed();
    }

    isBookmarked(channel: ChannelRef): boolean {
        return this.marks.some(mark => mark.channelId === channel.channelId && normalize(mark.guildId) === normalize(channel.guildId));
    }
}
