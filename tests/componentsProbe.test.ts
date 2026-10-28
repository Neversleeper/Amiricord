/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildComponentsReport, cssVariables, ELEMENT_KINDS, REACT_PROPS, reactReport, sampleElements } from "../src/renderer/probes/componentsProbe";
import type { Finder } from "../src/webpack/finders";

/** A style declaration the way a browser exposes it: indexed names and a getter for values. */
function style(values: Record<string, string>) {
    const names = Object.keys(values);
    const declaration: Record<string, unknown> = { length: names.length, getPropertyValue: (name: string) => values[name] ?? "" };
    names.forEach((name, i) => { declaration[i] = name; });
    return declaration;
}

const rule = (selectorText: string, values: Record<string, string>) => ({ selectorText, style: style(values) });
const sheet = (...rules: unknown[]) => ({ cssRules: rules });

const finder = (value: unknown): Finder<unknown> => ({ description: "fake", get: () => value, require: () => value, ready: () => Promise.resolve(value) });

describe("cssVariables", () => {
    it("collects the names and values of custom properties declared on the root and theme rules, sorted", () => {
        const document = {
            querySelectorAll: () => [],
            styleSheets: [
                sheet(rule(":root", { "--b-color": "#111", "--a-size": "4px", "color": "red" }), rule(".theme-dark", { "--c-text": " #fff " })),
                sheet(rule("html.visual-refresh, .other", { "--d-refresh": "1" }))
            ]
        };
        assert.deepEqual(cssVariables(document), [
            { name: "--a-size", value: "4px" }, { name: "--b-color", value: "#111" }, { name: "--c-text", value: "#fff" }, { name: "--d-refresh", value: "1" }
        ]);
    });

    it("ignores rules of ordinary elements and survives sheets that cannot be read", () => {
        const unreadable = { get cssRules(): never { throw new Error("cross-origin"); } };
        const document = {
            querySelectorAll: () => [],
            styleSheets: [unreadable, sheet(rule(".some-button", { "--hidden": "1" }), rule(":root", { "--shown": "2" }))]
        };
        assert.deepEqual(cssVariables(document), [{ name: "--shown", value: "2" }]);
        assert.deepEqual(cssVariables({ querySelectorAll: () => [] }), []);
    });

    it("cuts long values, redacts ids and e-mail addresses, and stops at the limit", () => {
        const document = {
            querySelectorAll: () => [],
            styleSheets: [sheet(rule(":root", { "--long": "x".repeat(200), "--id": "123456789012345678", "--mail": "a@example.com" }))]
        };
        const result = cssVariables(document);
        assert.equal(result.find(v => v.name === "--long")!.value.length, 60);
        assert.equal(result.find(v => v.name === "--id")!.value, "<id>");
        assert.equal(result.find(v => v.name === "--mail")!.value, "<email>");
        assert.equal(cssVariables(document, 2).length, 2);
    });
});

describe("sampleElements", () => {
    function element(tag: string, className: string, touched: string[]) {
        function Component() { return 1; }
        const fiber: Record<string, unknown> = { type: Component, return: undefined };
        for (const name of ["memoizedProps", "memoizedState", "pendingProps", "stateNode"]) Object.defineProperty(fiber, name, { get() { touched.push(name); throw new Error(name); } });
        const e: Record<string, unknown> = { tagName: tag.toUpperCase(), className, getAttribute: (name: string) => (name === "role" ? "switch" : null), "__reactFiber$x": fiber };
        for (const name of ["textContent", "innerText", "innerHTML", "value"]) Object.defineProperty(e, name, { get() { touched.push(name); throw new Error(name); } });
        return e;
    }

    it("counts each kind, samples at most two, and describes them by tag, role, class names and component functions only", () => {
        const touched: string[] = [];
        const bySelector: Record<string, unknown[]> = {
            [ELEMENT_KINDS.switch]: [element("div", "toggle_abc", touched), element("div", "toggle_def", touched), element("div", "toggle_ghi", touched)],
            [ELEMENT_KINDS.button]: [element("button", "button_x", touched)]
        };
        const result = sampleElements({ querySelectorAll: selector => bySelector[selector] ?? [] });
        assert.equal(result.switch.count, 3);
        assert.equal(result.switch.samples.length, 2);
        assert.deepEqual(result.switch.samples[0], { tag: "div", role: "switch", className: "toggle_abc", components: [{ name: "Component", source: result.switch.samples[0].components[0].source }] });
        assert.match(result.switch.samples[0].components[0].source ?? "", /return 1/);
        assert.equal(result.button.count, 1);
        assert.deepEqual(result.heading, { count: 0, samples: [] });
        assert.deepEqual(touched, [], "text, values, props and state were never read");
    });

    it("gives no samples for a selector the page cannot answer, and an empty class name for non-text classes", () => {
        const result = sampleElements({ querySelectorAll: () => { throw new Error("bad selector"); } });
        assert.deepEqual(result.switch, { count: 0, samples: [] });
        const svg = sampleElements({ querySelectorAll: selector => (selector === ELEMENT_KINDS.heading ? [{ tagName: "H2", className: { baseVal: "x" } }] : []) });
        assert.equal(svg.heading.samples[0].className, "");
    });
});

describe("reactReport", () => {
    it("says whether React was found and which hooks it has", () => {
        const react = { createElement: () => 1, useState: () => 1, useEffect: () => 1, Fragment: Symbol("f"), version: "19" };
        assert.deepEqual(reactReport(finder(react)), { found: true, keyCount: 5, hasFragment: true, hooks: ["useEffect", "useState"] });
        assert.deepEqual(reactReport(finder(undefined)), { found: false, keyCount: 0, hasFragment: false, hooks: [] });
        assert.deepEqual(REACT_PROPS, ["useState", "useEffect", "createElement", "useSyncExternalStore"]);
    });
});

describe("buildComponentsReport", () => {
    it("puts the three parts together", () => {
        const report = buildComponentsReport({
            document: { querySelectorAll: () => [], styleSheets: [sheet(rule(":root", { "--a": "1" }))] },
            react: finder({ createElement: () => 1 })
        });
        assert.equal(report.probe, "components");
        assert.equal(report.react.found, true);
        assert.deepEqual(report.css, [{ name: "--a", value: "1" }]);
        assert.equal(Object.keys(report.dom).length, Object.keys(ELEMENT_KINDS).length);
    });
});
