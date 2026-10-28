/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pageStyleHost, refuseCss, STYLE_ID_PREFIX, STYLE_LIMITS, StyleElementLike, StyleHost, StyleManager } from "../src/api/styles";

/** A page made of a list: elements appear in it when attached and leave it when removed. */
function fakePage() {
    const attached: StyleElementLike[] = [];
    const host: StyleHost = {
        create: () => {
            const element: StyleElementLike = { id: "", textContent: null, remove: () => { const i = attached.indexOf(element); if (i >= 0) attached.splice(i, 1); } };
            return element;
        },
        attach: element => { attached.push(element); }
    };
    return { host, attached, ids: () => attached.map(e => e.id) };
}

/** What the lifecycle gives: undos kept in a list, run later. */
function lifecycle() {
    const undos: Array<() => void> = [];
    return { onDispose: (undo: () => void) => { undos.push(undo); }, dispose: () => { for (const undo of undos.splice(0).reverse()) undo(); } };
}

describe("refuseCss", () => {
    it("accepts ordinary CSS, data and relative urls, and local fonts", () => {
        assert.equal(refuseCss(".a { color: red; background: url(data:image/png;base64,AAAA); }"), undefined);
        assert.equal(refuseCss(".a { background: url(\"./x.png\"); content: \"\\201C\"; }"), undefined);
        assert.equal(refuseCss(""), undefined);
        assert.equal(refuseCss("/* @import url(https://example.com/x.css); */ .a { color: red; }"), undefined, "a commented-out import is only a comment");
    });

    it("refuses what is not text, what is too large, @import and urls to web addresses in every spelling", () => {
        assert.ok(refuseCss(5 as never));
        assert.ok(refuseCss("a".repeat(STYLE_LIMITS.maxBytes + 1)));
        assert.ok(refuseCss("@import url(x.css);"));
        assert.ok(refuseCss("@IMPORT 'x.css';"));
        assert.ok(refuseCss(".a { background: url(https://example.com/x.png); }"));
        assert.ok(refuseCss(".a { background: url( 'HTTP://example.com/x.png' ); }"));
        assert.ok(refuseCss(".a { background: url(//example.com/x.png); }"));
        assert.ok(refuseCss(".a { background: image-set(\"https://example.com/x.png\" 1x); }"));
        assert.ok(refuseCss(".a { background: u\\72l(https://example.com/x.png); }"));
        assert.ok(refuseCss(".a { background: \\75 rl(https://example.com/x.png); }"));
        assert.ok(refuseCss("/* x */ @import 'x';"), "an import after a comment is still refused");
    });

    it("measures the size in bytes, not characters", () => {
        assert.ok(refuseCss("é".repeat(STYLE_LIMITS.maxBytes / 2 + 1)));
        assert.equal(refuseCss("é".repeat(STYLE_LIMITS.maxBytes / 2)), undefined);
    });
});

describe("StyleManager", () => {
    it("adds a style element with the css as text and an id that names the plugin", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        const run = lifecycle();
        manager.forRun("P", run.onDispose)(".a{color:red}", "main");
        assert.deepEqual(page.ids(), [`${STYLE_ID_PREFIX}P-main`]);
        assert.equal(page.attached[0].textContent, ".a{color:red}");
        assert.equal(manager.countOf("P"), 1);
    });

    it("changes a style through its handle, and the same name again is a change, not a second style", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        const add = manager.forRun("P", lifecycle().onDispose);
        const handle = add("a{}", "x");
        handle.update("b{}");
        assert.equal(page.attached[0].textContent, "b{}");
        add("c{}", "x");
        assert.equal(page.attached.length, 1);
        assert.equal(page.attached[0].textContent, "c{}");
        assert.throws(() => handle.update("@import 'x';"), /refused/);
        assert.equal(page.attached[0].textContent, "c{}", "a refused change leaves the old css");
    });

    it("removes one style on request, twice without harm, and an old handle cannot touch a newer style of the same name", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        const add = manager.forRun("P", lifecycle().onDispose);
        const first = add("a{}", "x");
        first.remove();
        first.remove();
        assert.equal(page.attached.length, 0);
        const second = add("b{}", "x");
        first.update("old{}");
        first.remove();
        assert.equal(page.attached.length, 1);
        assert.equal(page.attached[0].textContent, "b{}");
        assert.equal(manager.countOf("P"), 1, "the newer style is still known");
        second.remove();
        assert.equal(page.attached.length, 0, "and the newer handle still removes it");
        assert.equal(manager.countOf("P"), 0);
    });

    it("removes everything a plugin added when the plugin stops, and nothing of another plugin", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        const a = lifecycle();
        const b = lifecycle();
        const addA = manager.forRun("A", a.onDispose);
        const addB = manager.forRun("B", b.onDispose);
        addA("1{}");
        addA("2{}");
        addB("3{}", "keep");
        assert.equal(page.attached.length, 3);
        a.dispose();
        assert.deepEqual(page.ids(), [`${STYLE_ID_PREFIX}B-keep`]);
        assert.equal(manager.countOf("A"), 0);
    });

    it("refuses to add after the plugin has stopped, so a late callback leaves nothing behind", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        const run = lifecycle();
        const add = manager.forRun("P", run.onDispose);
        add("a{}");
        run.dispose();
        assert.throws(() => add("late{}"), /stopped/);
        assert.equal(page.attached.length, 0);
        // The next run of the same plugin gets its own function and works.
        manager.forRun("P", lifecycle().onDispose)("again{}");
        assert.equal(page.attached.length, 1);
    });

    it("registers its cleanup once per run, and not at all if nothing was added", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        let registered = 0;
        const add = manager.forRun("P", () => { registered++; });
        assert.equal(registered, 0);
        add("a{}");
        add("b{}");
        assert.equal(registered, 1);
    });

    it("does not register a cleanup for css it refused", () => {
        const manager = new StyleManager(fakePage().host);
        let registered = 0;
        assert.throws(() => manager.forRun("P", () => { registered++; })("@import 'x';"), /refused/);
        assert.equal(registered, 0);
    });

    it("limits the number of styles per plugin and the shape of names", () => {
        const manager = new StyleManager(fakePage().host);
        const add = manager.forRun("P", lifecycle().onDispose);
        for (let i = 0; i < STYLE_LIMITS.maxPerPlugin; i++) add("a{}");
        assert.throws(() => add("a{}"), /already has/);
        const other = manager.forRun("Q", lifecycle().onDispose);
        for (const bad of ["", "has space", "-start", "a".repeat(STYLE_LIMITS.maxNameLength + 1), "x\"y", "../x"]) assert.throws(() => other("a{}", bad), /not valid/, bad);
    });

    it("keeps going when the page already dropped an element", () => {
        const page = fakePage();
        const manager = new StyleManager(page.host);
        const run = lifecycle();
        const add = manager.forRun("P", run.onDispose);
        add("a{}");
        add("b{}");
        page.attached[0].remove = () => { throw new Error("gone"); };
        assert.doesNotThrow(() => run.dispose());
        assert.equal(manager.countOf("P"), 0);
    });
});

describe("pageStyleHost", () => {
    it("creates <style> elements and puts them in the head, or in the root element when there is no head", () => {
        const made: string[] = [];
        const inHead: unknown[] = [];
        const inRoot: unknown[] = [];
        const element = {};
        const withHead = pageStyleHost({ createElement: tag => { made.push(tag); return element; }, head: { appendChild: n => inHead.push(n) }, documentElement: { appendChild: n => inRoot.push(n) } });
        withHead.attach(withHead.create());
        const noHead = pageStyleHost({ createElement: () => element, head: null, documentElement: { appendChild: n => inRoot.push(n) } });
        noHead.attach(noHead.create());
        assert.deepEqual(made, ["style"]);
        assert.equal(inHead.length, 1);
        assert.equal(inRoot.length, 1);
    });
});
