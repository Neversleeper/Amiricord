/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What happens inside one open Pinterest Tool window, without React or the page: the search and its next pages, the favourites view and the answers to every
// click. The screen (`PinterestWindow.tsx`) only draws `state` and calls these methods. An answer that arrives for a search the person has already replaced is thrown
// away (the call into the main process cannot be cancelled, so it is ignored). Design: docs/analysis-33-pinterest-tool-window.md.

import type { EditorSession } from "./editorSession";
import type { AddResult, Favourite, FavouriteKind } from "./library";
import type { MediaFilter, PinterestGuide, PinterestImageResult, PinterestSearchPayload, SearchOptions } from "./types";

/** What a search is for. `IMAGE` is any picture. */
export type WindowKind = "AVATAR" | "BANNER" | "IMAGE";
export type WindowTab = "search" | "favourites";
export type WindowStatus = "idle" | "loading" | "loading-more" | "error";

export const WINDOW_LIMITS = { maxResults: 400, errorChars: 200 } as const;

export interface SessionState {
    /** The text that was last searched (not what is being typed). */
    query: string;
    kind: WindowKind;
    filter: MediaFilter;
    tab: WindowTab;
    status: WindowStatus;
    /** A short plain message when the last search or page failed; the results already on screen stay. */
    error: string | null;
    /** True once at least one search has been started in this window. */
    searched: boolean;
    results: PinterestImageResult[];
    guides: PinterestGuide[];
    hasMore: boolean;
    /** The favourites of the kind that the favourites tab shows, newest first. */
    favourites: Favourite[];
    favouriteKind: FavouriteKind;
    /** Ids already saved, by kind, so every card knows its heart. */
    saved: Record<FavouriteKind, ReadonlySet<string>>;
    recent: string[];
    /** A short word about the last favourite change ("Saved", "That kind is full"...), or null. */
    notice: string | null;
    /** The editor that is open over the results, or null. */
    editor: EditorSession | null;
}

export interface SessionLibrary {
    favourites(kind?: FavouriteKind): Promise<Favourite[]>;
    addFavourite(result: PinterestImageResult, kind: FavouriteKind): Promise<AddResult>;
    removeFavourite(result: Pick<PinterestImageResult, "id">, kind: FavouriteKind): Promise<boolean>;
    recent(): Promise<string[]>;
    rememberSearch(query: string): Promise<string[]>;
    clearRecent(): Promise<void>;
}

export interface SessionDeps {
    search(options: SearchOptions): Promise<PinterestSearchPayload>;
    library: SessionLibrary;
    /** The "random style word" setting, read at the moment of a new search. */
    randomize(): boolean;
    /** Make the editor for a picture (shaped for icons or banners). Left out when editing is not available. */
    createEditor?(result: PinterestImageResult, kind: FavouriteKind): EditorSession;
}

/** The kinds a heart on a card can save under: the one searched, or either when any picture is searched. */
export function saveKinds(kind: WindowKind): FavouriteKind[] {
    return kind === "IMAGE" ? ["AVATAR", "BANNER"] : [kind];
}

export function describeFailure(error: unknown): string {
    const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const clean = text.replace(/\s+/g, " ").trim().slice(0, WINDOW_LIMITS.errorChars);
    return clean || "The search failed.";
}

const NOTICES: Record<AddResult, string> = {
    added: "Saved to your favourites",
    exists: "Already in your favourites",
    full: "Your favourites of that kind are full, remove one first"
};

export class WindowSession {
    private current: SessionState = {
        query: "", kind: "AVATAR", filter: "ALL", tab: "search", status: "idle", error: null, searched: false, results: [], guides: [], hasMore: false,
        favourites: [], favouriteKind: "AVATAR", saved: { AVATAR: new Set(), BANNER: new Set() }, recent: [], notice: null, editor: null
    };
    private bookmark: string[] | null = null;
    private sequence = 0;
    private closed = false;
    private readonly listeners = new Set<() => void>();

    constructor(private readonly deps: SessionDeps) { }

    get state(): SessionState {
        return this.current;
    }

    /** For `useSyncExternalStore`. Returns a function that stops listening. */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private set(patch: Partial<SessionState>) {
        if (this.closed) return;
        this.current = { ...this.current, ...patch };
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A screen that fails to redraw must not stop the session.
            }
        }
    }

    /** Load what is saved (favourites of both kinds and the recent searches). Never throws. */
    async init(): Promise<void> {
        await Promise.all([this.refreshFavourites(), this.refreshRecent()]);
    }

    private async refreshRecent() {
        try {
            this.set({ recent: await this.deps.library.recent() });
        } catch {
            // Without the list the window still works.
        }
    }

    private async refreshFavourites() {
        try {
            const [avatars, banners] = await Promise.all([this.deps.library.favourites("AVATAR"), this.deps.library.favourites("BANNER")]);
            const shown = this.current.favouriteKind === "AVATAR" ? avatars : banners;
            this.set({ favourites: shown, saved: { AVATAR: new Set(avatars.map(item => item.id)), BANNER: new Set(banners.map(item => item.id)) } });
        } catch {
            // Without favourites the window still works.
        }
    }

    setTab(tab: WindowTab) {
        if (tab !== this.current.tab) this.set({ tab, notice: null });
    }

    async setFavouriteKind(kind: FavouriteKind) {
        if (kind === this.current.favouriteKind) return;
        this.set({ favouriteKind: kind, notice: null });
        await this.refreshFavourites();
    }

    /** Change what is searched for. If a search was already made it is repeated from page 1. */
    setKind(kind: WindowKind) {
        if (kind === this.current.kind) return;
        this.set({ kind, notice: null });
        if (this.current.searched) void this.search(this.current.query);
    }

    setFilter(filter: MediaFilter) {
        if (filter === this.current.filter) return;
        this.set({ filter, notice: null });
        if (this.current.searched) void this.search(this.current.query);
    }

    private options(query: string, bookmarks: string[] | undefined): SearchOptions {
        const { kind, filter } = this.current;
        return { query, mediaFilter: filter, target: kind, ...(bookmarks ? { bookmarks } : {}), ...(bookmarks ? {} : { randomize: this.deps.randomize() }) };
    }

    /** Start a new search from page 1. An empty text does nothing. */
    async search(raw: string): Promise<void> {
        const query = raw.replace(/\s+/g, " ").trim();
        if (!query) return;
        const mine = ++this.sequence;
        this.bookmark = null;
        this.set({ query, tab: "search", status: "loading", error: null, searched: true, results: [], guides: [], hasMore: false, notice: null });
        try {
            const payload = await this.deps.search(this.options(query, undefined));
            if (mine !== this.sequence) return;
            const results = unique([], payload.results);
            this.bookmark = payload.bookmark;
            this.set({ status: "idle", results, guides: payload.guides, hasMore: payload.bookmark !== null && results.length < WINDOW_LIMITS.maxResults });
            void this.remember(query);
        } catch (error) {
            if (mine !== this.sequence) return;
            this.set({ status: "error", error: describeFailure(error) });
        }
    }

    private async remember(query: string) {
        try {
            this.set({ recent: await this.deps.library.rememberSearch(query) });
        } catch {
            // The list is a convenience.
        }
    }

    /** Add the next page to the grid. Does nothing while something is loading or when there is no next page. */
    async loadMore(): Promise<void> {
        const { status, hasMore, query, searched } = this.current;
        const bookmark = this.bookmark;
        if (!searched || !hasMore || !bookmark || status === "loading" || status === "loading-more") return;
        const mine = ++this.sequence;
        this.set({ status: "loading-more", error: null });
        try {
            const payload = await this.deps.search(this.options(query, bookmark));
            if (mine !== this.sequence) return;
            const before = this.current.results.length;
            const results = unique(this.current.results, payload.results);
            this.bookmark = payload.bookmark;
            // A page that brings nothing new ends the list, so a source that repeats itself cannot keep the button alive forever.
            const grew = results.length > before;
            this.set({ status: "idle", results, hasMore: grew && payload.bookmark !== null && results.length < WINDOW_LIMITS.maxResults });
        } catch (error) {
            if (mine !== this.sequence) return;
            this.set({ status: "error", error: describeFailure(error) });
        }
    }

    /** Try the last failed search or page again. */
    async retry(): Promise<void> {
        if (this.current.status !== "error") return;
        if (this.current.results.length > 0 && this.bookmark) {
            // After a failed page the status is "error" with `hasMore` still true, so put it back to idle first.
            this.set({ status: "idle", error: null });
            await this.loadMore();
        } else {
            await this.search(this.current.query);
        }
    }

    async clearRecent(): Promise<void> {
        try {
            await this.deps.library.clearRecent();
            this.set({ recent: [] });
        } catch {
            // Nothing to do.
        }
    }

    /** Save the card under a kind, or take it out of that kind if it is already there. */
    async toggleFavourite(result: PinterestImageResult, kind: FavouriteKind): Promise<void> {
        try {
            if (this.current.saved[kind].has(result.id)) {
                await this.deps.library.removeFavourite(result, kind);
                this.set({ notice: "Removed from your favourites" });
            } else {
                this.set({ notice: NOTICES[await this.deps.library.addFavourite(result, kind)] });
            }
        } catch (error) {
            this.set({ notice: describeFailure(error) });
        }
        await this.refreshFavourites();
    }

    /** Open the editor for a card. A GIF would lose its animation, so it is told no. */
    openEditor(result: PinterestImageResult, kind: FavouriteKind): void {
        if (!this.deps.createEditor || this.current.editor) return;
        if (result.isGif) {
            this.set({ notice: "GIFs cannot be edited yet (they would lose their animation)" });
            return;
        }
        let editor: EditorSession;
        try {
            editor = this.deps.createEditor(result, kind);
        } catch (error) {
            this.set({ notice: describeFailure(error) });
            return;
        }
        this.set({ editor, notice: null });
        void editor.init();
    }

    closeEditor(): void {
        const editor = this.current.editor;
        if (!editor) return;
        editor.close();
        this.set({ editor: null });
    }

    /** Called when the window closes: later answers are ignored and nobody is told anything again. */
    close() {
        this.current.editor?.close();
        this.closed = true;
        this.sequence++;
        this.listeners.clear();
    }
}

function unique(existing: PinterestImageResult[], more: PinterestImageResult[]): PinterestImageResult[] {
    const seen = new Set(existing.map(item => item.id));
    const out = [...existing];
    for (const item of more) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}
