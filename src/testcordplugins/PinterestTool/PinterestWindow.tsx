/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Pinterest Tool window: search box, kind and filter, recent searches and Pinterest's own suggestions, the grid of results with "Load more", and the
// favourites tab. It only draws what `WindowSession` says and reports clicks; pictures come from `ThumbLoader`. The controls are plain elements with our own classes
// (`windowStyles.ts`); only the window frame comes from `ctx.components`. Design: docs/analysis-33-pinterest-tool-window.md.

import { currentReact } from "../../api/jsxRuntime";
import { EditorView } from "./EditorView";
import type { FavouriteKind } from "./library";
import type { ThumbLoader } from "./thumbs";
import type { MediaFilter, PinterestImageResult } from "./types";
import { saveKinds, type SessionState, type WindowKind, type WindowSession } from "./windowSession";

type Part = (props: { children?: unknown; size?: string; onClose?(): void; onClick?(): void; label?: string; }) => unknown;

export interface WindowParts {
    ModalRoot: Part;
    ModalHeader: Part;
    ModalContent: Part;
    ModalFooter: Part;
    ModalCloseButton: Part;
}

export interface PinterestWindowProps {
    session: WindowSession;
    thumbs: ThumbLoader;
    parts: WindowParts;
    /** The CSS variables of the person's theme (`theme.ts`). Read at every draw, so a change of theme shows at once. */
    style(): Record<string, string>;
    onClose(): void;
}

export const KIND_OPTIONS: ReadonlyArray<{ value: WindowKind; label: string; }> = [
    { value: "AVATAR", label: "Profile icons" },
    { value: "BANNER", label: "Banners" },
    { value: "IMAGE", label: "Any image" }
];

export const FILTER_OPTIONS: ReadonlyArray<{ value: MediaFilter; label: string; }> = [
    { value: "ALL", label: "Images and GIFs" },
    { value: "STATIC", label: "Images only" },
    { value: "GIFS", label: "GIFs only" }
];

export const KIND_LABEL: Record<FavouriteKind, string> = { AVATAR: "icon", BANNER: "banner" };

/** The words under the grid, for each situation. */
export function statusLine(state: Pick<SessionState, "status" | "searched" | "results" | "query" | "error" | "hasMore">): string {
    if (state.status === "loading") return "Searching…";
    if (state.status === "loading-more") return "Loading more…";
    if (state.status === "error") return state.error ?? "The search failed.";
    if (!state.searched) return "Type what you are looking for and press Enter.";
    if (state.results.length === 0) return `Nothing found for “${state.query}”. Try other words.`;
    return `${state.results.length} result${state.results.length === 1 ? "" : "s"}${state.hasMore ? "" : " (that is all there is)"}`;
}

interface CardProps {
    result: PinterestImageResult;
    kinds: FavouriteKind[];
    saved: SessionState["saved"];
    thumbs: ThumbLoader;
    onToggle(result: PinterestImageResult, kind: FavouriteKind): void;
    onEdit(result: PinterestImageResult, kind: FavouriteKind): void;
}

/** Which shape an edit starts with: the kind of the heart, or for any image the one that fits the picture better. */
export function editorKindFor(kinds: FavouriteKind[], result: Pick<PinterestImageResult, "width" | "height">): FavouriteKind {
    if (kinds.length === 1) return kinds[0];
    return result.height > 0 && result.width / result.height >= 1.8 ? "BANNER" : "AVATAR";
}

function Card({ result, kinds, saved, thumbs, onToggle, onEdit }: CardProps) {
    const react = currentReact();
    const [source, setSource] = react.useState<string | null>(null);
    const url = result.thumbUrl ?? result.url;
    react.useEffect(() => {
        setSource(null);
        return thumbs.request(url, setSource);
    }, [url]);
    const title = result.title || result.description || "Untitled";
    return (
        <div className="pt-card" data-id={result.id}>
            <div className="pt-pic">
                {source ? <img src={source} alt={title} loading="lazy" draggable="false" /> : null}
                {result.isGif ? <span className="pt-badge">GIF</span> : null}
            </div>
            <div className="pt-card-foot">
                <span className="pt-card-title" title={title}>{title}</span>
                <div className="pt-row">
                    {kinds.map((kind: FavouriteKind) => {
                        const on = saved[kind].has(result.id);
                        return (
                            <button
                                type="button"
                                key={kind}
                                className={`pt-heart${on ? " pt-heart-on" : ""}`}
                                aria-pressed={on ? "true" : "false"}
                                aria-label={`${on ? "Remove from" : "Save to"} favourite ${KIND_LABEL[kind]}s: ${title}`}
                                onClick={() => { onToggle(result, kind); }}
                            >
                                {on ? "♥" : "♡"} {kinds.length > 1 ? KIND_LABEL[kind] : on ? "Saved" : "Save"}
                            </button>
                        );
                    })}
                    <button type="button" className="pt-edit" aria-label={`Edit: ${title}`} onClick={() => { onEdit(result, editorKindFor(kinds, result)); }}>Edit</button>
                </div>
            </div>
        </div>
    );
}

export function PinterestWindow({ session, thumbs, parts, style, onClose }: PinterestWindowProps) {
    const react = currentReact();
    const state = react.useSyncExternalStore(session.subscribe, () => session.state);
    const [text, setText] = react.useState("");
    react.useEffect(() => { void session.init(); }, []);

    const { ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton } = parts;
    const banners = state.tab === "search" ? state.kind === "BANNER" : state.favouriteKind === "BANNER";
    const onToggle = (result: PinterestImageResult, kind: FavouriteKind) => { void session.toggleFavourite(result, kind); };
    const onEdit = (result: PinterestImageResult, kind: FavouriteKind) => { session.openEditor(result, kind); };
    const go = (query: string) => { setText(query); void session.search(query); };
    const busy = state.status === "loading" || state.status === "loading-more";

    return (
        <ModalRoot size="large" label="Pinterest Tool" onClose={onClose}>
            <div className="pt-window" style={style()}>
                <ModalHeader>
                    <div className="pt-bar">
                        <h2 className="pt-title">Pinterest Tool</h2>
                        <div className="pt-tabs" role="tablist">
                            <button type="button" role="tab" aria-selected={state.tab === "search" ? "true" : "false"} className={`pt-button${state.tab === "search" ? " pt-tab-on" : ""}`} onClick={() => { session.setTab("search"); }}>Search</button>
                            <button type="button" role="tab" aria-selected={state.tab === "favourites" ? "true" : "false"} className={`pt-button${state.tab === "favourites" ? " pt-tab-on" : ""}`} onClick={() => { session.setTab("favourites"); }}>Favourites</button>
                        </div>
                        <ModalCloseButton onClick={onClose} />
                    </div>
                </ModalHeader>
                <ModalContent>
                    {state.editor ? (
                        <div className="pt-scroll"><EditorView editor={state.editor} onBack={() => { session.closeEditor(); }} /></div>
                    ) : state.tab === "search" ? (
                        <div className="pt-scroll">
                            <div className="pt-bar">
                                <input
                                    className="pt-input"
                                    type="text"
                                    value={text}
                                    placeholder="Search Pinterest…"
                                    aria-label="Search Pinterest"
                                    maxLength={120}
                                    onChange={(event: { target: { value: string; }; }) => { setText(event.target.value); }}
                                    onKeyDown={(event: { key: string; }) => { if (event.key === "Enter") void session.search(text); }}
                                />
                                <button type="button" className="pt-button pt-button-primary" disabled={busy || text.trim() === ""} onClick={() => { void session.search(text); }}>Search</button>
                                <select className="pt-select" aria-label="What to look for" value={state.kind} onChange={(event: { target: { value: string; }; }) => { session.setKind(event.target.value as WindowKind); }}>
                                    {KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                                <select className="pt-select" aria-label="Images or GIFs" value={state.filter} onChange={(event: { target: { value: string; }; }) => { session.setFilter(event.target.value as MediaFilter); }}>
                                    {FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </div>
                            {text.trim() === "" && state.recent.length > 0 ? (
                                <div className="pt-row">
                                    <span className="pt-muted">Recent:</span>
                                    {state.recent.map((query: string) => <button type="button" key={query} className="pt-chip" onClick={() => { go(query); }}>{query}</button>)}
                                    <button type="button" className="pt-chip" onClick={() => { void session.clearRecent(); }}>Clear</button>
                                </div>
                            ) : null}
                            {state.guides.length > 0 ? (
                                <div className="pt-row">
                                    <span className="pt-muted">Try also:</span>
                                    {state.guides.map((guide: { label: string; query: string; }) => <button type="button" key={guide.query} className="pt-chip" onClick={() => { go(guide.query); }}>{guide.label}</button>)}
                                </div>
                            ) : null}
                            <div className={state.status === "error" ? "pt-error" : "pt-muted"} role="status">{statusLine(state)}</div>
                            {state.status === "error" ? <button type="button" className="pt-button" onClick={() => { void session.retry(); }}>Try again</button> : null}
                            <div className={`pt-grid${banners ? " pt-grid-banner" : ""}`}>
                                {state.results.map((result: PinterestImageResult) => <Card key={result.id} result={result} kinds={saveKinds(state.kind)} saved={state.saved} thumbs={thumbs} onToggle={onToggle} onEdit={onEdit} />)}
                            </div>
                            {state.hasMore && state.status === "idle" ? (
                                <div className="pt-more"><button type="button" className="pt-button" onClick={() => { void session.loadMore(); }}>Load more</button></div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="pt-scroll">
                            <div className="pt-bar">
                                <select className="pt-select" aria-label="Which favourites" value={state.favouriteKind} onChange={(event: { target: { value: string; }; }) => { void session.setFavouriteKind(event.target.value as FavouriteKind); }}>
                                    <option value="AVATAR">Profile icons</option>
                                    <option value="BANNER">Banners</option>
                                </select>
                                <span className="pt-muted">{state.favourites.length} saved</span>
                            </div>
                            {state.favourites.length === 0 ? <div className="pt-muted" role="status">Nothing saved yet. Press the heart on a result to keep it here.</div> : null}
                            <div className={`pt-grid${banners ? " pt-grid-banner" : ""}`}>
                                {state.favourites.map((result: PinterestImageResult) => <Card key={result.id} result={result} kinds={[state.favouriteKind]} saved={state.saved} thumbs={thumbs} onToggle={onToggle} onEdit={onEdit} />)}
                            </div>
                        </div>
                    )}
                </ModalContent>
                <ModalFooter>
                    <span className="pt-notice" role="status">{state.notice ?? ""}</span>
                </ModalFooter>
            </div>
        </ModalRoot>
    );
}
