/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FindersFor, ReactLike } from "../src/api/common";
import { COMPONENT_SNIPPETS, declareCommon, REACT_PROPS } from "../src/api/discordComponents";
import { FALLBACK_CSS } from "../src/api/fallbackStyles";
import type { Finder } from "../src/webpack/finders";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests look at props whose shapes differ per component
interface FakeElement { type: unknown; props: Record<string, any>; children: unknown[]; }

const react: ReactLike = {
    createElement: (type, props, ...children) => ({ type, props: (props ?? {}) as Record<string, unknown>, children } satisfies FakeElement),
    Fragment: Symbol("fragment"),
    useState: initial => [typeof initial === "function" ? (initial as () => never)() : initial, () => undefined],
    useEffect: () => undefined,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
};

const finderOf = <T>(description: string, value: T | undefined): Finder<T> => ({
    description,
    get: () => value,
    require: () => { if (value === undefined) throw new Error("missing"); return value; },
    ready: () => Promise.resolve(value as T)
});

/** Finders that answer from a table keyed by the snippets joined with "|", and remember what they were asked. */
function fakeFinders(table: Record<string, unknown>) {
    const asked: string[] = [];
    const answer = (kind: string, args: string[]) => { const key = `${kind}:${args.join("|")}`; asked.push(key); return finderOf(key, table[key]); };
    const finders = {
        byProps: (...args: string[]) => answer("props", args),
        byCode: (...args: string[]) => answer("code", args),
        componentByCode: (...args: string[]) => answer("component", args)
    } as unknown as FindersFor;
    return { finders, asked };
}

const key = (name: keyof typeof COMPONENT_SNIPPETS) => `component:${COMPONENT_SNIPPETS[name].join("|")}`;

describe("the window and Discord's dialog box", () => {
    const dialog = () => "discord dialog";

    it("puts our window inside Discord's dialog box when it was found, so Discord's focus lock holds it", () => {
        const { finders } = fakeFinders({ [`props:${REACT_PROPS.join("|")}`]: react, [key("DialogWithLock")]: dialog });
        const parts = declareCommon(finders);
        const Window = parts.ModalRoot.get()!;
        assert.equal(parts.ModalRoot.usingFallback(), false);
        const backdrop = Window({ children: "x" }) as FakeElement;
        assert.equal((backdrop.children[0] as FakeElement).type, dialog);
    });

    it("keeps our plain window when the dialog box is not found, and says so once", () => {
        const misses: string[] = [];
        const { finders } = fakeFinders({ [`props:${REACT_PROPS.join("|")}`]: react });
        const parts = declareCommon(finders, name => misses.push(name));
        const backdrop = parts.ModalRoot.get()!({ children: "x" }) as FakeElement;
        assert.equal((backdrop.children[0] as FakeElement).type, "div");
        assert.equal(parts.ModalRoot.usingFallback(), true);
        parts.ModalRoot.get();
        assert.deepEqual(misses.filter(name => name === "ModalRoot"), ["ModalRoot"]);
    });

    it("finds the strings in the code of Discord's public Dialog as it was read (build 652418), and not in the inner box or the bigger dialog of another module", () => {
        const dialog = "function f(e){let{ref:t,returnRef:n,modal:a=!0,setDialogRef:s,trackingProps:o,trackingComponentName:d=\"Dialog\",...c}=e,_=r.useRef(null);r.useImperativeHandle(t,()=>_.current),r.useEffect(()=>(s?.(_.current),()=>{s?.(null)}),[]);let{trackImpression:E}=(0,u.G9)();return r.useEffect(()=>{null!=E&&null!=o&&E({componentName:d,payload:o})},[E,d,o]),(0,l.tj)(_,{returnRef:n,disable:!a}),(0,i.jsx)(a?A:h,{...c,ref:_})}";
        const innerBox = "function A(e){let{children:t,ref:n,role:r=\"dialog\",...a}=e;return(0,i.jsx)(E.Provider,{value:{firstFocusableItemProps:void 0},children:(0,i.jsxs)(\"div\",{...a,ref:n,\"data-dialog\":\"modal\",role:r,\"aria-modal\":!0,tabIndex:-1,children:[(0,i.jsx)(_,{}),(0,i.jsx)(d.F,{forceLevel:1,children:(0,i.jsx)(o.xp,{containerRef:n,children:t})})]})})}";
        const biggerDialog = "function u(e){let{ref:t,...n}=e,{children:u,impressionType:_,impression:E,disableTrack:A,returnRef:h,...f}=n;return(0,i.jsx)(\"div\",{...f,ref:S,role:\"dialog\",tabIndex:-1,\"aria-modal\":!0})}";
        const all = (source: string) => COMPONENT_SNIPPETS.DialogWithLock.every(snippet => source.includes(snippet));
        assert.equal(all(dialog), true);
        assert.equal(all(innerBox), false, "the inner box is not exported by its module");
        assert.equal(all(biggerDialog), false);
    });

    it("looks the box up by fixed strings that Discord's own dialog has, and by none of the minified names", () => {
        assert.deepEqual([...COMPONENT_SNIPPETS.DialogWithLock], ["setDialogRef:", "trackingComponentName:", "returnRef:"]);
    });
});

describe("declareCommon", () => {
    it("searches for the snippets read from Canary's own code (build 650101)", () => {
        assert.deepEqual(COMPONENT_SNIPPETS, {
            Button: ["loadingStartedLabel", "iconOpticalOffsetMargin"],
            Text: ["tabularNumbers:", "scaleFontToUserSetting:", "lineClamp:"],
            Heading: ["`h${Math.min(", "experiments?.enabledExperiments"],
            DialogWithLock: ["setDialogRef:", "trackingComponentName:", "returnRef:"]
        });
    });

    it("looks React up by its hooks and each component by the snippets of its source, and nothing before get()", () => {
        const { finders, asked } = fakeFinders({});
        declareCommon(finders);
        assert.deepEqual(asked.sort(), [`props:${REACT_PROPS.join("|")}`].concat(["Button", "DialogWithLock", "Heading", "Text"].map(n => key(n as "Button"))).sort());
    });

    it("translates our props to Discord's for the Button, with text labels", () => {
        const calls: Array<Record<string, unknown>> = [];
        const discordButton = (props: Record<string, unknown>) => { calls.push(props); return "discord"; };
        const { finders } = fakeFinders({ [`props:${REACT_PROPS.join("|")}`]: react, [key("Button")]: discordButton });
        const parts = declareCommon(finders);
        const click = () => undefined;
        const Button = parts.Button.get()!;
        assert.equal(Button({ onClick: click, variant: "danger", children: "Remove" }), "discord");
        assert.deepEqual(calls[0], { variant: "critical-primary", size: "md", text: "Remove", onClick: click, disabled: false });
        Button({ children: 3, disabled: true });
        assert.deepEqual(calls[1], { variant: "secondary", size: "md", text: "3", onClick: undefined, disabled: true });
        assert.equal(parts.Button.usingFallback(), false);
    });

    it("hands a button whose label is not plain text to our own button", () => {
        const discordButton = () => { throw new Error("must not be used"); };
        const { finders } = fakeFinders({ [`props:${REACT_PROPS.join("|")}`]: react, [key("Button")]: discordButton });
        const element = declareCommon(finders).Button.get()!({ children: { icon: true } }) as FakeElement;
        assert.equal(element.type, "button");
        assert.match(element.props.className, /amiricord-button/);
    });

    it("maps Heading levels and muted Text to Discord's variants", () => {
        const heading: Array<Record<string, unknown>> = [];
        const text: Array<Record<string, unknown>> = [];
        const { finders } = fakeFinders({
            [`props:${REACT_PROPS.join("|")}`]: react,
            [key("Heading")]: (props: Record<string, unknown>) => { heading.push(props); return null; },
            [key("Text")]: (props: Record<string, unknown>) => { text.push(props); return null; }
        });
        const parts = declareCommon(finders);
        parts.Heading.get()!({ level: 1, children: "a" });
        parts.Heading.get()!({ children: "b" });
        parts.Text.get()!({ muted: true, children: "c" });
        parts.Text.get()!({ children: "d" });
        assert.deepEqual(heading.map(p => p.variant), ["heading-xl/semibold", "heading-lg/semibold"]);
        assert.deepEqual(text.map(p => p.color), ["text-muted", undefined]);
        assert.ok(text.every(p => p.variant === "text-sm/normal"));
    });

    it("uses ours and reports each miss once when Discord's components are not found, and not before React exists", () => {
        const misses: string[] = [];
        const noReact = declareCommon(fakeFinders({}).finders, name => misses.push(name));
        assert.equal(noReact.Button.get(), undefined, "no React, no screen");
        assert.equal(noReact.Text.get(), undefined);
        const { finders } = fakeFinders({ [`props:${REACT_PROPS.join("|")}`]: react });
        const parts = declareCommon(finders, name => misses.push(name));
        const Heading = parts.Heading.get()!;
        parts.Heading.get();
        parts.Button.get();
        assert.equal((Heading({ level: 3, children: "x" }) as FakeElement).type, "h3");
        assert.deepEqual(misses.filter(name => name !== "React").sort(), ["Button", "Heading"]);
        assert.equal(parts.Heading.usingFallback(), true);
    });

    it("gives no component while React is missing, even when Discord's own was found", () => {
        const { finders } = fakeFinders({ [key("Button")]: () => "discord", [key("Text")]: () => "discord" });
        const parts = declareCommon(finders);
        assert.equal(parts.Button.get(), undefined);
        assert.equal(parts.Text.get(), undefined);
    });

    it("keeps Switch, text input and drop-down on our own until they are sampled, and says so", () => {
        const { finders } = fakeFinders({ [`props:${REACT_PROPS.join("|")}`]: react });
        const parts = declareCommon(finders);
        for (const entry of [parts.Switch, parts.TextInput, parts.Select]) assert.ok(entry.get());
        assert.deepEqual(parts.common.status().filter(s => s.source === "fallback").map(s => s.name).sort(), ["Select", "Switch", "TextInput"]);
    });
});

describe("fallback styles", () => {
    it("lead with the variable names Canary has today", () => {
        const rule = (selector: string) => FALLBACK_CSS.split("\n").find(line => line.startsWith(selector + " {")) ?? "";
        assert.ok(rule(".amiricord-card").includes("background: var(--card-background-default, var(--background-secondary,"));
        assert.ok(rule(".amiricord-card").includes("color: var(--text-default, var(--text-normal,"));
        assert.ok(rule(".amiricord-text").includes("color: var(--text-default, var(--text-normal,"));
        assert.ok(rule(".amiricord-heading").includes("color: var(--text-default, var(--header-primary,"));
        assert.ok(rule(".amiricord-divider").includes("var(--border-subtle, var(--background-modifier-accent,"));
        assert.ok(rule(".amiricord-button").includes("var(--interactive-background-default, var(--button-secondary-background,"));
        assert.ok(FALLBACK_CSS.includes("var(--input-background-default, var(--input-background,"));
    });
});
