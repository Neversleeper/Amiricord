/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Common, ReactLike } from "../src/api/common";
import { makeFallbackComponents } from "../src/api/fallbackComponents";
import { FALLBACK_CSS } from "../src/api/fallbackStyles";
import type { Finder } from "../src/webpack/finders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests call handlers whose shapes differ per component
interface FakeElement { type: unknown; props: Record<string, any>; children: unknown[]; }

/** A React stand-in that records what was asked for, as plain objects. */
const react: ReactLike = {
    createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies FakeElement),
    Fragment: Symbol("fragment"),
    useState: initial => [typeof initial === "function" ? (initial as () => never)() : initial, () => undefined],
    useEffect: () => undefined,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
};

/** A finder that answers with a fixed value (or nothing) and counts its lookups. */
function finder<T>(value: T | undefined) {
    let lookups = 0;
    const f: Finder<T> = {
        description: "fake",
        get: () => { lookups++; return value; },
        require: () => { if (value === undefined) throw new Error("missing"); return value; },
        ready: () => Promise.resolve(value as T)
    };
    return { finder: f, lookups: () => lookups };
}

describe("Common", () => {
    it("uses Discord's component when the finder finds it, and never builds ours", () => {
        const misses: string[] = [];
        const common = new Common(name => misses.push(name));
        const discordButton = () => "discord button";
        let built = 0;
        const reactEntry = common.react(finder(react).finder);
        const entry = common.component("Button", finder(discordButton).finder, () => { built++; return () => "ours"; }, reactEntry);
        assert.equal(entry.get(), discordButton);
        assert.equal(built, 0);
        assert.equal(entry.usingFallback(), false);
        assert.deepEqual(misses, []);
    });

    it("uses ours when Discord's is missing, builds it once, and reports the miss once", () => {
        const misses: string[] = [];
        const common = new Common(name => misses.push(name));
        let built = 0;
        const reactEntry = common.react(finder(react).finder);
        const entry = common.component("Switch", finder<() => string>(undefined).finder, () => { built++; return () => "ours"; }, reactEntry);
        const first = entry.get();
        const second = entry.get();
        assert.equal(first, second);
        assert.equal(first?.(), "ours");
        assert.equal(built, 1);
        assert.equal(entry.usingFallback(), true);
        assert.deepEqual(misses, ["Switch"]);
    });

    it("keeps looking: a component Discord loads later replaces ours the next time it is asked for", () => {
        const common = new Common();
        const state: { present?: () => string; } = {};
        const f: Finder<() => string> = { description: "late", get: () => state.present, require: () => state.present!, ready: () => Promise.resolve(state.present!) };
        const entry = common.component("Late", f, () => () => "ours", common.react(finder(react).finder));
        assert.equal(entry.get()?.(), "ours");
        state.present = () => "discord";
        assert.equal(entry.get()?.(), "discord");
    });

    it("gives undefined, not a crash, when React itself is missing, and says so", () => {
        const misses: string[] = [];
        const common = new Common(name => misses.push(name));
        const reactEntry = common.react(finder<ReactLike>(undefined).finder);
        const entry = common.component("Card", finder<() => string>(undefined).finder, () => () => "ours", reactEntry);
        assert.equal(reactEntry.get(), undefined);
        assert.equal(entry.get(), undefined);
        assert.ok(misses.includes("React"));
    });

    it("survives a report function that throws", () => {
        const common = new Common(() => { throw new Error("reporting failed"); });
        const entry = common.component("Card", finder<() => string>(undefined).finder, () => () => "ours", common.react(finder(react).finder));
        assert.equal(entry.get()?.(), "ours");
    });

    it("says where each piece came from, for the status screen", () => {
        const common = new Common();
        const reactEntry = common.react(finder(react).finder);
        const found = common.component("Found", finder<() => string>(() => "d").finder, () => () => "o", reactEntry);
        const missing = common.component("Missing", finder<() => string>(undefined).finder, () => () => "o", reactEntry);
        common.component("Unused", finder<() => string>(() => "d").finder, () => () => "o", reactEntry);
        found.get();
        missing.get();
        reactEntry.get();
        assert.deepEqual(common.status(), [
            { name: "React", source: "discord" }, { name: "Found", source: "discord" }, { name: "Missing", source: "fallback" }, { name: "Unused", source: "not-looked-up" }
        ]);
    });
});

describe("the fallback components", () => {
    const parts = makeFallbackComponents(react);
    const el = (value: unknown) => value as FakeElement;

    it("Switch is a button with the switch role that flips the value, and does nothing when disabled", () => {
        const changes: boolean[] = [];
        const on = el(parts.Switch({ checked: true, onChange: v => changes.push(v), label: "Dark" }));
        assert.equal(on.type, "button");
        assert.equal(on.props.role, "switch");
        assert.equal(on.props["aria-checked"], true);
        assert.equal(on.props["aria-label"], "Dark");
        assert.match(on.props.className, /amiricord-switch-on/);
        on.props.onClick();
        el(parts.Switch({ checked: false, onChange: v => changes.push(v) })).props.onClick();
        el(parts.Switch({ checked: false, onChange: v => changes.push(v), disabled: true })).props.onClick();
        assert.deepEqual(changes, [false, true]);
    });

    it("Button calls onClick unless disabled, and marks its variant", () => {
        let clicks = 0;
        const primary = el(parts.Button({ onClick: () => { clicks++; }, variant: "primary", children: "Go" }));
        assert.match(primary.props.className, /amiricord-button-primary/);
        assert.deepEqual(primary.children, ["Go"]);
        primary.props.onClick();
        el(parts.Button({ onClick: () => { clicks++; }, disabled: true })).props.onClick();
        assert.equal(clicks, 1);
        assert.match(el(parts.Button({})).props.className, /amiricord-button-secondary/);
    });

    it("TextInput gives the typed text back", () => {
        const seen: string[] = [];
        const input = el(parts.TextInput({ value: "a", onChange: v => seen.push(v), placeholder: "Search" }));
        assert.equal(input.type, "input");
        assert.equal(input.props.value, "a");
        assert.equal(input.props.placeholder, "Search");
        input.props.onChange({ target: { value: "ab" } });
        assert.deepEqual(seen, ["ab"]);
    });

    it("Select gives back the option's own value (a number stays a number) and ignores a value that is not an option", () => {
        const seen: Array<string | number> = [];
        const select = el(parts.Select({ value: 2, options: [{ label: "One", value: 1 }, { label: "Two", value: 2 }, { label: "Other", value: "x" }], onChange: v => seen.push(v) }));
        assert.equal(select.type, "select");
        assert.equal(select.children.length, 3);
        select.props.onChange({ target: { value: "1" } });
        select.props.onChange({ target: { value: "x" } });
        select.props.onChange({ target: { value: "nope" } });
        assert.deepEqual(seen, [1, "x"]);
    });

    it("Badge, Heading, Text, Card and Divider have class names to style, and unknown tones fall back to neutral", () => {
        assert.match(el(parts.Badge({ tone: "danger" })).props.className, /amiricord-badge-danger/);
        assert.match(el(parts.Badge({ tone: "weird" as never })).props.className, /amiricord-badge-neutral/);
        assert.equal(el(parts.Heading({ level: 3 })).type, "h3");
        assert.equal(el(parts.Heading({})).type, "h2");
        assert.match(el(parts.Text({ muted: true })).props.className, /amiricord-text-muted/);
        assert.equal(el(parts.Card({})).props.className, "amiricord-card");
        assert.equal(el(parts.Divider()).type, "hr");
    });

    it("every class the components use has a rule in the styles", () => {
        const used = new Set<string>();
        const add = (e: unknown) => String(el(e).props.className ?? "").split(" ").forEach(c => used.add(c));
        [parts.Button({ variant: "primary" }), parts.Button({ variant: "danger" }), parts.Switch({ checked: true, onChange: () => undefined }), parts.TextInput({ value: "", onChange: () => undefined }),
            parts.Select({ value: 1, options: [], onChange: () => undefined }), parts.Card({}), parts.Badge({ tone: "good" }), parts.Badge({ tone: "warning" }),
            parts.Badge({ tone: "danger" }), parts.Heading({ level: 1 }), parts.Heading({ level: 3 }), parts.Text({ muted: true }), parts.Divider()].forEach(add);
        // The whole class name, not just its beginning: `.amiricord-dividerX` is not a rule for `.amiricord-divider`.
        for (const name of used) assert.ok(new RegExp(`\\.${name}(?![\\w-])`).test(FALLBACK_CSS), `no style for .${name}`);
    });
});
