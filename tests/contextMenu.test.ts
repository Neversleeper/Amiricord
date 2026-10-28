/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    cleanEntries, CONTEXT_MENU_CSS, type ContextMenuEntry, createContextMenuLayer, GROUP_MAX, LABEL_MAX, MAX_ENTRIES, type MenuElementLike, type MenuEventLike
} from "../src/api/contextMenu";

// --- A small stand-in for the page --------------------------------------------------------------------------------------------------------

class FakeEl implements MenuElementLike {
    className = "";
    textContent: string | null = null;
    tabIndex = -1;
    attrs: Record<string, string> = {};
    style = { left: "", top: "" };
    offsetWidth = 0;
    offsetHeight = 0;
    children: FakeEl[] = [];
    parent?: FakeEl;
    listeners = new Map<string, Array<(event: MenuEventLike) => void>>();
    focused = 0;

    constructor(readonly tag: string) { }

    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    append(...children: unknown[]) { for (const child of children as FakeEl[]) { child.parent = this; this.children.push(child); } }
    remove() {
        if (!this.parent) return;
        const at = this.parent.children.indexOf(this);
        if (at >= 0) this.parent.children.splice(at, 1);
        this.parent = undefined;
    }
    addEventListener(type: string, listener: (event: MenuEventLike) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
    fire(type: string, event: MenuEventLike = {}) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
    contains(other: unknown): boolean { return other === this || this.children.some(child => child.contains(other)); }
    focus() { this.focused++; }
    all(test: (el: FakeEl) => boolean, found: FakeEl[] = []): FakeEl[] {
        if (test(this)) found.push(this);
        for (const child of this.children) child.all(test, found);
        return found;
    }
    has(name: string) { return this.className.split(" ").includes(name); }
}

function setup(options: { page?: boolean; body?: boolean; view?: { w: number; h: number; } | null; menuSize?: { w: number; h: number; }; } = {}) {
    const body = new FakeEl("body");
    const styles: string[] = [];
    const docListeners: Array<{ type: string; listener: (event: MenuEventLike) => void; capture: boolean; }> = [];
    const view = options.view === null ? null : { clientWidth: options.view?.w ?? 1000, clientHeight: options.view?.h ?? 800 };
    const page = {
        createElement: (tag: string) => { const el = new FakeEl(tag); if (tag === "div") { el.offsetWidth = options.menuSize?.w ?? 0; el.offsetHeight = options.menuSize?.h ?? 0; } return el; },
        body: options.body === false ? null : body,
        documentElement: view,
        addEventListener: (type: string, listener: (event: MenuEventLike) => void, capture?: boolean) => { docListeners.push({ type, listener, capture: capture === true }); },
        removeEventListener: (type: string, listener: (event: MenuEventLike) => void, capture?: boolean) => {
            const at = docListeners.findIndex(entry => entry.type === type && entry.listener === listener && entry.capture === (capture === true));
            if (at >= 0) docListeners.splice(at, 1);
        }
    };
    const layer = createContextMenuLayer({ document: options.page === false ? undefined : page, addStyle: css => { styles.push(css); } });
    const disposers: Array<() => void> = [];
    const errors: Array<[string, unknown]> = [];
    const forPlugin = (id: string) => layer.forPlugin(id, undo => { disposers.push(undo); }, (source, error) => { errors.push([source, error]); });
    const dispatch = (type: string, event: MenuEventLike = {}) => { for (const entry of [...docListeners]) if (entry.type === type) entry.listener(event); };
    const menus = () => body.all(el => el.has("amiricord-context-menu"));
    const items = (menu = menus()[0]) => menu.all(el => el.has("amiricord-context-item"));
    const labels = (menu = menus()[0]) => items(menu).map(el => el.all(span => span.has("amiricord-context-label"))[0].textContent);
    return { body, styles, docListeners, disposers, errors, forPlugin, dispatch, menus, items, labels };
}

const at = (x = 10, y = 20) => ({ clientX: x, clientY: y });
const entry = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: `Label ${id}`, action: () => undefined, ...extra });

// --- Cleaning what a plugin gives --------------------------------------------------------------------------------------------------------

describe("cleanEntries", () => {
    it("gives nothing for what is not a list, and drops what is not an entry, without throwing", () => {
        for (const bad of [undefined, null, 5, "x", {}, () => undefined]) assert.deepEqual(cleanEntries(bad), []);
        assert.deepEqual(cleanEntries([null, 5, "x", [], {}, undefined, true]), []);
    });

    it("keeps an item with an id, a text and a function, and drops one that lacks any", () => {
        const good = entry("a");
        const result = cleanEntries([good, { label: "no id", action: () => undefined }, { id: "x", action: () => undefined }, { id: "y", label: "no action" },
            { id: "z", label: "not a function", action: "no" }, { id: 5, label: "id is a number", action: () => undefined }, { id: "w", label: "   ", action: () => undefined }]);
        assert.deepEqual(result.map(r => r.kind === "item" ? r.id : r.kind), ["a"]);
    });

    it("trims and cuts the text, and keeps the flags only when they are true or a yes/no", () => {
        const [item] = cleanEntries([entry("a", { label: `  ${"x".repeat(LABEL_MAX + 20)}  `, disabled: true, danger: true, checked: false })]);
        assert.equal(item.kind, "item");
        if (item.kind !== "item") return;
        assert.equal(item.label.length, LABEL_MAX);
        assert.ok(item.label.endsWith("…"));
        assert.deepEqual([item.disabled, item.danger, item.checked], [true, true, false]);
        const [plain] = cleanEntries([entry("b", { disabled: "yes", danger: 1, checked: "yes" })]);
        assert.ok(plain.kind === "item" && plain.disabled === false && plain.danger === false && !("checked" in plain));
    });

    it("never starts or ends with a separator and never has two in a row", () => {
        const kinds = (list: ContextMenuEntry[]) => cleanEntries(list).map(e => e.kind);
        assert.deepEqual(kinds([{ separator: true }, entry("a"), { separator: true }, { separator: true }, entry("b"), { separator: true }]), ["item", "separator", "item"]);
        assert.deepEqual(kinds([{ separator: true }, { separator: true }]), []);
    });

    it("makes a group of its items, and drops a group with no valid item and a group inside a group", () => {
        const result = cleanEntries([
            { group: `  ${"g".repeat(GROUP_MAX + 10)}  `, items: [{ separator: true }, entry("a"), { separator: true }, { separator: true }, entry("b"), { separator: true }] },
            { group: "empty", items: [{ label: "bad" } as never] },
            { group: "outer", items: [{ group: "inner", items: [entry("c")] } as never] },
            { group: "no list" } as never
        ]);
        assert.equal(result.length, 1);
        const [group] = result;
        assert.equal(group.kind, "group");
        if (group.kind !== "group") return;
        assert.equal(group.label, "g".repeat(GROUP_MAX - 1) + "…", "trimmed, then cut");
        assert.deepEqual(group.items.map(e => e.kind), ["item", "separator", "item"]);
    });

    it("keeps at most the largest number of items, counting those inside groups", () => {
        const many = Array.from({ length: MAX_ENTRIES + 25 }, (_, i) => entry(`i${i}`));
        assert.equal(cleanEntries(many).length, MAX_ENTRIES);
        const grouped = cleanEntries([{ group: "g", items: many.slice(0, MAX_ENTRIES - 1) }, entry("a"), entry("b")]);
        const count = grouped.reduce((n, e) => n + (e.kind === "group" ? e.items.filter(i => i.kind === "item").length : e.kind === "item" ? 1 : 0), 0);
        assert.equal(count, MAX_ENTRIES);
    });

    it("cuts a group that alone has more items than the limit", () => {
        const huge = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => entry(`i${i}`));
        const [group] = cleanEntries([{ group: "g", items: huge }]);
        assert.equal(group.kind, "group");
        if (group.kind !== "group") return;
        assert.equal(group.items.length, MAX_ENTRIES);
    });
});

// --- Drawing and placing the menu ---------------------------------------------------------------------------------------------------------

describe("opening a menu", () => {
    it("draws a menu with the items, a check mark, a disabled and a danger look, separators and groups", () => {
        const t = setup();
        const opened = t.forPlugin("P").open(at(), [
            entry("one"), entry("two", { checked: true }), entry("three", { checked: false }), { separator: true },
            entry("four", { disabled: true }), entry("five", { danger: true }),
            { group: "More", items: [entry("six")] }
        ]);
        assert.equal(opened, true);
        const [menu] = t.menus();
        assert.deepEqual([menu.attrs.role, menu.tabIndex], ["menu", -1]);
        assert.deepEqual(t.labels(), ["Label one", "Label two", "Label three", "Label four", "Label five", "Label six"]);
        const [one, two, three, four, five, six] = t.items();
        assert.deepEqual([one.attrs.role, one.attrs["data-id"], one.attrs["data-active"]], ["menuitem", "one", "false"]);
        assert.deepEqual([two.attrs.role, two.attrs["aria-checked"], three.attrs["aria-checked"]], ["menuitemcheckbox", "true", "false"]);
        assert.equal(two.all(el => el.has("amiricord-context-check"))[0].textContent, "✓");
        assert.equal(three.all(el => el.has("amiricord-context-check")).length, 0, "an unchecked choice has no mark");
        assert.equal(four.attrs["aria-disabled"], "true");
        assert.equal(one.attrs["aria-disabled"], undefined);
        assert.ok(five.has("amiricord-context-item-danger"));
        assert.equal(menu.all(el => el.has("amiricord-context-separator")).length, 1);
        const [group] = menu.all(el => el.attrs.role === "group");
        assert.equal(group.attrs["aria-label"], "More");
        assert.equal(group.all(el => el.has("amiricord-context-group-title"))[0].textContent, "More");
        assert.ok(group.contains(six));
    });

    it("keeps text as text and the label in a span, never as HTML", () => {
        const t = setup();
        t.forPlugin("P").open(at(), [entry("a", { label: "<img src=x onerror=alert(1)>" })]);
        assert.equal(t.labels()[0], "<img src=x onerror=alert(1)>");
        assert.equal(t.menus()[0].all(el => el.tag === "img").length, 0);
    });

    it("adds the style once, however many menus open", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.open(at(), [entry("a")]);
        p.open(at(), [entry("b")]);
        t.forPlugin("Q").open(at(), [entry("c")]);
        assert.deepEqual(t.styles, [CONTEXT_MENU_CSS]);
    });

    it("places the menu at the pointer and keeps it inside the window", () => {
        const t = setup({ menuSize: { w: 200, h: 100 }, view: { w: 1000, h: 800 } });
        const p = t.forPlugin("P");
        p.open(at(300, 400), [entry("a")]);
        assert.deepEqual([t.menus()[0].style.left, t.menus()[0].style.top], ["300px", "400px"]);
        p.open(at(950, 790), [entry("a")]);
        assert.deepEqual([t.menus()[0].style.left, t.menus()[0].style.top], ["792px", "692px"], "pulled back by its own size and the margin");
        p.open(at(-50, -50), [entry("a")]);
        assert.deepEqual([t.menus()[0].style.left, t.menus()[0].style.top], ["8px", "8px"]);
        p.open(at(Number.NaN, Infinity), [entry("a")]);
        assert.deepEqual([t.menus()[0].style.left, t.menus()[0].style.top], ["8px", "8px"], "a pointer that is not a number counts as 0");
    });

    it("puts the menu where it is asked when the window size is not known, and focuses it", () => {
        const t = setup({ view: null });
        t.forPlugin("P").open(at(123, 456), [entry("a")]);
        assert.deepEqual([t.menus()[0].style.left, t.menus()[0].style.top], ["123px", "456px"]);
        assert.equal(t.menus()[0].focused, 1);
    });

    it("says whether a menu opened, and leaves the open menu alone when nothing valid was given", () => {
        const t = setup();
        const p = t.forPlugin("P");
        assert.equal(p.open(at(), [entry("a")]), true);
        assert.equal(p.open(at(), []), false);
        assert.equal(p.open(at(), [{ separator: true }]), false);
        assert.equal(p.open(at(), [{ label: "bad" } as never]), false);
        assert.deepEqual(t.labels(), ["Label a"], "the first menu is still there");
        assert.equal(p.open(null as never, [entry("b")]), true, "an event that is not an object counts as the corner");
    });

    it("opens nothing when there is no page or no body, and breaks nothing", () => {
        for (const options of [{ page: false }, { body: false }]) {
            const t = setup(options);
            const p = t.forPlugin("P");
            assert.equal(p.open(at(), [entry("a")]), false);
            assert.doesNotThrow(() => { p.close(); p.onElement("div", () => []); });
            assert.deepEqual(t.styles, []);
        }
    });

    it("lets only one menu be open: a new one replaces the old one, which stops listening", () => {
        const t = setup();
        t.forPlugin("P").open(at(), [entry("a")]);
        const listening = t.docListeners.length;
        t.forPlugin("Q").open(at(), [entry("b")]);
        assert.deepEqual(t.labels(), ["Label b"]);
        assert.equal(t.menus().length, 1);
        assert.equal(t.docListeners.length, listening, "the old menu's listeners were taken away");
    });
});

describe("using a menu", () => {
    it("closes before an item runs, and runs it", () => {
        const t = setup();
        const seen: number[] = [];
        t.forPlugin("P").open(at(), [entry("a", { action: () => { seen.push(t.menus().length); } })]);
        t.items()[0].fire("click");
        assert.deepEqual(seen, [0], "the menu was already gone when the action ran");
    });

    it("does nothing for a disabled item, and keeps the menu", () => {
        const t = setup();
        let runs = 0;
        t.forPlugin("P").open(at(), [entry("a", { disabled: true, action: () => { runs++; } })]);
        t.items()[0].fire("click");
        assert.equal(runs, 0);
        assert.equal(t.menus().length, 1);
    });

    it("reports an action that throws, and the menu is closed all the same", () => {
        const t = setup();
        const failure = new Error("boom");
        t.forPlugin("P").open(at(), [entry("a", { action: () => { throw failure; } })]);
        t.items()[0].fire("click");
        assert.deepEqual(t.errors, [["context menu action", failure]]);
        assert.equal(t.menus().length, 0);
    });

    it("lets the action open another menu", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.open(at(), [entry("a", { action: () => { p.open(at(), [entry("next")]); } })]);
        t.items()[0].fire("click");
        assert.deepEqual(t.labels(), ["Label next"]);
    });

    it("closes on a press outside, and not on a press inside", () => {
        const t = setup();
        t.forPlugin("P").open(at(), [entry("a")]);
        t.dispatch("mousedown", { target: t.items()[0] });
        assert.equal(t.menus().length, 1, "inside");
        t.dispatch("mousedown", { target: t.menus()[0] });
        assert.equal(t.menus().length, 1, "the menu itself");
        t.dispatch("mousedown", { target: new FakeEl("div") });
        assert.equal(t.menus().length, 0, "outside");
    });

    it("closes on Escape without Discord seeing it, and on Tab, and ignores other keys", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.open(at(), [entry("a")]);
        let prevented = 0;
        let stopped = 0;
        t.dispatch("keydown", { key: "a" });
        t.dispatch("keydown", { key: "Shift" });
        assert.equal(t.menus().length, 1);
        t.dispatch("keydown", { key: "Escape", preventDefault: () => { prevented++; }, stopPropagation: () => { stopped++; } });
        assert.deepEqual([t.menus().length, prevented, stopped], [0, 1, 1]);
        p.open(at(), [entry("a")]);
        t.dispatch("keydown", { key: "Tab" });
        assert.equal(t.menus().length, 0);
    });

    it("closes when the window changes size or something scrolls", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.open(at(), [entry("a")]);
        t.dispatch("resize");
        assert.equal(t.menus().length, 0);
        p.open(at(), [entry("a")]);
        t.dispatch("scroll");
        assert.equal(t.menus().length, 0);
    });

    it("stops listening to the page when it closes", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.open(at(), [entry("a")]);
        assert.deepEqual(t.docListeners.map(l => [l.type, l.capture]).sort(), [["keydown", true], ["mousedown", true], ["resize", true], ["scroll", true]]);
        p.close();
        assert.equal(t.docListeners.length, 0);
    });
});

describe("the keyboard", () => {
    const three = () => [entry("a"), entry("b", { disabled: true }), entry("c")];
    const activeOf = (t: ReturnType<typeof setup>) => t.items().map(el => el.attrs["data-active"]);

    it("moves down and up over the items that can be used, skipping the disabled ones, and stops at the ends", () => {
        const t = setup();
        t.forPlugin("P").open(at(), three());
        const down = () => t.dispatch("keydown", { key: "ArrowDown", preventDefault: () => undefined });
        const up = () => t.dispatch("keydown", { key: "ArrowUp", preventDefault: () => undefined });
        down();
        assert.deepEqual(activeOf(t), ["true", "false", "false"]);
        down();
        assert.deepEqual(activeOf(t), ["false", "false", "true"], "the disabled one is skipped");
        down();
        assert.deepEqual(activeOf(t), ["false", "false", "true"], "it stops at the last one");
        up();
        assert.deepEqual(activeOf(t), ["true", "false", "false"]);
        up();
        assert.deepEqual(activeOf(t), ["true", "false", "false"]);
    });

    it("starts from the last item with Up, and goes to the ends with Home and End", () => {
        const t = setup();
        t.forPlugin("P").open(at(), three());
        t.dispatch("keydown", { key: "ArrowUp" });
        assert.deepEqual(activeOf(t), ["false", "false", "true"]);
        t.dispatch("keydown", { key: "Home" });
        assert.deepEqual(activeOf(t), ["true", "false", "false"]);
        t.dispatch("keydown", { key: "End" });
        assert.deepEqual(activeOf(t), ["false", "false", "true"]);
    });

    it("focuses the item that becomes active, and keeps the keys from scrolling the page", () => {
        const t = setup();
        t.forPlugin("P").open(at(), three());
        let prevented = 0;
        t.dispatch("keydown", { key: "ArrowDown", preventDefault: () => { prevented++; } });
        assert.equal(t.items()[0].focused, 1);
        t.dispatch("keydown", { key: "End", preventDefault: () => { prevented++; } });
        assert.equal(prevented, 2);
    });

    it("runs the active item with Enter or Space, and does nothing before one is active", () => {
        const t = setup();
        const log: string[] = [];
        t.forPlugin("P").open(at(), [entry("a", { action: () => { log.push("a"); } }), entry("b", { action: () => { log.push("b"); } })]);
        t.dispatch("keydown", { key: "Enter" });
        assert.deepEqual(log, [], "nothing is active yet");
        t.dispatch("keydown", { key: "ArrowDown" });
        t.dispatch("keydown", { key: "ArrowDown" });
        let prevented = 0;
        t.dispatch("keydown", { key: " ", preventDefault: () => { prevented++; } });
        assert.deepEqual(log, ["b"]);
        assert.equal(prevented, 1);
        assert.equal(t.menus().length, 0);
    });

    it("follows the pointer: hovering an item makes it active, hovering a disabled one does not", () => {
        const t = setup();
        t.forPlugin("P").open(at(), three());
        t.items()[2].fire("mouseenter");
        assert.deepEqual(activeOf(t), ["false", "false", "true"]);
        t.items()[1].fire("mouseenter");
        assert.deepEqual(activeOf(t), ["false", "false", "true"]);
        t.items()[0].fire("mouseenter");
        assert.deepEqual(activeOf(t), ["true", "false", "false"]);
    });
});

describe("close and stopping the plugin", () => {
    it("closes the menu this plugin opened, and not one that another plugin opened", () => {
        const t = setup();
        const a = t.forPlugin("A");
        const b = t.forPlugin("B");
        b.open(at(), [entry("b")]);
        a.close();
        assert.equal(t.menus().length, 1);
        b.close();
        assert.equal(t.menus().length, 0);
        assert.doesNotThrow(() => { b.close(); b.close(); });
    });

    it("registers one undo per plugin, which closes its menu and stops its element listeners", () => {
        const t = setup();
        const p = t.forPlugin("P");
        p.open(at(), [entry("a")]);
        p.onElement("div", () => [entry("x")]);
        p.onElement("span", () => [entry("y")]);
        assert.equal(t.disposers.length, 1);
        assert.equal(t.docListeners.filter(l => l.type === "contextmenu").length, 2);
        t.disposers[0]();
        assert.equal(t.menus().length, 0);
        assert.equal(t.docListeners.filter(l => l.type === "contextmenu").length, 0);
    });

    it("leaves another plugin's menu open when a plugin stops", () => {
        const t = setup();
        const a = t.forPlugin("A");
        const b = t.forPlugin("B");
        a.open(at(), [entry("a")]);
        b.open(at(), [entry("b")]);
        t.disposers[0]();
        assert.deepEqual(t.labels(), ["Label b"], "A stopped, B's menu is the one open");
    });

    it("registers no undo for a plugin that never opens or listens", () => {
        const t = setup();
        t.forPlugin("P");
        assert.equal(t.disposers.length, 0);
    });
});

// --- onElement ------------------------------------------------------------------------------------------------------------------------------

describe("a right click on matching elements", () => {
    const target = (match: unknown) => ({ closest: (selector: string) => (selector === ".tile" ? match : null) });
    const click = (el: unknown, extra: Partial<MenuEventLike> = {}) => {
        const calls = { prevented: 0, stopped: 0 };
        const event: MenuEventLike = { target: el, clientX: 40, clientY: 50, preventDefault: () => { calls.prevented++; }, stopPropagation: () => { calls.stopped++; }, ...extra };
        return { event, calls };
    };

    it("listens on the page before Discord does, and opens the menu at the pointer, stopping Discord's own menu", () => {
        const t = setup();
        const element = { id: "tile" };
        const log: unknown[] = [];
        t.forPlugin("P").onElement(".tile", (event, el) => { log.push([event.clientX, event.clientY, el]); return [entry("a")]; });
        assert.deepEqual(t.docListeners.map(l => [l.type, l.capture]), [["contextmenu", true]]);
        const { event, calls } = click(target(element));
        t.dispatch("contextmenu", event);
        assert.deepEqual(log, [[40, 50, element]]);
        assert.deepEqual(calls, { prevented: 1, stopped: 1 });
        assert.deepEqual(t.labels(), ["Label a"]);
        assert.deepEqual([t.menus()[0].style.left, t.menus()[0].style.top], ["40px", "50px"]);
    });

    it("does nothing for a click that is not on a matching element, and does not even ask for entries", () => {
        const t = setup();
        let asked = 0;
        t.forPlugin("P").onElement(".tile", () => { asked++; return [entry("a")]; });
        for (const other of [target(null), {}, null, undefined, "text", { closest: "not a function" }]) {
            const { event, calls } = click(other);
            t.dispatch("contextmenu", event);
            assert.deepEqual(calls, { prevented: 0, stopped: 0 });
        }
        assert.equal(asked, 0);
        assert.equal(t.menus().length, 0);
    });

    it("leaves Discord's menu alone when the plugin gives no entry, or none that is valid", () => {
        const t = setup();
        const answers: unknown[] = [undefined, null, [], [{ separator: true }], [{ label: "bad" }], "text"];
        let which = 0;
        t.forPlugin("P").onElement(".tile", () => answers[which++] as never);
        for (let i = 0; i < answers.length; i++) {
            const { event, calls } = click(target({}));
            t.dispatch("contextmenu", event);
            assert.deepEqual(calls, { prevented: 0, stopped: 0 }, String(i));
        }
        assert.equal(t.menus().length, 0);
    });

    it("reports a build that throws and leaves Discord's menu alone", () => {
        const t = setup();
        const failure = new Error("boom");
        t.forPlugin("P").onElement(".tile", () => { throw failure; });
        const { event, calls } = click(target({}));
        t.dispatch("contextmenu", event);
        assert.deepEqual(t.errors, [["context menu build", failure]]);
        assert.deepEqual(calls, { prevented: 0, stopped: 0 });
    });

    it("says an invalid selector once, and stops asking for that registration only", () => {
        const t = setup();
        const failure = new SyntaxError("bad selector");
        let built = 0;
        t.forPlugin("P").onElement("[", () => { built++; return [entry("a")]; });
        t.forPlugin("P").onElement(".tile", () => [entry("ok")]);
        const broken = { closest: (selector: string) => { if (selector === "[") throw failure; return {}; } };
        t.dispatch("contextmenu", click(broken).event);
        t.dispatch("contextmenu", click(broken).event);
        assert.deepEqual(t.errors, [["context menu selector", failure]]);
        assert.equal(built, 0);
        assert.deepEqual(t.labels(), ["Label ok"], "the other registration still worked");
    });

    it("stops with the function it returns, which can be called twice", () => {
        const t = setup();
        const stop = t.forPlugin("P").onElement(".tile", () => [entry("a")]);
        stop();
        assert.doesNotThrow(() => { stop(); });
        t.dispatch("contextmenu", click(target({})).event);
        assert.equal(t.menus().length, 0);
        assert.equal(t.docListeners.length, 0);
    });

    it("gives a function that does nothing for a selector or a build that is not usable, or when there is no page", () => {
        const t = setup();
        const p = t.forPlugin("P");
        const stops = [p.onElement("", () => []), p.onElement("   ", () => []), p.onElement(5 as never, () => []), p.onElement(".tile", "no" as never)];
        assert.equal(t.docListeners.length, 0, "none of them started listening");
        for (const stop of stops) {
            assert.equal(typeof stop, "function");
            assert.doesNotThrow(() => { stop(); });
        }
        const none = setup({ page: false });
        assert.doesNotThrow(() => { none.forPlugin("P").onElement(".tile", () => [])(); });
    });
});
