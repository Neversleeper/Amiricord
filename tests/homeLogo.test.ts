/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refuseCss, type StyleElementLike, type StyleHost, StyleManager } from "../src/api/styles";
import { HOME_LOGO_STYLE_NAME, homeLogoCss, isImageData, makeHomeLogo } from "../src/plugins/Settings/homeLogo";

const LOGO = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

/** The real style manager over a fake page, so the style really goes through the rules plugins have. */
function setup(initial: { on?: boolean; safe?: boolean; logo?: string; } = {}) {
    const elements: StyleElementLike[] = [];
    const host: StyleHost = {
        create: () => ({ id: "", textContent: null, remove() { const i = elements.indexOf(this); if (i >= 0) elements.splice(i, 1); } }),
        attach: element => { elements.push(element); }
    };
    const manager = new StyleManager(host);
    const disposers: Array<() => void> = [];
    const addStyle = manager.forRun("Settings", undo => { disposers.push(undo); });
    const state = { on: initial.on ?? false, safe: initial.safe ?? false };
    const reports: string[] = [];
    const logo = makeHomeLogo({
        logo: initial.logo ?? LOGO,
        read: () => state.on,
        add: (css, name) => addStyle(css, name),
        safeMode: () => state.safe,
        report: (source, error) => { reports.push(`${source}: ${error instanceof Error ? error.message : String(error)}`); }
    });
    return { elements, state, reports, logo, disposers };
}

describe("the picture of the Amiricord logo", () => {
    it("accepts an image given in the address, and nothing that could reach the network or break out of the style", () => {
        for (const good of [LOGO, "data:image/png;base64,iVBORw0KGgo=", "data:image/jpeg;base64,/9j/4AAQ", "data:image/svg+xml;base64,PHN2Zz4="]) assert.equal(isImageData(good), true, good);
        for (const bad of ["https://example.com/a.png", "http://example.com/a.png", "//example.com/a.png", "assets/logo.webp", "javascript:alert(1)", "data:text/html;base64,PGI+", "data:image/png,plain",
            "data:image/png;base64,AAAA\")} body{display:none}", "data:image/png;base64,AA AA", "", undefined, null, 5, {}]) assert.equal(isImageData(bad), false, String(bad));
    });
});

describe("the style of the Amiricord logo", () => {
    it("hides Discord's logo in the Home button and draws the Amiricord one there, and touches nothing else", () => {
        const css = homeLogoCss(LOGO);
        assert.match(css, /\[data-list-item-id="guildsnav___home"\] svg \{ display: none !important; \}/);
        assert.match(css, /\[data-list-item-id="guildsnav___home"\] \[class\*="childWrapper"\] \{[^}]*background-image: url\("data:image\/webp;base64,/);
        const selectors = css.split("\n").map(line => line.split("{")[0].trim());
        assert.ok(selectors.every(selector => selector.startsWith("[data-list-item-id=\"guildsnav___home\"]")), "every rule is about the Home button");
    });

    it("passes the same rules every plugin's style must pass: no @import, no web addresses", () => {
        assert.equal(refuseCss(homeLogoCss(LOGO)), undefined);
    });
});

describe("applying the Amiricord logo", () => {
    it("puts nothing in the page while the switch is off", () => {
        const t = setup({ on: false });
        t.logo.apply();
        assert.equal(t.elements.length, 0);
        assert.equal(t.logo.applied(), false);
    });

    it("adds one style, under a name of its own, when the switch is on, and does not add a second one when applied again", () => {
        const t = setup({ on: true });
        t.logo.apply();
        t.logo.apply();
        assert.equal(t.elements.length, 1);
        assert.equal(t.elements[0].id, `amiricord-style-Settings-${HOME_LOGO_STYLE_NAME}`);
        assert.equal(t.elements[0].textContent, homeLogoCss(LOGO));
        assert.equal(t.logo.applied(), true);
    });

    it("takes the style out when the switch goes off, and puts it back when it goes on again", () => {
        const t = setup({ on: true });
        t.logo.apply();
        t.state.on = false;
        t.logo.apply();
        assert.equal(t.elements.length, 0);
        t.state.on = true;
        t.logo.apply();
        assert.equal(t.elements.length, 1);
        assert.deepEqual(t.reports, []);
    });

    it("does not apply it in safe mode, and applies it when safe mode is off", () => {
        const t = setup({ on: true, safe: true });
        t.logo.apply();
        assert.equal(t.elements.length, 0);
        t.state.safe = false;
        t.logo.apply();
        assert.equal(t.elements.length, 1);
    });

    it("does not use a picture that is not an image given in the address: nothing is added, and it is reported", () => {
        const t = setup({ on: true, logo: "https://example.com/logo.png" });
        t.logo.apply();
        assert.equal(t.elements.length, 0);
        assert.equal(t.reports.length, 1);
        assert.match(t.reports[0], /^Amiricord logo: the logo is not an image given in the address/);
    });

    it("reports and does not throw when the engine refuses to add (the plugin has stopped)", () => {
        const t = setup({ on: true });
        for (const undo of t.disposers.splice(0)) undo();
        const late = setup({ on: true });
        late.logo.apply();
        for (const undo of late.disposers.splice(0)) undo();
        late.logo.stop();
        assert.doesNotThrow(() => late.logo.apply());
        assert.equal(late.reports.length, 1);
        assert.match(late.reports[0], /has stopped/);
    });

    it("stop takes the style out and can be called twice", () => {
        const t = setup({ on: true });
        t.logo.apply();
        t.logo.stop();
        t.logo.stop();
        assert.equal(t.elements.length, 0);
        assert.equal(t.logo.applied(), false);
    });

    it("goes with everything else the plugin added when the plugin stops", () => {
        const t = setup({ on: true });
        t.logo.apply();
        for (const undo of t.disposers) undo();
        assert.equal(t.elements.length, 0);
    });
});
