/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { ReactLike } from "../src/api/common";
import { setReactSource } from "../src/api/jsxRuntime";
import { makeTabsEditor, type TabsEditorDeps } from "../src/plugins/Settings/TabsEditor";

// A tiny stand-in for React (the same idea as in settingsTabs.test.ts): elements are plain objects; useState hands out `initial` values in
// the order the component asks, then the value it was started with, and records every call of a setter.
interface El { type: unknown; props: Record<string, unknown>; children: unknown[]; }

function fakeReact(initial: unknown[] = []) {
    const queue = [...initial];
    const calls: unknown[] = [];
    const react: ReactLike = {
        createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies El),
        Fragment: Symbol("fragment"),
        useState: ((start: unknown) => [queue.length ? queue.shift() : typeof start === "function" ? (start as () => unknown)() : start, (value: unknown) => { calls.push(value); }]) as ReactLike["useState"],
        useEffect: () => undefined,
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        Component: class { props: unknown; state: unknown = {}; constructor(props: unknown) { this.props = props; } setState(next: unknown) { this.state = next; } }
    };
    return { react, calls };
}

const isEl = (value: unknown): value is El => typeof value === "object" && value !== null && "type" in value && "children" in value;

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

const textOf = (node: unknown): string => (typeof node === "string" || typeof node === "number" ? String(node) : isEl(node) ? node.children.map(textOf).join("") : "");
const hasClass = (el: El, name: string) => typeof el.props.className === "string" && el.props.className.split(" ").includes(name);

afterEach(() => { setReactSource(undefined); });

const TABS = [
    { key: "amiricord", title: "Amiricord" },
    { key: "privacy", title: "Privacy & Security" },
    { key: "plugins", title: "Plugins" },
    { key: "themes", title: "Themes" }
];

function editor(opts: { initial?: unknown[]; saved?: string; } = {}) {
    const fake = fakeReact(opts.initial);
    setReactSource(() => fake.react);
    const written: string[] = [];
    const deps: TabsEditorDeps = { title: "Amiricord", tabs: () => TABS, read: () => opts.saved ?? "", write: text => { written.push(text); } };
    const tree = render(makeTabsEditor(deps)()) as El;
    return { tree, written, calls: fake.calls };
}

const EMPTY = () => ({ hidden: [] as string[], order: [] as string[], pinned: [] as string[] });
const chips = (tree: El) => findAll(tree, el => hasClass(el, "amiricord-chip"));
const chipNamed = (tree: El, title: string) => chips(tree).find(chip => textOf(findAll(chip, el => hasClass(el, "amiricord-chip-title"))[0]) === title)!;
const click = (el: El, event: unknown = { stopPropagation() { /* nothing */ }, preventDefault() { /* nothing */ } }) => (el.props.onClick as (e: unknown) => void)(event);

describe("the Settings tabs card (Editor Mode)", () => {
    it("shows only the kicker, the name and the Editor Mode button while it is closed", () => {
        const { tree } = editor();
        assert.equal(textOf(findAll(tree, el => hasClass(el, "amiricord-editor-kicker"))[0]), "Sidebar tabs");
        assert.equal(textOf(findAll(tree, el => el.type === "h2")[0]), "Amiricord");
        const [toggle] = findAll(tree, el => hasClass(el, "amiricord-editor-toggle"));
        assert.equal(textOf(toggle), "Editor Mode");
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-chip")).length, 0);
        assert.equal(findAll(tree, el => hasClass(el, "amiricord-editor-panel")).length, 0);
    });

    it("opens with the button, which then says Done", () => {
        const closed = editor();
        click(findAll(closed.tree, el => hasClass(el, "amiricord-editor-toggle"))[0]);
        assert.ok(closed.calls.includes(true), "asked to open");
        const open = editor({ initial: [true] });
        assert.equal(textOf(findAll(open.tree, el => hasClass(el, "amiricord-editor-toggle"))[0]), "Done");
        assert.equal(findAll(open.tree, el => hasClass(el, "amiricord-editor-panel")).length, 1);
    });

    it("lists every tab as a chip in the original order, the first one locked and the others on", () => {
        const { tree } = editor({ initial: [true] });
        assert.deepEqual(chips(tree).map(chip => textOf(findAll(chip, el => hasClass(el, "amiricord-chip-title"))[0])), TABS.map(tab => tab.title));
        const states = chips(tree).map(chip => textOf(findAll(chip, el => hasClass(el, "amiricord-chip-state"))[0]));
        assert.deepEqual(states, ["Locked", "On", "On", "On"]);
        const locked = chips(tree)[0];
        assert.equal(locked.props.draggable, false);
        assert.equal(findAll(locked, el => hasClass(el, "amiricord-chip-pin")).length, 0, "the locked tab has no Pin button");
        assert.ok(chips(tree).slice(1).every(chip => chip.props.draggable === true));
    });

    it("shows the saved layout: order, pinned and off", () => {
        const saved = JSON.stringify({ hidden: ["themes"], order: ["plugins", "privacy"], pinned: ["privacy"] });
        const { tree } = editor({ initial: [true], saved });
        assert.deepEqual(chips(tree).map(chip => textOf(findAll(chip, el => hasClass(el, "amiricord-chip-title"))[0])), ["Amiricord", "Privacy & Security", "Plugins", "Themes"]);
        assert.equal(textOf(findAll(chipNamed(tree, "Themes"), el => hasClass(el, "amiricord-chip-state"))[0]), "Off");
        assert.equal(textOf(findAll(chipNamed(tree, "Privacy & Security"), el => hasClass(el, "amiricord-chip-pin"))[0]), "Pinned");
        assert.match(textOf(findAll(tree, el => hasClass(el, "amiricord-editor-copy"))[0]), /1 hidden/);
        const preview = textOf(findAll(tree, el => hasClass(el, "amiricord-editor-preview-list"))[0]);
        assert.ok(!preview.includes("Themes"), "a hidden tab is not in the sidebar preview");
        assert.ok(preview.includes("Pinned"));
    });

    it("treats a damaged saved layout as the default one", () => {
        const { tree } = editor({ initial: [true], saved: "{ not json" });
        assert.deepEqual(chips(tree).map(chip => textOf(findAll(chip, el => hasClass(el, "amiricord-chip-state"))[0])), ["Locked", "On", "On", "On"]);
    });

    it("saves the layout when a tab is turned off, and the locked tab does nothing when clicked", () => {
        const { tree, written } = editor({ initial: [true] });
        click(chipNamed(tree, "Plugins"));
        assert.deepEqual(written.map(text => JSON.parse(text)), [{ hidden: ["plugins"], order: [], pinned: [] }]);
        click(chipNamed(tree, "Amiricord"));
        assert.equal(written.length, 1);
    });

    it("pins with the Pin button without also turning the tab off", () => {
        const { tree, written } = editor({ initial: [true] });
        const [pin] = findAll(chipNamed(tree, "Themes"), el => hasClass(el, "amiricord-chip-pin"));
        let stopped = false;
        click(pin, { stopPropagation: () => { stopped = true; }, preventDefault() { /* nothing */ } });
        assert.ok(stopped, "the click does not reach the chip");
        assert.deepEqual(written.map(text => JSON.parse(text)), [{ hidden: [], order: [], pinned: ["themes"] }]);
    });

    it("moves a tab when it is dropped on another, and only while one is being dragged", () => {
        const { tree, written } = editor({ initial: [true, EMPTY(), "themes"] });
        const target = chipNamed(tree, "Privacy & Security");
        let prevented = false;
        (target.props.onDrop as (e: unknown) => void)({ preventDefault: () => { prevented = true; }, stopPropagation() { /* nothing */ } });
        assert.ok(prevented);
        assert.deepEqual(written.map(text => JSON.parse(text).order), [["themes", "privacy", "plugins"]]);

        const idle = editor({ initial: [true] });
        (chipNamed(idle.tree, "Privacy & Security").props.onDrop as (e: unknown) => void)({ preventDefault() { /* nothing */ }, stopPropagation() { /* nothing */ } });
        assert.equal(idle.written.length, 0, "dropping without a drag changes nothing");
    });

    it("never accepts a drop on the locked tab", () => {
        const { tree, written } = editor({ initial: [true, EMPTY(), "themes"] });
        let prevented = false;
        (chipNamed(tree, "Amiricord").props.onDragOver as (e: unknown) => void)({ preventDefault: () => { prevented = true; }, stopPropagation() { /* nothing */ } });
        assert.equal(prevented, false);
        assert.equal(written.length, 0);
    });

    it("has Hide all and Reset to default, and offers Undo after hiding", () => {
        const all = editor({ initial: [true] });
        const [toggleAll] = findAll(all.tree, el => hasClass(el, "amiricord-editor-link") && textOf(el) === "Hide all");
        click(toggleAll);
        assert.deepEqual(JSON.parse(all.written[0]).hidden, ["privacy", "plugins", "themes"]);

        const restore = editor({ initial: [true], saved: JSON.stringify({ hidden: ["themes"], order: ["plugins"], pinned: ["privacy"] }) });
        click(findAll(restore.tree, el => textOf(el) === "Reset to default")[0]);
        assert.deepEqual(JSON.parse(restore.written[0]), { hidden: [], order: [], pinned: [] });

        const back = editor({ initial: [true, { hidden: ["themes"], order: [], pinned: [] }, null, null, { text: "Themes hidden", previous: { hidden: [], order: [], pinned: [] } }], saved: JSON.stringify({ hidden: ["themes"] }) });
        const [undo] = findAll(back.tree, el => hasClass(el, "amiricord-editor-undo"));
        assert.match(textOf(undo), /Themes hidden/);
        click(findAll(undo, el => el.type === "button")[0]);
        assert.deepEqual(JSON.parse(back.written[0]), { hidden: [], order: [], pinned: [] });
    });

    it("says Show all when some tab is off", () => {
        const { tree } = editor({ initial: [true], saved: JSON.stringify({ hidden: ["themes"] }) });
        assert.ok(findAll(tree, el => hasClass(el, "amiricord-editor-link")).some(el => textOf(el) === "Show all"));
    });

    it("hides a tab for the next time Settings opens and says so in its text", () => {
        const { tree } = editor({ initial: [true] });
        assert.match(textOf(findAll(tree, el => hasClass(el, "amiricord-editor-copy"))[0]), /next time Settings opens/);
    });
});
