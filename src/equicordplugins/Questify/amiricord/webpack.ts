/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- modules found in Discord's webpack have no types */

import type { ComponentType } from "react";

import { currentReact } from "../../../api/jsxRuntime";
import type { PeekFinder } from "../../../webpack/finders";
import { getContext } from "./context";
import { lazyOf } from "./lazy";

type Finders = ReturnType<typeof getContext>["finders"];

function lazyFinder<T>(description: string, make: (finders: Finders) => PeekFinder<T>): { finder(): PeekFinder<T>; value: T; } {
    let finder: PeekFinder<T> | undefined;
    const get = () => (finder ??= make(getContext().finders));
    return { finder: get, value: lazyOf<T>(() => get().get(), description) };
}

export function findByPropsLazy<T = any>(...props: string[]): T {
    return lazyFinder<T>(`props(${props.join(", ")})`, finders => finders.byProps<T>(...props)).value;
}

export function findByCodeLazy<T = any>(...snippets: string[]): T {
    return lazyFinder<T>(`code(${snippets.join(", ")})`, finders => finders.byCode<T>(...snippets)).value;
}

export function findStoreLazy<T = any>(name: string): T {
    return lazyFinder<T>(`store(${name})`, finders => finders.byStore<T>(name)).value;
}

export function findComponentByCodeLazy<T extends ComponentType<any> = ComponentType<any>>(...snippets: string[]): T {
    const { finder } = lazyFinder<unknown>(`component(${snippets.join(", ")})`, finders => finders.componentByCode(...snippets));
    const Lazy = (props: Record<string, unknown>) => {
        const Component = finder().get();
        return Component ? currentReact().createElement(Component, props) : null;
    };
    Lazy.displayName = `QuestifyLazy(${snippets[0] ?? ""})`;
    return Lazy as unknown as T;
}

export const onceReady: PromiseLike<void> = {
    then<R1 = void, R2 = never>(onFulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
        return getContext().finders.byProps("dispatch", "subscribe").ready().then(() => undefined).then(onFulfilled, onRejected);
    }
};
