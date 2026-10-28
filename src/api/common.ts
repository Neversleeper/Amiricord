/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The things a plugin's screens are built from: React, and the small components (button, switch, text box...).
// The real ones are Discord's own, found in its modules, so a tab looks exactly like the rest of Discord.
// Every component has a fallback of ours: if Discord changes a name and the finder misses, the screen still works
// (a little plainer) and the miss is recorded so the owner can see which component needs a fix.
// Design: docs/design-03-settings.md piece C.

import type { Finder } from "../webpack/finders";

/** The part of React this layer needs. The real React (found in Discord) and a test double both fit. */
export interface ReactLike {
    createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
    Fragment: unknown;
    useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T;
    /** Present in the real React; a plugin that needs them asks through `currentReact()` and gets a clear error when a test double has none. */
    useRef?<T>(initial: T): { current: T; };
    useMemo?<T>(factory: () => T, deps: readonly unknown[]): T;
    useLayoutEffect?(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    /** The base class of class components. Present in the real React; needed only by the error boundary of the settings tabs. */
    Component?: unknown;
}

export type FindersFor = { byProps<T = unknown>(...props: string[]): Finder<T>; byCode<T = unknown>(...snippets: string[]): Finder<T>; componentByCode<T = unknown>(...snippets: string[]): Finder<T>; };

export interface CommonEntry<T> {
    readonly name: string;
    /** Discord's component if the finder found it, ours otherwise. Never undefined (except `react`, which has no stand-in). */
    get(): T;
    /** True once the finder has missed and our own is in use. */
    usingFallback(): boolean;
}

export interface CommonStatus {
    name: string;
    source: "discord" | "fallback" | "not-looked-up";
}

export class Common {
    private readonly entries: Array<CommonEntry<unknown>> = [];
    private readonly fallbackNames = new Set<string>();
    private readonly foundNames = new Set<string>();
    private reactValue: ReactLike | undefined;

    /** `onFallback` is told once per component that had to use ours (it feeds the health report). */
    constructor(private readonly onFallback: (name: string) => void = () => undefined) { }

    private note(name: string, fallback: boolean) {
        if (fallback && !this.fallbackNames.has(name)) {
            this.fallbackNames.add(name);
            try {
                this.onFallback(name);
            } catch {
                // Reporting must never break a screen.
            }
        }
        if (!fallback) this.foundNames.add(name);
    }

    /** Declare React, found with this finder. There is no stand-in for React: until it is found, `get()` gives undefined and screens do not render. */
    react(finder: Finder<ReactLike>): CommonEntry<ReactLike | undefined> {
        const entry: CommonEntry<ReactLike | undefined> = {
            name: "React",
            get: () => {
                this.reactValue ??= finder.get();
                if (!this.reactValue) this.note("React", true);
                else this.note("React", false);
                return this.reactValue;
            },
            usingFallback: () => this.fallbackNames.has("React")
        };
        this.entries.push(entry);
        return entry;
    }

    /**
     * Declare one component: Discord's if `finder` finds it, otherwise `makeFallback(React)`.
     * `makeFallback` runs at most once, and only if React is available.
     */
    component<T>(name: string, finder: Finder<T>, makeFallback: (react: ReactLike) => T, reactEntry: CommonEntry<ReactLike | undefined>): CommonEntry<T | undefined> {
        let discord: T | undefined;
        let fallback: T | undefined;
        const entry: CommonEntry<T | undefined> = {
            name,
            get: () => {
                if (discord !== undefined) return discord;
                discord = finder.get();
                if (discord !== undefined) {
                    this.note(name, false);
                    return discord;
                }
                if (fallback === undefined) {
                    const react = reactEntry.get();
                    if (!react) return undefined;
                    fallback = makeFallback(react);
                }
                this.note(name, true);
                return fallback;
            },
            usingFallback: () => this.fallbackNames.has(name)
        };
        this.entries.push(entry);
        return entry;
    }

    /** Which source each declared piece has used so far, for the status screen. */
    status(): CommonStatus[] {
        return this.entries.map(entry => ({
            name: entry.name,
            source: this.fallbackNames.has(entry.name) ? "fallback" : this.foundNames.has(entry.name) ? "discord" : "not-looked-up"
        }));
    }
}
