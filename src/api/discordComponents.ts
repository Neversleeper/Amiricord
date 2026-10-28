/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which of Discord's own components the common layer looks for, and how each one is found. The snippets are pieces of
// the components' source that the discovery run on Canary read (docs/analysis-09-settings-core.md section 9); names of
// props survive minification, names of local variables do not, so only prop names and fixed strings are used.
// Our props are translated to Discord's by a small adapter. Switch, text input, drop-down and the five pieces of a window (root, header, content, footer, close button)
// are not here yet: they were not on screen during the discovery, so they stay on our fallbacks until they are sampled. Guessing their snippets from another mod's code
// could match the wrong component and break a window, so none is tried: the slot exists, and a sampled snippet only has to be added to `COMPONENT_SNIPPETS`.

import type { Finder } from "../webpack/finders";
import { Common, CommonEntry, FindersFor, ReactLike } from "./common";
import { type ButtonProps, type DialogBox, type FallbackComponents, type HeadingProps, makeFallbackComponents, type ModalCloseButtonProps, type ModalPartProps, type TextProps } from "./fallbackComponents";

/** The hooks that identify React among Discord's modules. */
export const REACT_PROPS = ["useState", "useEffect", "createElement", "useSyncExternalStore"] as const;

/** Code snippets per component; all of them must be in the same function's source. */
export const COMPONENT_SNIPPETS = {
    Button: ["loadingStartedLabel", "iconOpticalOffsetMargin"],
    Text: ["tabularNumbers:", "scaleFontToUserSetting:", "lineClamp:"],
    Heading: ["`h${Math.min(", "experiments?.enabledExperiments"],
    /** Discord's public Dialog, which draws the box with its focus lock (build 652418, sampled by the dev probe, docs/analysis-51). Fixed strings only. */
    DialogWithLock: ["setDialogRef:", "trackingComponentName:", "returnRef:"],
    /** Discord's window pieces, all in one small module (build 653945, read whole by the dev probe). Each snippet list must be in that one function only. Only the content and the close button are used: Discord's header and footer lay their children out with its own flex constants (the close button stayed next to the title and the buttons of the footer touched each other in our window), so those two stay ours. */
    ModalContent: ["scrollerRef", "scrollbarType", "scrollbarGutter"],
    ModalCloseButton: ["focusProps", "withCircleBackground", "hideOnFullscreen"]
} as const;

type Component<P> = (props: P) => unknown;

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = { primary: "primary", secondary: "secondary", danger: "critical-primary" };
const HEADING_VARIANTS = { 1: "heading-xl/semibold", 2: "heading-lg/semibold", 3: "heading-md/semibold" } as const;

/** A finder whose answer is Discord's component wrapped by `wrap`. A miss of the original is a miss of this one. */
function adapted<D, T>(finder: Finder<D>, react: CommonEntry<ReactLike | undefined>, wrap: (original: D, react: ReactLike) => T): Finder<T> {
    let source: D | undefined;
    let result: T | undefined;
    const get = (): T | undefined => {
        const original = finder.get();
        if (original === undefined) return undefined;
        const lib = react.get();
        if (!lib) return undefined;
        if (result === undefined || source !== original) {
            source = original;
            result = wrap(original, lib);
        }
        return result;
    };
    return {
        description: finder.description,
        get,
        require: () => {
            const value = get();
            if (value === undefined) throw new Error(`${finder.description} was not found`);
            return value;
        },
        ready: async (timeoutMs?: number) => {
            await finder.ready(timeoutMs);
            const value = get();
            if (value === undefined) throw new Error(`${finder.description} was not found`);
            return value;
        }
    };
}

export interface CommonParts {
    common: Common;
    react: CommonEntry<ReactLike | undefined>;
    Button: CommonEntry<FallbackComponents["Button"] | undefined>;
    Text: CommonEntry<FallbackComponents["Text"] | undefined>;
    Heading: CommonEntry<FallbackComponents["Heading"] | undefined>;
    Switch: CommonEntry<FallbackComponents["Switch"] | undefined>;
    TextInput: CommonEntry<FallbackComponents["TextInput"] | undefined>;
    Select: CommonEntry<FallbackComponents["Select"] | undefined>;
    ModalRoot: CommonEntry<FallbackComponents["ModalRoot"] | undefined>;
    ModalHeader: CommonEntry<FallbackComponents["ModalHeader"] | undefined>;
    ModalContent: CommonEntry<FallbackComponents["ModalContent"] | undefined>;
    ModalFooter: CommonEntry<FallbackComponents["ModalFooter"] | undefined>;
    ModalCloseButton: CommonEntry<FallbackComponents["ModalCloseButton"] | undefined>;
}

/** The components a plugin may ask for through `ctx.components`, in the order they are declared. */
export const COMPONENT_NAMES = ["Button", "Text", "Heading", "Switch", "TextInput", "Select", "ModalRoot", "ModalHeader", "ModalContent", "ModalFooter", "ModalCloseButton"] as const;

/** What `ctx.components` gives a plugin: React and each component, each one Discord's if it was found and ours if not. `get()` is undefined only before React exists. */
export type PluginComponents = Pick<CommonParts, typeof COMPONENT_NAMES[number] | "react">;

/** Declare React and every component with its finder and fallback. Nothing is looked up until `get()` is called. */
export function declareCommon(finders: FindersFor, onFallback?: (name: string) => void): CommonParts {
    const common = new Common(onFallback);
    const react = common.react(finders.byProps<ReactLike>(...REACT_PROPS));
    const none = <T>(name: string) => ({ description: `none:${name}`, get: (): T | undefined => undefined, require: (): T => { throw new Error(name); }, ready: (): Promise<T> => Promise.reject(new Error(name)) });
    const own = <K extends keyof FallbackComponents>(name: K) => (lib: ReactLike): FallbackComponents[K] => makeFallbackComponents(lib)[name];

    const Button = common.component("Button", adapted(finders.componentByCode<Component<Record<string, unknown>>>(...COMPONENT_SNIPPETS.Button), react,
        (original, lib): FallbackComponents["Button"] => {
            const ours = makeFallbackComponents(lib).Button;
            // Discord's button takes its label as `text`; anything that is not plain text goes to our own button.
            return ({ onClick, disabled, variant = "secondary", children }: ButtonProps) => typeof children === "string" || typeof children === "number"
                ? original({ variant: BUTTON_VARIANTS[variant] ?? "secondary", size: "md", text: String(children), onClick, disabled: !!disabled })
                : ours({ onClick, disabled, variant, children });
        }
    ), own("Button"), react);

    const Text = common.component("Text", adapted(finders.componentByCode<Component<Record<string, unknown>>>(...COMPONENT_SNIPPETS.Text), react,
        (original): FallbackComponents["Text"] => ({ muted, children }: TextProps) =>
            original({ variant: "text-sm/normal", color: muted ? "text-muted" : undefined, children })
    ), own("Text"), react);

    const Heading = common.component("Heading", adapted(finders.componentByCode<Component<Record<string, unknown>>>(...COMPONENT_SNIPPETS.Heading), react,
        (original): FallbackComponents["Heading"] => ({ level = 2, children }: HeadingProps) =>
            original({ variant: HEADING_VARIANTS[level] ?? HEADING_VARIANTS[2], children })
    ), own("Heading"), react);

    return {
        common, react, Button, Text, Heading,
        Switch: common.component("Switch", none<FallbackComponents["Switch"]>("Switch"), own("Switch"), react),
        TextInput: common.component("TextInput", none<FallbackComponents["TextInput"]>("TextInput"), own("TextInput"), react),
        Select: common.component("Select", none<FallbackComponents["Select"]>("Select"), own("Select"), react),
        // Our window inside Discord's own dialog box, so Discord's focus lock knows it and a text field keeps the focus; ours alone when that box was not found.
        ModalRoot: common.component("ModalRoot", adapted(finders.componentByCode<DialogBox>(...COMPONENT_SNIPPETS.DialogWithLock), react,
            (dialogBox, lib): FallbackComponents["ModalRoot"] => makeFallbackComponents(lib, undefined, dialogBox).ModalRoot
        ), own("ModalRoot"), react),
        // Discord's own pieces, drawn as elements (they use hooks), with only the props our window pieces take. Their context has a default, so they work outside Discord's own window.
        ModalHeader: common.component("ModalHeader", none<FallbackComponents["ModalHeader"]>("ModalHeader"), own("ModalHeader"), react),
        ModalContent: common.component("ModalContent", adapted(finders.componentByCode<Component<Record<string, unknown>>>(...COMPONENT_SNIPPETS.ModalContent), react,
            (original, lib): FallbackComponents["ModalContent"] => ({ className, children }: ModalPartProps) => lib.createElement(original, { className }, children)
        ), own("ModalContent"), react),
        ModalFooter: common.component("ModalFooter", none<FallbackComponents["ModalFooter"]>("ModalFooter"), own("ModalFooter"), react),
        ModalCloseButton: common.component("ModalCloseButton", adapted(finders.componentByCode<Component<Record<string, unknown>>>(...COMPONENT_SNIPPETS.ModalCloseButton), react,
            (original, lib): FallbackComponents["ModalCloseButton"] => ({ onClick }: ModalCloseButtonProps) => lib.createElement(original, { onClick })
        ), own("ModalCloseButton"), react)
    };
}
