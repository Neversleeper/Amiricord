/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import type { EnginePluginContext } from "../src/renderer/engine";
import { FILTER_OPTIONS, KIND_LABEL, KIND_OPTIONS, PinterestWindow, statusLine, type WindowParts } from "../src/testcordplugins/PinterestTool/PinterestWindow";
import { getPinterestFullStyle } from "../src/testcordplugins/PinterestTool/theme";
import { ThumbLoader } from "../src/testcordplugins/PinterestTool/thumbs";
import type { MediaResult, PinterestImageResult, PinterestSearchPayload } from "../src/testcordplugins/PinterestTool/types";
import { createWindowOpener, isOpenShortcut } from "../src/testcordplugins/PinterestTool/window";
import { type SessionLibrary, type SessionState, WindowSession } from "../src/testcordplugins/PinterestTool/windowSession";
import { WINDOW_CSS } from "../src/testcordplugins/PinterestTool/windowStyles";

interface El { type: unknown; props: Record<string, any>; children: unknown[]; } // eslint-disable-line @typescript-eslint/no-explicit-any

const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

function fakeReact(states: unknown[] = [], effects: Array<() => unknown> = []) {
    const queue = [...states];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => [queue.length ? queue.shift() : typeof start === "function" ? (start as () => unknown)() : start, () => undefined]) as ReactLike["useState"],
        useEffect: run => { effects.push(run); },
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    };
    return react;
}

function render(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(render);
    if (!isEl(node)) return node;
    if (typeof node.type === "function") {
        const children = node.children.length <= 1 ? node.children[0] : node.children;
        return render((node.type as (props: unknown) => unknown)({ ...node.props, ...(children === undefined ? {} : { children }) }));
    }
    return { ...node, children: node.children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined).map(render) };
}

function findAll(node: unknown, test: (el: El) => boolean, found: El[] = []): El[] {
    if (!isEl(node)) return found;
    if (test(node)) found.push(node);
    for (const child of node.children) findAll(child, test, found);
    return found;
}

const textOf = (node: unknown): string => isEl(node) ? node.children.map(textOf).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const byClass = (tree: unknown, name: string) => findAll(tree, el => typeof el.props.className === "string" && el.props.className.split(" ").includes(name));
const byLabel = (tree: unknown, label: string) => findAll(tree, el => el.props["aria-label"] === label);

afterEach(() => { setReactSource(undefined); });

const pin = (id: string, extra: Partial<PinterestImageResult> = {}): PinterestImageResult => ({ id, title: `title ${id}`, description: "", url: `https://i.pinimg.com/originals/${id}.jpg`, width: 10, height: 10, dominantColor: null, pinterestUrl: null, isGif: false, ...extra });

function frame(): WindowParts {
    const part = (name: string) => ({ children }: { children?: unknown; size?: string; label?: string; onClose?(): void; onClick?(): void; }) => ({ type: name, props: {}, children: [children].flat() } satisfies El);
    return { ModalRoot: part("Root") as never, ModalHeader: part("Header") as never, ModalContent: part("Content") as never, ModalFooter: part("Footer") as never, ModalCloseButton: part("Close") as never };
}

function fakeLibrary(): SessionLibrary {
    return { favourites: async () => [], addFavourite: async () => "added", removeFavourite: async () => true, recent: async () => [], rememberSearch: async () => [], clearRecent: async () => undefined };
}

function setup(results: PinterestImageResult[] = [], search: (o: unknown) => Promise<PinterestSearchPayload> = async () => ({ query: "q", guides: [], results, bookmark: null })) {
    const session = new WindowSession({ search: search as never, library: fakeLibrary(), randomize: () => false });
    const thumbs = new ThumbLoader({ fetchMedia: async () => ({ data: new ArrayBuffer(1), type: "image/png", filename: "x" }) as MediaResult, createUrl: () => "blob:x", revokeUrl: () => undefined });
    return { session, thumbs };
}

const win = (session: WindowSession, thumbs: ThumbLoader, style: () => Record<string, string> = () => ({}), onClose: () => void = () => undefined): El => ({ type: PinterestWindow, props: { session, thumbs, parts: frame(), style, onClose }, children: [] });

function draw(session: WindowSession, thumbs: ThumbLoader, options: { states?: unknown[]; effects?: Array<() => unknown>; onClose?(): void; style?(): Record<string, string>; } = {}) {
    const once = fakeReact(options.states, options.effects);
    setReactSource(() => once);
    return render(win(session, thumbs, options.style ?? (() => ({ "--pt-bg": "#111" })), options.onClose));
}

describe("Pinterest Tool window: the screen", () => {
    it("draws the frame, the title, the two tabs, the search controls and a first hint", () => {
        const { session, thumbs } = setup();
        const tree = draw(session, thumbs);
        assert.equal(findAll(tree, el => el.type === "Root").length, 1);
        assert.equal(textOf(byClass(tree, "pt-title")[0]), "Pinterest Tool");
        const tabs = findAll(tree, el => el.props.role === "tab");
        assert.deepEqual(tabs.map(textOf), ["Search", "Favourites"]);
        assert.deepEqual(tabs.map(tab => tab.props["aria-selected"]), ["true", "false"]);
        assert.equal(byLabel(tree, "Search Pinterest").length, 1);
        assert.equal(byLabel(tree, "What to look for").length, 1);
        assert.equal(byLabel(tree, "Images or GIFs").length, 1);
        assert.equal(textOf(findAll(tree, el => el.props.role === "status")[0]), "Type what you are looking for and press Enter.");
        assert.equal(findAll(tree, el => el.type === "Close").length, 1);
    });

    it("applies the theme variables to the window and asks for them at every draw", () => {
        const { session, thumbs } = setup();
        let asked = 0;
        const tree = draw(session, thumbs, { style: () => { asked++; return { "--pt-bg": "#abc" }; } });
        assert.deepEqual(byClass(tree, "pt-window")[0].props.style, { "--pt-bg": "#abc" });
        assert.equal(asked, 1);
    });

    it("passes the size, the label and the close handler to the frame", () => {
        const { session, thumbs } = setup();
        setReactSource(() => fakeReact());
        let closed = 0;
        const tree = PinterestWindow({ session, thumbs, parts: frame(), style: () => ({}), onClose: () => { closed++; } }) as unknown as El;
        assert.equal(tree.props.size, "large");
        assert.equal(tree.props.label, "Pinterest Tool");
        tree.props.onClose();
        assert.equal(closed, 1);
    });

    it("loads what is saved when it opens, once", () => {
        const { session, thumbs } = setup();
        const effects: Array<() => unknown> = [];
        let inits = 0;
        const original = session.init.bind(session);
        session.init = async () => { inits++; await original(); };
        draw(session, thumbs, { effects });
        effects.forEach(run => run());
        assert.equal(inits, 1);
    });

    it("the Enter key and the Search button start a search with what was typed; the button waits for a text", () => {
        const { session, thumbs } = setup();
        const searched: string[] = [];
        session.search = async query => { searched.push(query); };
        const tree = draw(session, thumbs, { states: ["cute cats"] });
        const input = byLabel(tree, "Search Pinterest")[0];
        assert.equal(input.props.value, "cute cats");
        input.props.onKeyDown({ key: "a" });
        assert.deepEqual(searched, []);
        input.props.onKeyDown({ key: "Enter" });
        const button = findAll(tree, el => el.type === "button" && textOf(el) === "Search" && el.props.role !== "tab")[0];
        assert.equal(button.props.disabled, false);
        button.props.onClick();
        assert.deepEqual(searched, ["cute cats", "cute cats"]);
        const empty = draw(session, thumbs, { states: ["   "] });
        assert.equal(findAll(empty, el => el.type === "button" && textOf(el) === "Search" && el.props.role !== "tab")[0].props.disabled, true);
        (session as unknown as { current: SessionState; }).current = { ...session.state, status: "loading" };
        const busy = draw(session, thumbs, { states: ["cats"] });
        assert.equal(findAll(busy, el => el.type === "button" && textOf(el) === "Search" && el.props.role !== "tab")[0].props.disabled, true, "not while a search is on its way");
        assert.equal(byLabel(busy, "Search Pinterest")[0].props.maxLength, 120);
    });

    it("typing sets the text", () => {
        const { session, thumbs } = setup();
        const set: unknown[] = [];
        setReactSource(() => ({ ...fakeReact(), useState: ((start: unknown) => [start, (value: unknown) => { set.push(value); }]) as ReactLike["useState"] }));
        const tree = render(win(session, thumbs));
        byLabel(tree, "Search Pinterest")[0].props.onChange({ target: { value: "dogs" } });
        assert.deepEqual(set, ["dogs"]);
    });

    it("lists the kinds and the filters, and the selects change the session", () => {
        const { session, thumbs } = setup();
        const tree = draw(session, thumbs);
        const kind = byLabel(tree, "What to look for")[0];
        const filter = byLabel(tree, "Images or GIFs")[0];
        assert.deepEqual(findAll(kind, el => el.type === "option").map(textOf), KIND_OPTIONS.map(option => option.label));
        assert.deepEqual(findAll(filter, el => el.type === "option").map(textOf), FILTER_OPTIONS.map(option => option.label));
        kind.props.onChange({ target: { value: "BANNER" } });
        filter.props.onChange({ target: { value: "GIFS" } });
        assert.equal(session.state.kind, "BANNER");
        assert.equal(session.state.filter, "GIFS");
    });

    it("shows the cards, one heart each for icons, and two for any image", async () => {
        const { session, thumbs } = setup([pin("a"), pin("b", { isGif: true })]);
        await session.search("x");
        const tree = draw(session, thumbs);
        const cards = byClass(tree, "pt-card");
        assert.deepEqual(cards.map(card => card.props["data-id"]), ["a", "b"]);
        assert.equal(byClass(cards[0], "pt-heart").length, 1);
        assert.equal(byClass(cards[0], "pt-badge").length, 0);
        assert.equal(textOf(byClass(cards[1], "pt-badge")[0]), "GIF");
        session.setKind("IMAGE");
        await new Promise(resolve => setImmediate(resolve));
        const both = draw(session, thumbs);
        assert.deepEqual(byClass(byClass(both, "pt-card")[0], "pt-heart").map(textOf), [`♡ ${KIND_LABEL.AVATAR}`, `♡ ${KIND_LABEL.BANNER}`]);
    });

    it("uses the banner shape for banners and the square one otherwise", async () => {
        const { session, thumbs } = setup([pin("a")]);
        await session.search("x");
        assert.equal(byClass(draw(session, thumbs), "pt-grid-banner").length, 0);
        session.setKind("BANNER");
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(byClass(draw(session, thumbs), "pt-grid-banner").length, 1);
    });

    it("the heart saves, says whether the card is saved, and has a name for screen readers", async () => {
        const { session, thumbs } = setup([pin("a")]);
        await session.search("x");
        const toggled: string[] = [];
        session.toggleFavourite = async (result, kind) => { toggled.push(`${kind}:${result.id}`); };
        const tree = draw(session, thumbs);
        const heart = byClass(tree, "pt-heart")[0];
        assert.equal(heart.props["aria-pressed"], "false");
        assert.equal(heart.props["aria-label"], "Save to favourite icons: title a");
        assert.equal(textOf(heart), "♡ Save");
        heart.props.onClick();
        assert.deepEqual(toggled, ["AVATAR:a"]);
    });

    it("a saved card shows a filled heart", async () => {
        const { session, thumbs } = setup([pin("a")]);
        await session.search("x");
        (session as unknown as { current: SessionState; }).current = { ...session.state, saved: { AVATAR: new Set(["a"]), BANNER: new Set() } };
        const heart = byClass(draw(session, thumbs), "pt-heart")[0];
        assert.equal(heart.props["aria-pressed"], "true");
        assert.match(heart.props.className, /pt-heart-on/);
        assert.equal(textOf(heart), "♥ Saved");
        assert.equal(heart.props["aria-label"], "Remove from favourite icons: title a");
    });

    it("a card asks for its picture, shows it when it comes, and gives it back when it leaves", () => {
        const { session, thumbs } = setup();
        const asked: string[] = [];
        let cancelled = 0;
        thumbs.request = (url, done) => { asked.push(url); done("blob:ready"); return () => { cancelled++; }; };
        const effects: Array<() => unknown> = [];
        (session as unknown as { current: SessionState; }).current = { ...session.state, results: [pin("a", { thumbUrl: "https://i.pinimg.com/236x/a.jpg" })] };
        const once = fakeReact(["", "blob:ready"], effects);
        setReactSource(() => once);
        const tree = render(win(session, thumbs));
        effects.forEach(run => run());
        const cleanup = effects.map(run => run()).find(Boolean) as (() => void) | undefined;
        assert.ok(asked.includes("https://i.pinimg.com/236x/a.jpg"), "the thumbnail address is preferred");
        const img = findAll(tree, el => el.type === "img")[0];
        assert.equal(img.props.src, "blob:ready");
        assert.equal(img.props.alt, "title a");
        assert.equal(img.props.draggable, "false");
        cleanup?.();
        assert.equal(cancelled >= 1, true);
    });

    it("falls back to the description when a card has no title", () => {
        const { session, thumbs } = setup();
        thumbs.request = () => () => undefined;
        (session as unknown as { current: SessionState; }).current = { ...session.state, results: [pin("a", { title: "", description: "a cute cat" })] };
        const effects: Array<() => unknown> = [];
        const once = fakeReact(["", null], effects);
        setReactSource(() => once);
        assert.equal(textOf(byClass(render(win(session, thumbs)), "pt-card-title")[0]), "a cute cat");
    });

    it("the hearts in the favourites tab save under the kind being shown", () => {
        const { session, thumbs } = setup();
        thumbs.request = () => () => undefined;
        (session as unknown as { current: SessionState; }).current = { ...session.state, tab: "favourites", favouriteKind: "BANNER", favourites: [{ ...pin("f"), target: "BANNER", savedAt: 1 } as never] };
        const toggled: string[] = [];
        session.toggleFavourite = async (result, kind) => { toggled.push(`${kind}:${result.id}`); };
        const heart = byClass(draw(session, thumbs), "pt-heart")[0];
        assert.match(heart.props["aria-label"], /favourite banners/);
        heart.props.onClick();
        assert.deepEqual(toggled, ["BANNER:f"]);
    });

    it("uses the full address when there is no thumbnail, a plain box while it loads, and a name for untitled cards", () => {
        const { session, thumbs } = setup();
        const asked: string[] = [];
        thumbs.request = url => { asked.push(url); return () => undefined; };
        (session as unknown as { current: SessionState; }).current = { ...session.state, results: [pin("a", { title: "", description: "" })] };
        const effects: Array<() => unknown> = [];
        const once = fakeReact(["", null], effects);
        setReactSource(() => once);
        const tree = render(win(session, thumbs));
        effects.forEach(run => run());
        assert.deepEqual(asked, ["https://i.pinimg.com/originals/a.jpg"]);
        assert.equal(findAll(tree, el => el.type === "img").length, 0);
        assert.equal(textOf(byClass(tree, "pt-card-title")[0]), "Untitled");
    });

    it("offers Load more only when idle with a next page, and Try again only on an error", async () => {
        const { session, thumbs } = setup();
        const loadMore = (tree: unknown) => findAll(tree, el => el.type === "button" && textOf(el) === "Load more");
        const retry = (tree: unknown) => findAll(tree, el => el.type === "button" && textOf(el) === "Try again");
        const base = session.state;
        const put = (patch: Partial<SessionState>) => { (session as unknown as { current: SessionState; }).current = { ...base, ...patch }; };
        put({ searched: true, results: [pin("a")], hasMore: true, status: "idle" });
        assert.equal(loadMore(draw(session, thumbs)).length, 1);
        assert.equal(retry(draw(session, thumbs)).length, 0);
        put({ searched: true, results: [pin("a")], hasMore: true, status: "loading-more" });
        assert.equal(loadMore(draw(session, thumbs)).length, 0);
        put({ searched: true, results: [pin("a")], hasMore: false, status: "idle" });
        assert.equal(loadMore(draw(session, thumbs)).length, 0);
        put({ searched: true, results: [], hasMore: false, status: "error", error: "down" });
        const failed = draw(session, thumbs);
        assert.equal(retry(failed).length, 1);
        assert.equal(byClass(failed, "pt-error").length, 1);
        let again = 0;
        session.retry = async () => { again++; };
        retry(failed)[0].props.onClick();
        assert.equal(again, 1);
        let more = 0;
        session.loadMore = async () => { more++; };
        put({ searched: true, results: [pin("a")], hasMore: true, status: "idle" });
        loadMore(draw(session, thumbs))[0].props.onClick();
        assert.equal(more, 1);
    });

    it("shows recent searches only while the box is empty, and Clear", () => {
        const { session, thumbs } = setup();
        const base = session.state;
        (session as unknown as { current: SessionState; }).current = { ...base, recent: ["cats", "dogs"] };
        const searched: string[] = [];
        session.search = async query => { searched.push(query); };
        const tree = draw(session, thumbs);
        const chips = byClass(tree, "pt-chip");
        assert.deepEqual(chips.map(textOf), ["cats", "dogs", "Clear"]);
        const typed: unknown[] = [];
        setReactSource(() => ({ ...fakeReact(), useState: ((start: unknown) => [start, (value: unknown) => { typed.push(value); }]) as ReactLike["useState"] }));
        const again = byClass(render(win(session, thumbs)), "pt-chip");
        again[1].props.onClick();
        assert.deepEqual(typed, ["dogs"], "the box shows what was searched");
        chips[1].props.onClick();
        assert.deepEqual(searched, ["dogs", "dogs"]);
        let cleared = 0;
        session.clearRecent = async () => { cleared++; };
        chips[2].props.onClick();
        assert.equal(cleared, 1);
        assert.equal(byClass(draw(session, thumbs, { states: ["typing"] }), "pt-chip").length, 0);
        (session as unknown as { current: SessionState; }).current = { ...base, recent: [] };
        assert.equal(byClass(draw(session, thumbs), "pt-chip").length, 0);
    });

    it("shows Pinterest's suggestions and searches the one that is pressed", () => {
        const { session, thumbs } = setup();
        (session as unknown as { current: SessionState; }).current = { ...session.state, guides: [{ label: "Aesthetic", query: "cats aesthetic" }] };
        const searched: string[] = [];
        session.search = async query => { searched.push(query); };
        const chip = byClass(draw(session, thumbs), "pt-chip")[0];
        assert.equal(textOf(chip), "Aesthetic");
        chip.props.onClick();
        assert.deepEqual(searched, ["cats aesthetic"]);
    });

    it("the Favourites tab lists what is saved, can switch kind, and says when there is nothing", () => {
        const { session, thumbs } = setup();
        const base = session.state;
        const put = (patch: Partial<SessionState>) => { (session as unknown as { current: SessionState; }).current = { ...base, tab: "favourites", ...patch }; };
        put({});
        const empty = draw(session, thumbs);
        assert.match(textOf(findAll(empty, el => el.props.role === "status")[0]), /Nothing saved yet/);
        assert.equal(byClass(empty, "pt-card").length, 0);
        assert.equal(byLabel(empty, "Search Pinterest").length, 0);
        put({ favourites: [{ ...pin("f"), target: "AVATAR", savedAt: 1 } as never], favouriteKind: "BANNER" });
        const filled = draw(session, thumbs);
        assert.equal(byClass(filled, "pt-card").length, 1);
        assert.equal(byClass(filled, "pt-grid-banner").length, 1);
        assert.equal(textOf(byClass(filled, "pt-muted")[0]), "1 saved");
        let kind = "";
        session.setFavouriteKind = async value => { kind = value; };
        byLabel(filled, "Which favourites")[0].props.onChange({ target: { value: "AVATAR" } });
        assert.equal(kind, "AVATAR");
        assert.deepEqual(findAll(filled, el => el.props.role === "tab").map(tab => tab.props["aria-selected"]), ["false", "true"]);
    });

    it("the tabs change the session's tab", () => {
        const { session, thumbs } = setup();
        const tabs = findAll(draw(session, thumbs), el => el.props.role === "tab");
        tabs[1].props.onClick();
        assert.equal(session.state.tab, "favourites");
        tabs[0].props.onClick();
        assert.equal(session.state.tab, "search");
    });

    it("shows the last note in the footer", () => {
        const { session, thumbs } = setup();
        (session as unknown as { current: SessionState; }).current = { ...session.state, notice: "Saved to your favourites" };
        assert.equal(textOf(byClass(draw(session, thumbs), "pt-notice")[0]), "Saved to your favourites");
        (session as unknown as { current: SessionState; }).current = { ...session.state, notice: null };
        assert.equal(textOf(byClass(draw(session, thumbs), "pt-notice")[0]), "");
    });
});

describe("Pinterest Tool window: the line under the search", () => {
    const base = { status: "idle", searched: true, results: [pin("a")], query: "cats", error: null, hasMore: true } satisfies Parameters<typeof statusLine>[0];
    it("says what is going on", () => {
        assert.equal(statusLine({ ...base, status: "loading" as const }), "Searching…");
        assert.equal(statusLine({ ...base, status: "loading-more" }), "Loading more…");
        assert.equal(statusLine({ ...base, status: "error", error: "down" }), "down");
        assert.equal(statusLine({ ...base, status: "error", error: null }), "The search failed.");
        assert.equal(statusLine({ ...base, searched: false }), "Type what you are looking for and press Enter.");
        assert.equal(statusLine({ ...base, results: [] }), "Nothing found for “cats”. Try other words.");
        assert.equal(statusLine(base), "1 result");
        assert.equal(statusLine({ ...base, results: [pin("a"), pin("b")], hasMore: false }), "2 results (that is all there is)");
    });
});

describe("Pinterest Tool window: the CSS", () => {
    it("has a rule for every pt- class the screen uses", () => {
        const { session, thumbs } = setup([pin("a", { isGif: true })]);
        (session as unknown as { current: SessionState; }).current = { ...session.state, searched: true, results: [pin("a", { isGif: true })], hasMore: true, recent: ["x"], guides: [{ label: "g", query: "g" }], notice: "n", status: "error", error: "e", kind: "BANNER" };
        const used = new Set<string>();
        const walk = (node: unknown) => {
            if (!isEl(node)) return;
            String(node.props.className ?? "").split(" ").filter(name => name.startsWith("pt-")).forEach(name => used.add(name));
            node.children.forEach(walk);
        };
        walk(draw(session, thumbs));
        (session as unknown as { current: SessionState; }).current = { ...session.state, tab: "favourites", favourites: [{ ...pin("f"), target: "AVATAR", savedAt: 1 } as never], status: "idle" };
        walk(draw(session, thumbs));
        used.add("pt-heart-on");
        used.add("pt-tab-on");
        assert.ok(used.size >= 18, `only ${used.size} classes found`);
        for (const name of used) assert.ok(new RegExp(`\\.${name}(?![\\w-])`).test(WINDOW_CSS), `no style for .${name}`);
    });

    it("uses only the theme variables that theme.ts builds", () => {
        const names = new Set([...WINDOW_CSS.matchAll(/var\((--pt-[a-z-]+)\)/g)].map(match => match[1]));
        const known = ["--pt-accent", "--pt-accent-contrast", "--pt-accent-hover", "--pt-accent-text", "--pt-bg", "--pt-border", "--pt-hover", "--pt-input", "--pt-muted", "--pt-raised", "--pt-surface", "--pt-text"];
        for (const name of names) assert.ok(known.includes(name), name);
    });
});

// --- Opening -------------------------------------------------------------------------------------------------------------------------------------------------

describe("Pinterest Tool window: the shortcut", () => {
    const press = (extra: object) => isOpenShortcut({ key: "p", ctrlKey: true, shiftKey: true, ...extra });
    it("is Ctrl+Shift+P, in either letter case, and nothing close to it", () => {
        assert.equal(press({}), true);
        assert.equal(isOpenShortcut({ key: "P", ctrlKey: true, shiftKey: true }), true);
        assert.equal(press({ ctrlKey: false }), false);
        assert.equal(press({ shiftKey: false }), false);
        assert.equal(press({ altKey: true }), false);
        assert.equal(press({ metaKey: true }), false);
        assert.equal(press({ repeat: true }), false);
        assert.equal(isOpenShortcut({ key: "o", ctrlKey: true, shiftKey: true }), false);
        assert.equal(isOpenShortcut({ key: "p" }), false);
    });
});

/** The window sits inside an error boundary: its first child is the window itself. */
const windowOf = (node: unknown) => (node as El).children[0] as El;

function fakeContext(options: { opens?: boolean; parts?: boolean; } = {}) {
    const opened: Array<{ render: (props: { onClose(): void; transitionState: number; }) => unknown; options?: { onCloseCallback?(): void; }; }> = [];
    const closed: string[] = [];
    const styles: Array<[string, string | undefined]> = [];
    const reported: Array<[string, unknown]> = [];
    let nextKey = 0;
    const part = (name: string) => ({ get: () => (options.parts === false ? undefined : name), usingFallback: () => true, name });
    const ctx = {
        modals: {
            open: (render: never, modalOptions: never) => { if (options.opens === false) return undefined; opened.push({ render, options: modalOptions }); return `k${++nextKey}`; },
            close: (key: string) => { closed.push(key); },
            closeAll: () => undefined
        },
        components: { ModalRoot: part("Root"), ModalHeader: part("Header"), ModalContent: part("Content"), ModalFooter: part("Footer"), ModalCloseButton: part("Close") },
        native: { call: async () => ({}) },
        storage: { get: async () => undefined, set: async () => undefined, delete: async () => undefined, keys: async () => [] },
        addStyle: (css: string, name?: string) => { styles.push([css, name]); return { update: () => undefined, remove: () => undefined }; },
        reportError: (source: string, error: unknown) => { reported.push([source, error]); }
    } as unknown as EnginePluginContext;
    return { ctx, opened, closed, styles, reported };
}

function fakePage() {
    const listeners = new Set<(event: { key: string; ctrlKey?: boolean; shiftKey?: boolean; preventDefault?(): void; }) => void>();
    return {
        page: {
            addEventListener: (_type: "keydown", listener: never) => { listeners.add(listener); },
            removeEventListener: (_type: "keydown", listener: never) => { listeners.delete(listener); },
            documentElement: { classList: { contains: (name: string) => name === "theme-light" } }
        },
        listeners,
        press: (event: { key: string; ctrlKey?: boolean; shiftKey?: boolean; }) => {
            let prevented = false;
            for (const listener of [...listeners]) listener({ ...event, preventDefault: () => { prevented = true; } });
            return prevented;
        }
    };
}

describe("Pinterest Tool window: opening", () => {
    it("opens on the shortcut, once, adding its CSS, and swallows that key press", () => {
        const { ctx, opened, styles } = fakeContext();
        const { page, press } = fakePage();
        createWindowOpener(ctx, page as never);
        assert.equal(press({ key: "x", ctrlKey: true, shiftKey: true }), false);
        assert.equal(opened.length, 0);
        assert.equal(press({ key: "p", ctrlKey: true, shiftKey: true }), true);
        assert.equal(opened.length, 1);
        press({ key: "p", ctrlKey: true, shiftKey: true });
        assert.equal(opened.length, 1, "already open");
        assert.deepEqual(styles, [[WINDOW_CSS, "window"]]);
    });

    it("draws the window with the plugin's own parts when Discord asks for it, and its close button closes it", () => {
        const { ctx, opened } = fakeContext();
        const opener = createWindowOpener(ctx, undefined);
        opener.open();
        setReactSource(() => fakeReact());
        let closed = 0;
        const element = windowOf(opened[0].render({ transitionState: 1, onClose: () => { closed++; } }));
        assert.equal(element.type, PinterestWindow);
        assert.equal(element.props.parts.ModalRoot, "Root");
        element.props.onClose();
        assert.equal(closed, 1);
        assert.equal(typeof element.props.style(), "object");
        assert.ok(element.props.style()["--pt-accent"], "the theme gives an accent");
    });

    it("the style is the theme's own for light or dark, following Discord's look when the setting is Auto", () => {
        setReactSource(() => fakeReact());
        const light = fakeContext();
        createWindowOpener(light.ctx, fakePage().page as never).open();
        const darkPage = fakePage();
        (darkPage.page.documentElement.classList as { contains(name: string): boolean; }).contains = () => false;
        const dark = fakeContext();
        createWindowOpener(dark.ctx, darkPage.page as never).open();
        const styleOf = (opened: typeof light.opened) => windowOf(opened[0].render({ transitionState: 1, onClose: () => undefined })).props.style();
        assert.deepEqual(styleOf(light.opened), getPinterestFullStyle("pinterest", "#f59e0b", "light", true));
        assert.deepEqual(styleOf(dark.opened), getPinterestFullStyle("pinterest", "#f59e0b", "dark", true));
    });

    it("draws the window inside an error boundary that reports to the health report, so a failure does not take Discord's page down", () => {
        class Base { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState() { /* not needed */ } }
        setReactSource(() => ({ ...fakeReact(), Component: Base }));
        const { ctx, opened, reported } = fakeContext();
        createWindowOpener(ctx, undefined).open();
        const boundary = opened[0].render({ transitionState: 1, onClose: () => undefined }) as El;
        assert.equal(boundary.props.label, "Pinterest Tool");
        assert.equal((boundary.children[0] as El).type, PinterestWindow);
        const Class = boundary.type as new (props: unknown) => { componentDidCatch(error: unknown): void; render(): unknown; state: { failed: boolean; }; };
        const instance = new Class(boundary.props);
        const failure = new Error("window broke");
        instance.componentDidCatch(failure);
        assert.deepEqual(reported, [["Pinterest Tool", failure]]);
        assert.deepEqual((Class as unknown as { getDerivedStateFromError(error: unknown): { failed: boolean; message: string; }; }).getDerivedStateFromError(failure), { failed: true, message: "window broke" });
        const again = windowOf(opened[0].render({ transitionState: 1, onClose: () => undefined }));
        assert.equal(again.type, PinterestWindow);
        assert.equal(boundary.type, (opened[0].render({ transitionState: 1, onClose: () => undefined }) as El).type, "the same boundary on every draw, so the window is not rebuilt");
    });

    it("the style follows light or dark from Discord's page", () => {
        setReactSource(() => fakeReact());
        const { ctx, opened } = fakeContext();
        const light = fakePage();
        createWindowOpener(ctx, light.page as never).open();
        const dark = fakePage();
        (dark.page.documentElement.classList as { contains(name: string): boolean; }).contains = () => false;
        const second = fakeContext();
        createWindowOpener(second.ctx, dark.page as never).open();
        const first = windowOf(opened[0].render({ transitionState: 1, onClose: () => undefined })).props.style();
        const other = windowOf(second.opened[0].render({ transitionState: 1, onClose: () => undefined })).props.style();
        assert.notEqual(first["--pt-bg"], other["--pt-bg"]);
    });

    it("a second open is allowed again after the window closed", () => {
        const { ctx, opened } = fakeContext();
        const opener = createWindowOpener(ctx, undefined);
        opener.open();
        opener.open();
        assert.equal(opened.length, 1);
        opened[0].options!.onCloseCallback!();
        opener.open();
        assert.equal(opened.length, 2);
    });

    it("does nothing, and keeps nothing, when Discord's opener was not found", () => {
        const { ctx, opened } = fakeContext({ opens: false });
        const opener = createWindowOpener(ctx, undefined);
        opener.open();
        opener.open();
        assert.equal(opened.length, 0);
        assert.doesNotThrow(() => { opener.dispose(); });
    });

    it("does nothing when one of the window pieces is missing", () => {
        const { ctx, opened, styles } = fakeContext({ parts: false });
        createWindowOpener(ctx, undefined).open();
        assert.equal(opened.length, 0);
        assert.equal(styles.length, 0);
    });

    it("dispose closes the open window, cleans up and stops listening to the keyboard", () => {
        const { ctx, opened, closed } = fakeContext();
        const { page, press, listeners } = fakePage();
        const opener = createWindowOpener(ctx, page as never);
        opener.open();
        assert.equal(listeners.size, 1);
        opener.dispose();
        assert.deepEqual(closed, ["k1"]);
        assert.equal(listeners.size, 0);
        press({ key: "p", ctrlKey: true, shiftKey: true });
        assert.equal(opened.length, 1);
        opener.dispose();
        assert.deepEqual(closed, ["k1"], "a second dispose closes nothing");
    });

    it("dispose with no window open only stops listening", () => {
        const { ctx, closed } = fakeContext();
        const { page, listeners } = fakePage();
        createWindowOpener(ctx, page as never).dispose();
        assert.equal(listeners.size, 0);
        assert.deepEqual(closed, []);
    });
});
