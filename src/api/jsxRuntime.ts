/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What JSX in a plugin turns into. The build compiles `<Button/>` to calls of `jsx`/`jsxs` from here (esbuild's and
// TypeScript's "automatic" runtime with `jsxImportSource: "@amiricord/jsx"`), and these call the `createElement` of the
// React that Discord itself runs, found by the common layer. Until that React is known, rendering fails with a clear
// message instead of a crash somewhere inside Discord. Design: docs/design-03-settings.md piece D.

import type * as React from "react";

import type { ReactLike } from "./common";

/** Stands for React's fragment in compiled code; swapped for the real `Fragment` when an element is made. */
export const Fragment = Symbol.for("amiricord.fragment");

let source: (() => ReactLike | undefined) | undefined;

/** Tell the runtime where React comes from. It is asked at render time, so it may be found later than this call. */
export function setReactSource(getter: (() => ReactLike | undefined) | undefined): void {
    source = getter;
}

function react(): ReactLike {
    const found = source?.();
    if (!found) throw new Error("React was not found yet, so this screen cannot be drawn");
    return found;
}

/** The React Discord runs, for hooks in a plugin's components. Fails with a clear message while it is not found. */
export const currentReact = react;

type Props = Record<string, unknown> | null | undefined;

function make(type: unknown, props: Props, key: unknown, spreadChildren: boolean): unknown {
    const { children, ...rest } = props ?? {};
    const lib = react();
    const own = key === undefined ? rest : { ...rest, key };
    const kind = type === Fragment ? lib.Fragment : type;
    if (children === undefined) return lib.createElement(kind, own);
    // `jsxs` is used when the children are written out one by one, so they are fixed and need no keys; a single child
    // that is an array (a list built at run time) is passed as it is so React still asks for keys.
    return spreadChildren && Array.isArray(children) ? lib.createElement(kind, own, ...children) : lib.createElement(kind, own, children);
}

export function jsx(type: unknown, props: Props, key?: unknown): unknown {
    return make(type, props, key, false);
}

export function jsxs(type: unknown, props: Props, key?: unknown): unknown {
    return make(type, props, key, true);
}

/**
 * Types for JSX in plugins. The element and attribute types are React's own, taken from `@types/react` as TYPES only (nothing of React is imported at run time; the
 * elements are made by the React Discord runs), so a plugin can type its components with `ReactNode`, `JSX.Element` or `ComponentType` as it would for React.
 * Two things stay permissive: a component may return anything (our own components are made with `createElement` and typed as returning `unknown`), and the
 * attributes of a plain tag are not checked.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace -- TypeScript looks JSX types up in a namespace of this name
export namespace JSX {
    export type ElementType = React.JSX.ElementType | ((props: never) => unknown);
    export type Element = React.JSX.Element;
    export type ElementClass = React.JSX.ElementClass;
    export type ElementAttributesProperty = React.JSX.ElementAttributesProperty;
    export type ElementChildrenAttribute = React.JSX.ElementChildrenAttribute;
    export type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
    export type IntrinsicAttributes = React.JSX.IntrinsicAttributes;
    export type IntrinsicClassAttributes<T> = React.JSX.IntrinsicClassAttributes<T>;
    export interface IntrinsicElements { [tag: string]: Record<string, unknown>; }
}
