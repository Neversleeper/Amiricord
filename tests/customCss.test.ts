/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type StyleElementLike, type StyleHost, StyleManager } from "../src/api/styles";
import { cssProblem, CUSTOM_CSS_ELEMENT_ID, CUSTOM_CSS_MAX, CUSTOM_CSS_STYLE_NAME, INDENT, indentAt, keepLast, makeCustomCss } from "../src/plugins/Settings/customCss";

/** The real style manager over a fake page: the sheet really goes through the rules plugins have. */
function page() {
    const elements: StyleElementLike[] = [];
    const host: StyleHost = {
        create: () => ({ id: "", textContent: null, remove() { const i = elements.indexOf(this); if (i >= 0) elements.splice(i, 1); } }),
        attach: element => { elements.push(element); }
    };
    const manager = new StyleManager(host);
    const disposers: Array<() => void> = [];
    const addStyle = manager.forRun("Settings", undo => { disposers.push(undo); });
    return { elements, addStyle, disposers };
}

function setup(initial: { on?: boolean; text?: string; safe?: boolean; } = {}) {
    const p = page();
    const state = { on: initial.on ?? false, text: initial.text ?? "", safe: initial.safe ?? false };
    const reports: string[] = [];
    const css = makeCustomCss({
        read: () => ({ on: state.on, text: state.text }),
        add: (text, name) => p.addStyle(text, name),
        safeMode: () => state.safe,
        report: (source, error) => { reports.push(`${source}: ${error instanceof Error ? error.message : String(error)}`); }
    });
    return { ...p, state, reports, css };
}

describe("the text of the custom CSS", () => {
    it("accepts an ordinary sheet and the empty one", () => {
        assert.equal(cssProblem(""), null);
        assert.equal(cssProblem(".a { color: red; }\n/* a comment */ body:has(.b) { margin: 0 }"), null);
        assert.equal(cssProblem("a { background: url(data:image/png;base64,AAAA) }"), null);
        assert.equal(cssProblem("a { background: url(\"icons/a.png\") }"), null);
    });

    it("refuses what the engine refuses for every plugin: @import, and addresses in url()", () => {
        for (const bad of ["@import 'x.css';", "@IMPORT url(a.css);", "a { background: url(https://example.com/a.png) }", "a { background: url( '//example.com/a.png' ) }", "a { background: image-set('https://example.com/a.png' 1x) }", "a { background: u\\72l(https://example.com) }"]) {
            assert.match(cssProblem(bad) ?? "", /^This CSS cannot be applied: /, bad);
        }
    });

    it("refuses a sheet longer than the limit, and says the number", () => {
        assert.equal(cssProblem("a".repeat(CUSTOM_CSS_MAX)), null);
        assert.equal(cssProblem("a".repeat(CUSTOM_CSS_MAX + 1)), "The CSS is longer than 30,000 characters.");
    });

    it("keeps a sheet at the limit under the largest size a saved setting may have, even when every character is a new line", () => {
        assert.ok(JSON.stringify("\n".repeat(CUSTOM_CSS_MAX)).length <= 64 * 1024);
    });
});

/** A head with children in order, where appending a node that is already in it moves it to the end, as the real one does. */
function fakeHead(ids: string[]) {
    const children = [...ids];
    let appends = 0;
    const head = {
        get lastElementChild() { return children.at(-1); },
        appendChild: (node: unknown) => { appends++; const at = children.indexOf(node as string); if (at >= 0) children.splice(at, 1); children.push(node as string); return node; }
    };
    return { head, children, appends: () => appends };
}

function fakeObserver() {
    const state = { callback: undefined as (() => void) | undefined, observed: [] as unknown[], disconnected: 0 };
    const make = (callback: () => void) => { state.callback = callback; return { observe: (target: unknown) => { state.observed.push(target); }, disconnect: () => { state.disconnected++; } }; };
    return { state, make };
}

describe("keeping the sheet last in the page", () => {
    it("names the element the way the style manager does", () => {
        assert.equal(CUSTOM_CSS_ELEMENT_ID, "amiricord-style-Settings-custom-css");
    });

    it("moves the sheet to the end at once when Discord has added things after it, and does not touch it when it is already last", () => {
        const late = fakeHead(["a", "ours", "b", "c"]);
        keepLast({ head: late.head, getElementById: id => (id === "ours" ? "ours" : null) }, "ours", fakeObserver().make);
        assert.deepEqual(late.children, ["a", "b", "c", "ours"]);
        const already = fakeHead(["a", "ours"]);
        keepLast({ head: already.head, getElementById: () => "ours" }, "ours", fakeObserver().make);
        assert.equal(already.appends(), 0, "a move that is not needed is not made");
    });

    it("puts it back at the end each time something is added after it, and listens to the head only for additions and removals", () => {
        const page = fakeHead(["a", "ours"]);
        const observer = fakeObserver();
        keepLast({ head: page.head, getElementById: () => "ours" }, "ours", observer.make);
        assert.deepEqual(observer.state.observed, [page.head]);
        page.children.push("discord-sheet");
        observer.state.callback!();
        assert.deepEqual(page.children, ["a", "discord-sheet", "ours"]);
        const before = page.appends();
        observer.state.callback!();
        assert.equal(page.appends(), before, "its own move, heard again, does nothing and so cannot loop");
    });

    it("stops listening when asked, and never throws: not for a missing element, a page that fails, or an observer that cannot be made", () => {
        const page = fakeHead(["ours"]);
        const observer = fakeObserver();
        const stop = keepLast({ head: page.head, getElementById: () => "ours" }, "ours", observer.make);
        stop();
        assert.equal(observer.state.disconnected, 1);
        assert.doesNotThrow(() => keepLast({ head: page.head, getElementById: () => null }, "ours", fakeObserver().make)());
        assert.doesNotThrow(() => keepLast({ head: null, getElementById: () => "ours" }, "ours", fakeObserver().make)());
        assert.doesNotThrow(() => keepLast({ head: page.head, getElementById: () => { throw new Error("gone"); } }, "ours", fakeObserver().make)());
        assert.doesNotThrow(() => keepLast({ head: page.head, getElementById: () => "ours" }, "ours", () => { throw new Error("no observer"); })());
    });

    it("is started once while the sheet is in the page, not again for each change of the text, and stopped when the sheet leaves", () => {
        const p = page();
        const state = { on: true, text: "a { color: red }" };
        const events: string[] = [];
        const css = makeCustomCss({
            read: () => state, add: (text, name) => p.addStyle(text, name), safeMode: () => false, report: () => undefined,
            keepLast: () => { events.push("start"); return () => { events.push("stop"); }; }
        });
        css.apply();
        state.text = "a { color: blue }";
        css.apply();
        assert.deepEqual(events, ["start"]);
        state.on = false;
        css.apply();
        assert.deepEqual(events, ["start", "stop"]);
        state.on = true;
        css.apply();
        css.stop();
        assert.deepEqual(events, ["start", "stop", "start", "stop"]);
    });

    it("is not started for a sheet that is refused, and is stopped when the sheet becomes one", () => {
        const p = page();
        const state = { on: true, text: "@import 'x.css';" };
        const events: string[] = [];
        const css = makeCustomCss({
            read: () => state, add: (text, name) => p.addStyle(text, name), safeMode: () => false, report: () => undefined,
            keepLast: () => { events.push("start"); return () => { events.push("stop"); }; }
        });
        css.apply();
        assert.deepEqual(events, []);
        state.text = "a { color: red }";
        css.apply();
        state.text = "@import 'x.css';";
        css.apply();
        assert.deepEqual(events, ["start", "stop"]);
    });
});

describe("the Tab key in the text box", () => {
    it("puts four spaces where the cursor is and moves the cursor after them", () => {
        assert.equal(INDENT, "    ");
        assert.deepEqual(indentAt("a{}", 1, 1), { text: "a    {}", caret: 5 });
        assert.deepEqual(indentAt("", 0, 0), { text: "    ", caret: 4 });
    });

    it("replaces what is selected, and stays inside the text for a selection that is out of range", () => {
        assert.deepEqual(indentAt("abcdef", 1, 4), { text: "a    ef", caret: 5 });
        assert.deepEqual(indentAt("abc", -5, 99), { text: "    ", caret: 4 });
        assert.deepEqual(indentAt("abc", 3, 1), { text: "abc    ", caret: 7 });
    });
});

describe("applying the custom CSS", () => {
    it("puts nothing in the page while the switch is off or the sheet is empty", () => {
        const t = setup({ on: false, text: "a { color: red }" });
        t.css.apply();
        assert.equal(t.elements.length, 0);
        t.state.on = true;
        t.state.text = "   \n";
        t.css.apply();
        assert.equal(t.elements.length, 0);
        assert.equal(t.css.applied(), false);
    });

    it("adds one style with the sheet when the switch is on, under a name of its own", () => {
        const t = setup({ on: true, text: "a { color: red }" });
        t.css.apply();
        assert.equal(t.elements.length, 1);
        assert.equal(t.elements[0].textContent, "a { color: red }");
        assert.equal(t.elements[0].id, `amiricord-style-Settings-${CUSTOM_CSS_STYLE_NAME}`);
        assert.equal(t.css.applied(), true);
    });

    it("changes the same style when the text changes, never adds a second, and takes it out when the switch goes off or the text is emptied", () => {
        const t = setup({ on: true, text: "a { color: red }" });
        t.css.apply();
        t.state.text = "a { color: blue }";
        t.css.apply();
        assert.equal(t.elements.length, 1);
        assert.equal(t.elements[0].textContent, "a { color: blue }");
        t.state.on = false;
        t.css.apply();
        assert.equal(t.elements.length, 0);
        assert.equal(t.css.applied(), false);
        t.state.on = true;
        t.css.apply();
        assert.equal(t.elements.length, 1);
        t.state.text = "";
        t.css.apply();
        assert.equal(t.elements.length, 0);
        assert.deepEqual(t.reports, []);
    });

    it("does not apply it in safe mode, and applies it again when safe mode is off", () => {
        const t = setup({ on: true, text: "a { color: red }", safe: true });
        t.css.apply();
        assert.equal(t.elements.length, 0);
        t.state.safe = false;
        t.css.apply();
        assert.equal(t.elements.length, 1);
    });

    it("drops the style and reports a sheet that the rules refuse (for example one edited into the settings file by hand), without throwing", () => {
        const t = setup({ on: true, text: "a { color: red }" });
        t.css.apply();
        t.state.text = "@import 'x.css';";
        assert.doesNotThrow(() => t.css.apply());
        assert.equal(t.elements.length, 0);
        assert.equal(t.css.applied(), false);
        assert.equal(t.reports.length, 1);
        assert.match(t.reports[0], /^custom CSS: This CSS cannot be applied: @import is not allowed/);
        t.state.text = "a { color: green }";
        t.css.apply();
        assert.equal(t.elements.length, 1);
    });

    it("reports and does not throw when the engine refuses to add (the plugin has stopped)", () => {
        const late = setup({ on: true, text: "a { color: red }" });
        late.css.apply();
        for (const undo of late.disposers.splice(0)) undo();
        late.state.text = "b { color: red }";
        late.css.stop();
        assert.doesNotThrow(() => late.css.apply());
        assert.equal(late.reports.length, 1);
        assert.match(late.reports[0], /has stopped/);
        assert.equal(late.css.applied(), false);
    });

    it("stop takes the style out, and can be called twice", () => {
        const t = setup({ on: true, text: "a { color: red }" });
        t.css.apply();
        t.css.stop();
        t.css.stop();
        assert.equal(t.elements.length, 0);
        assert.equal(t.css.applied(), false);
    });

    it("goes with everything else the plugin added when the plugin stops", () => {
        const t = setup({ on: true, text: "a { color: red }" });
        t.css.apply();
        for (const undo of t.disposers) undo();
        assert.equal(t.elements.length, 0);
    });
});
