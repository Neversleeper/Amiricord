/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import { SettingsClient } from "../src/api/settingsClient";
import { PinterestProfileModal } from "../src/testcordplugins/PinterestTool/pinterart/components";
import { bindHost, type HostBindings, unbindHost } from "../src/testcordplugins/PinterestTool/pinterart/host";
import { settings } from "../src/testcordplugins/PinterestTool/settings";
import type { PinterestImageResult, PinterestSearchPayload, SearchOptions } from "../src/testcordplugins/PinterestTool/types";

// A small React of our own, enough to run his screens: state, refs, memo and effects are kept per component position, so a screen that appears or goes away does not
// disturb the others, and a state change draws the whole tree again.

interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }
const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

interface Slot { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown; }

function mount(root: () => unknown) {
    const slots = new Map<string, Slot[]>();
    const effects: Array<() => void> = [];
    let path = "";
    let index = 0;
    let dirty = false;

    const slot = (): Slot => {
        const list = slots.get(path) ?? [];
        slots.set(path, list);
        return (list[index++] ??= {});
    };
    const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => {
            const s = slot();
            if (!("value" in s)) s.value = typeof start === "function" ? (start as () => unknown)() : start;
            return [s.value, (update: unknown) => {
                const next = typeof update === "function" ? (update as (previous: unknown) => unknown)(s.value) : update;
                if (!Object.is(next, s.value)) { s.value = next; dirty = true; }
            }];
        }) as ReactLike["useState"],
        useRef: ((start: unknown) => { const s = slot(); return (s.value ??= { current: start }); }) as ReactLike["useRef"],
        useMemo: ((factory: () => unknown, deps: readonly unknown[]) => {
            const s = slot();
            if (!same(s.deps, deps)) { s.value = factory(); s.deps = deps; }
            return s.value;
        }) as ReactLike["useMemo"],
        useEffect: (run, deps) => {
            const s = slot();
            if (same(s.deps, deps)) return;
            s.deps = deps;
            effects.push(() => { if (typeof s.cleanup === "function") (s.cleanup as () => void)(); s.cleanup = run(); });
        },
        useLayoutEffect: (run, deps) => { react.useEffect(run, deps); },
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    };
    setReactSource(() => react);

    function walk(node: unknown, where: string): unknown {
        if (Array.isArray(node)) return node.map((child, i) => walk(child, `${where}[${i}]`));
        if (!isEl(node)) return node;
        const key = node.props.key === undefined ? "" : `#${String(node.props.key)}`;
        const here = `${where}/${typeof node.type === "function" ? node.type.name : String(node.type)}${key}`;
        if (typeof node.type === "function") {
            const children = node.children.length <= 1 ? node.children[0] : node.children;
            path = here;
            index = 0;
            const out = (node.type as (props: unknown) => unknown)({ ...node.props, ...(children === undefined ? {} : { children }) });
            return walk(out, here);
        }
        const kids = node.children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined);
        return { ...node, children: kids.map((child, i) => walk(child, `${here}.${i}`)) };
    }

    let tree: unknown;
    const draw = () => { tree = walk({ type: function Root() { return root(); }, props: {}, children: [] }, ""); };
    draw();

    /** Run the effects and the redraws until nothing changes, letting promises finish in between. */
    async function settle() {
        for (let round = 0; round < 30; round++) {
            while (effects.length) effects.shift()!();
            for (let wait = 0; wait < 5; wait++) await Promise.resolve();
            await new Promise(resolve => setImmediate(resolve));
            if (!dirty && !effects.length) return;
            dirty = false;
            draw();
        }
        throw new Error("the screen never settled");
    }

    return { get tree() { return tree; }, settle };
}

function findAll(node: unknown, test: (el: El) => boolean, found: El[] = []): El[] {
    if (!isEl(node)) return found;
    if (test(node)) found.push(node);
    for (const child of node.children) findAll(child, test, found);
    return found;
}

const textOf = (node: unknown): string => isEl(node) ? node.children.map(textOf).join("|") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const hasClass = (el: El, name: string) => typeof el.props.className === "string" && el.props.className.split(" ").includes(`vc-pinterest-tool-${name}`);
const byClass = (tree: unknown, name: string) => findAll(tree, el => hasClass(el, name));
const byLabel = (tree: unknown, label: string) => findAll(tree, el => el.props["aria-label"] === label);
const call = (el: El, name: string, event: unknown = {}) => (el.props[name] as (event: unknown) => unknown)(event);

const part = (name: string) => (props: Record<string, unknown>): El => ({ type: name, props, children: [props.children].flat() });

const names = ["document", "window", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "FileReader"];
const saved = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const classList = { contains: (name: string) => name === "theme-dark" };

function fakePage() {
    const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    define("requestAnimationFrame", () => 0);
    define("cancelAnimationFrame", () => undefined);
    define("MutationObserver", class { observe() { } disconnect() { } });
    // Just enough of a FileReader to turn a file into a data address.
    define("FileReader", class {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL(file: Blob) { void file.arrayBuffer().then(bytes => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.(); }); }
    });
    Object.defineProperty(globalThis, "document", { value: { documentElement: { classList }, body: { classList }, addEventListener() { }, removeEventListener() { } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "window", { value: { innerWidth: 1280, innerHeight: 800, addEventListener() { }, removeEventListener() { }, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined }, configurable: true, writable: true });
}

const pin = (id: string, extra: Partial<PinterestImageResult> = {}): PinterestImageResult => ({
    id, title: `title ${id}`, description: "", url: `https://i.pinimg.com/originals/${id}.jpg`, thumbUrl: `https://i.pinimg.com/236x/${id}.jpg`, width: 800, height: 800, dominantColor: null, pinterestUrl: `https://www.pinterest.com/pin/${id}/`, isGif: false, ...extra
});

interface Setup { searches: SearchOptions[]; stored: Map<string, unknown>; dispatched: unknown[]; fetched: string[]; host: HostBindings; }

function start(options: { results?: PinterestImageResult[]; settingValues?: Record<string, unknown>; } = {}): Setup {
    fakePage();
    const searches: SearchOptions[] = [];
    const stored = new Map<string, unknown>();
    const dispatched: unknown[] = [];
    const fetched: string[] = [];
    settings.bind(new SettingsClient({ schema: 1, plugins: { PinterestTool: { values: options.settingValues ?? {} } } } as never, () => undefined), "PinterestTool");
    const host: HostBindings = {
        storage: { get: async key => stored.get(key) as never, set: async (key, value) => { stored.set(key, value); }, delete: async () => false, keys: async () => [...stored.keys()] } as never,
        native: {
            warmUp: async () => undefined,
            fetchMedia: async url => { fetched.push(url); return { data: new Uint8Array([1, 2, 3]).buffer, type: "image/png", filename: "pin.png" }; },
            search: async (search: SearchOptions): Promise<PinterestSearchPayload> => { searches.push(search); return { query: search.query, guides: [], results: options.results ?? [], bookmark: null }; }
        } as never,
        dispatch: action => { dispatched.push(action); },
        createPortal: children => children,
        modal: { Root: part("root"), Header: part("header"), Content: part("content"), CloseButton: part("close") },
        report: () => undefined
    };
    bindHost(host);
    return { searches, stored, dispatched, fetched, host };
}

const modal = (props: Record<string, unknown>) => mount(() => PinterestProfileModal({ transitionState: 1, onClose: () => undefined, target: "AVATAR", ...props } as never) as never);

afterEach(() => {
    unbindHost();
    settings.unbind();
    setReactSource(undefined);
    for (const [name, descriptor] of Object.entries(saved)) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
});

describe("the ported window", () => {
    it("opens with his title, tabs, search box and sorting, in his class names", async () => {
        start();
        const screen = modal({});
        await screen.settle();
        const root = findAll(screen.tree, el => el.type === "root")[0];
        assert.ok(hasClass(root, "profile-modal"));
        const text = textOf(screen.tree);
        assert.match(text, /Pinterest Tool/);
        assert.match(text, /Find an icon that feels like you\./);
        for (const tab of ["Images", "GIF", "Favorites"]) assert.ok(text.includes(tab), tab);
        const input = findAll(screen.tree, el => el.type === "input" && el.props.type === "search")[0];
        assert.equal(input.props.placeholder, "Search a character, artist or style…");
        assert.equal(input.props.maxLength, 240);
        assert.equal(byClass(screen.tree, "sort-select")[0].props.value, "relevance");
    });

    it("asks for the banner look when the target is a banner", async () => {
        start();
        const screen = modal({ target: "BANNER" });
        await screen.settle();
        assert.match(textOf(screen.tree), /Give your profile a new view\./);
        assert.ok(byClass(screen.tree, "profile-browser-banner").length > 0);
    });

    it("closes through the close button", async () => {
        start();
        let closed = 0;
        const screen = modal({ onClose: () => { closed++; } });
        await screen.settle();
        call(findAll(screen.tree, el => el.type === "close")[0], "onClick");
        assert.equal(closed, 1);
    });

    it("looks for pictures by itself when it opens and shows them as cards", async () => {
        const setup = start({ results: [pin("a"), pin("b"), pin("c", { isGif: true })] });
        const screen = modal({});
        await screen.settle();
        assert.ok(setup.searches.length >= 1);
        assert.equal(setup.searches[0].target, "AVATAR");
        assert.equal(setup.searches[0].mediaFilter, "STATIC");
        assert.deepEqual(setup.searches[0].bookmarks, []);
        const cards = byClass(screen.tree, "card");
        assert.equal(cards.length, 3);
        assert.deepEqual(cards.map(card => card.props["aria-label"]), ["Select: title a", "Select: title b", "Select: title c"]);
        assert.ok(textOf(screen.tree).includes("GIF"));
    });

    it("searches what was typed when the form is sent, and remembers it", async () => {
        const setup = start({ results: [pin("a")] });
        const screen = modal({ target: "BANNER" });
        await screen.settle();
        const before = setup.searches.length;
        call(findAll(screen.tree, el => el.type === "input" && el.props.type === "search")[0], "onChange", { currentTarget: { value: "  cats  " } });
        await screen.settle();
        let prevented = 0;
        call(byClass(screen.tree, "search-shell")[0], "onSubmit", { preventDefault: () => { prevented++; } });
        await screen.settle();
        assert.equal(prevented, 1);
        const sent = setup.searches.slice(before);
        assert.ok(sent.length >= 1);
        assert.equal(sent[0].query, "cats");
        assert.equal(sent[0].target, "BANNER");
        assert.equal(sent[0].randomize, false);
        assert.deepEqual(setup.stored.get("PinterestTool_recent_searches_v1"), ["cats"]);
    });

    it("shows each card's picture from a blob address fetched by the main process, never from Pinterest directly", async () => {
        const setup = start({ results: [pin("a"), pin("b", { thumbUrl: undefined, isGif: true, url: "https://i.pinimg.com/originals/b.gif" })] });
        const screen = modal({});
        await screen.settle();
        const images = findAll(screen.tree, el => el.type === "img" && String(el.props.alt).startsWith("title"));
        assert.equal(images.length, 2);
        for (const image of images) assert.match(String(image.props.src), /^blob:/);
        assert.notEqual(images[0].props.src, images[1].props.src);
        assert.deepEqual([...setup.fetched].sort(), ["https://i.pinimg.com/236x/a.jpg", "https://i.pinimg.com/originals/b.gif"]);
    });

    it("shows a plain box when the browser cannot draw a picture it was given", async () => {
        start({ results: [pin("a")] });
        const screen = modal({});
        await screen.settle();
        call(findAll(screen.tree, el => el.type === "img" && String(el.props.alt).startsWith("title"))[0], "onError");
        await screen.settle();
        assert.ok(textOf(screen.tree).includes("Preview unavailable"));
        assert.equal(findAll(screen.tree, el => el.type === "img" && String(el.props.alt).startsWith("title")).length, 0);
    });

    it("shows a plain box when a picture cannot be had", async () => {
        const setup = start({ results: [pin("a", { fallbackUrl: "https://i.pinimg.com/736x/a.jpg" })] });
        setup.host.native.fetchMedia = async url => { setup.fetched.push(url); throw new Error("no"); };
        const screen = modal({});
        await screen.settle();
        assert.ok(textOf(screen.tree).includes("Preview unavailable"));
        assert.deepEqual(setup.fetched, ["https://i.pinimg.com/236x/a.jpg", "https://i.pinimg.com/736x/a.jpg"], "the stored smaller copy is tried second");
    });

    it("saves a picture as a favourite from the heart and lists it in Favorites", async () => {
        const setup = start({ results: [pin("a")] });
        const screen = modal({});
        await screen.settle();
        call(byLabel(screen.tree, "Save to favorites")[0], "onClick", { stopPropagation: () => undefined });
        await screen.settle();
        const keys = [...setup.stored.keys()].filter(key => key.startsWith("PinterestTool_favorites_avatar"));
        assert.equal(keys.length, 1);
        assert.equal((setup.stored.get(keys[0]) as Array<{ id: string; }>)[0].id, "a");
        assert.equal(byLabel(screen.tree, "Remove from favorites").length, 1);
    });

    it("hands the picked picture to Discord's editor, then closes when it was applied", async () => {
        const setup = start({ results: [pin("a")], settingValues: { effectsStep: false } });
        let closed = 0;
        const files: File[] = [];
        const screen = modal({ onClose: () => { closed++; }, onEditFile: async (file: File, onApplyStart?: () => void) => { files.push(file); onApplyStart?.(); return "APPLIED"; } });
        await screen.settle();
        call(byClass(screen.tree, "card")[0], "onClick");
        await screen.settle();
        assert.deepEqual(setup.fetched.filter(url => url.includes("originals")), ["https://i.pinimg.com/originals/a.jpg"]);
        assert.equal(files.length, 1);
        assert.equal(files[0].name, "pin.png");
        assert.equal(files[0].type, "image/png");
        assert.equal(closed, 1);
    });

    it("keeps the window open when the person cancels Discord's editor", async () => {
        const setup = start({ results: [pin("a")], settingValues: { effectsStep: false } });
        let closed = 0;
        const screen = modal({ onClose: () => { closed++; }, onEditFile: async () => "CANCELLED" });
        await screen.settle();
        call(byClass(screen.tree, "card")[0], "onClick");
        await screen.settle();
        assert.equal(setup.fetched.filter(url => url.includes("originals")).length, 1);
        assert.equal(closed, 0);
    });

    it("sets the pending avatar straight into Discord's profile editor when there is no dialog to hand over to", async () => {
        const setup = start({ results: [pin("a")], settingValues: { effectsStep: false } });
        const screen = modal({});
        await screen.settle();
        call(byClass(screen.tree, "card")[0], "onClick");
        await screen.settle();
        assert.equal(setup.dispatched.length, 1);
        const action = setup.dispatched[0] as { type: string; pendingAvatar: { assetOrigin: string; imageUri: string; description: string; }; };
        assert.equal(action.type, "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES");
        assert.equal(action.pendingAvatar.assetOrigin, "NEW_ASSET");
        assert.equal(action.pendingAvatar.imageUri, "data:image/png;base64,AQID");
        assert.equal(action.pendingAvatar.description, "pinterest-pin.png");
    });

    it("sets a pending banner when the target is a banner", async () => {
        const setup = start({ results: [pin("a")], settingValues: { effectsStep: false } });
        const screen = modal({ target: "BANNER" });
        await screen.settle();
        call(byClass(screen.tree, "card")[0], "onClick");
        await screen.settle();
        const action = setup.dispatched[0] as { pendingBanner?: unknown; pendingAvatar?: unknown; };
        assert.ok(action.pendingBanner);
        assert.equal(action.pendingAvatar, undefined);
    });
});
