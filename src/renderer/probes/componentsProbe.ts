/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Development probe, second one: finds out how Discord's own building blocks are named and where they live, so the
// common components layer can look for them by their real code. It writes only: whether React was found, the CSS
// variable names and values of the theme, and for a few kinds of element (switch, button, drop-down, text box,
// heading) the class names and the component functions above them. It never reads text on screen, props or state.
// Only started in dev mode. Design: docs/design-03-settings.md piece C.

import { redact } from "../../shared/health";
import type { Finder } from "../../webpack/finders";
import { DEFAULT_LIMITS, DocumentLike, fiberChain, FiberStep, ProbeLimits } from "./settingsProbe";

/** What the probe needs from the page's document: lookups by selector and the style sheets. */
export interface ComponentsDocument extends DocumentLike {
    styleSheets?: ArrayLike<unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> => (typeof value === "object" && value !== null) || typeof value === "function";

function read(target: unknown, key: string): unknown {
    if (!isObject(target)) return undefined;
    try {
        return target[key];
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// CSS variables of the theme

export interface CssVariable {
    name: string;
    /** The value, cut short. Theme colors and sizes, nothing about the account. */
    value: string;
}

/** Custom properties declared on the root or theme rules of every style sheet that can be read. Names sorted, at most `max`. */
export function cssVariables(document: ComponentsDocument, max = 4000): CssVariable[] {
    const found = new Map<string, string>();
    const sheets = document.styleSheets ? Array.from(document.styleSheets) : [];
    for (const sheet of sheets) {
        let rules: unknown[];
        try {
            rules = Array.from((read(sheet, "cssRules") as ArrayLike<unknown> | undefined) ?? []);
        } catch {
            continue;
        }
        for (const rule of rules) {
            const selector = read(rule, "selectorText");
            if (typeof selector !== "string" || !/(^|[\s,])(:root|html|\.theme-[a-z-]+|\.visual-refresh|\.mana-[a-z-]+|body)(?=$|[\s,.:])/.test(selector)) continue;
            const style = read(rule, "style");
            const count = Number(read(style, "length")) || 0;
            for (let i = 0; i < count && found.size < max; i++) {
                const name = String(read(style, String(i)));
                if (!name.startsWith("--")) continue;
                const getter = read(style, "getPropertyValue");
                const value = typeof getter === "function" ? String(getter.call(style, name)).trim() : "";
                found.set(name, redact(value.slice(0, 60)));
            }
        }
    }
    return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, value]) => ({ name, value }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Elements on screen: names only

export interface ElementSample {
    tag: string;
    role: string | null;
    className: string;
    /** The component functions above the element, with the source of the first few. */
    components: FiberStep[];
}

export interface KindSample {
    count: number;
    samples: ElementSample[];
}

/** The kinds of element the settings screens are made of, and how to spot them. */
export const ELEMENT_KINDS: Record<string, string> = {
    switch: "[role=\"switch\"]",
    button: "button:not([role=\"switch\"])",
    dropdown: "[role=\"combobox\"], [aria-haspopup=\"listbox\"]",
    textInput: "input[type=\"text\"], input[type=\"search\"], textarea",
    heading: "h1, h2, h3"
};

function describeElement(element: unknown, limits: ProbeLimits): ElementSample {
    const className = read(element, "className");
    const getter = read(element, "getAttribute");
    const role = typeof getter === "function" ? getter.call(element, "role") : null;
    return {
        tag: String(read(element, "tagName") ?? "").toLowerCase(),
        role: typeof role === "string" ? role : null,
        // SVG elements keep their class in an object; a plain string is what is wanted.
        className: typeof className === "string" ? redact(className.slice(0, 200)) : "",
        components: fiberChain(element, limits, 6)
    };
}

export function sampleElements(document: DocumentLike, limits: ProbeLimits = DEFAULT_LIMITS, perKind = 2): Record<string, KindSample> {
    const out: Record<string, KindSample> = {};
    for (const [kind, selector] of Object.entries(ELEMENT_KINDS)) {
        let list: unknown[] = [];
        try {
            list = Array.from(document.querySelectorAll(selector));
        } catch {
            // A selector the page cannot answer simply gives no samples.
        }
        out[kind] = { count: list.length, samples: list.slice(0, perKind).map(element => describeElement(element, limits)) };
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// React

export interface ReactReport {
    found: boolean;
    keyCount: number;
    hasFragment: boolean;
    hooks: string[];
}

export const REACT_PROPS = ["useState", "useEffect", "createElement", "useSyncExternalStore"] as const;

export function reactReport(finder: Finder<unknown>): ReactReport {
    const react = finder.get();
    if (!isObject(react)) return { found: false, keyCount: 0, hasFragment: false, hooks: [] };
    let keys: string[] = [];
    try {
        keys = Object.keys(react);
    } catch {
        // Fewer keys is fine.
    }
    return { found: true, keyCount: keys.length, hasFragment: read(react, "Fragment") !== undefined, hooks: keys.filter(key => /^use[A-Z]/.test(key)).sort() };
}

export interface ComponentsReport {
    probe: "components";
    version: 1;
    react: ReactReport;
    css: CssVariable[];
    dom: Record<string, KindSample>;
}

/** The whole report for this moment. Never throws. */
export function buildComponentsReport(env: { document: ComponentsDocument; react: Finder<unknown>; limits?: ProbeLimits; }): ComponentsReport {
    const limits = env.limits ?? DEFAULT_LIMITS;
    return {
        probe: "components",
        version: 1,
        react: reactReport(env.react),
        css: cssVariables(env.document),
        dom: sampleElements(env.document, limits)
    };
}
