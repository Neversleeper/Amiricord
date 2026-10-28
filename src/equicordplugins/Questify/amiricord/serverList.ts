/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) by szlcx404 from the plugin Questify (author Etorix) as found in Equicord.

import type { ComponentType } from "react";

import type { ReactLike } from "../../../api/common";
import { currentReact } from "../../../api/jsxRuntime";
import { reportProblem, reportProblemOnce } from "./context";

export enum ServerListRenderPosition {
    Above,
    In
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the elements are React components with props of their own (as Vencord's API took them)
type Render = ComponentType<any>;

const elements: Record<ServerListRenderPosition, Render[]> = {
    [ServerListRenderPosition.Above]: [],
    [ServerListRenderPosition.In]: []
};

const listeners = new Set<() => void>();
let version = 0;

const keyOf = new WeakMap<Render, string>();
let nextKey = 0;

function keyFor(render: Render): string {
    let key = keyOf.get(render);
    if (key === undefined) {
        key = `amiricord-server-list-${nextKey++}`;
        keyOf.set(render, key);
    }
    return key;
}

function changed(): void {
    version++;
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (error) {
            reportProblem("server list", error);
        }
    }
}

export function addServerListElement(position: ServerListRenderPosition, render: Render): void {
    const list = elements[position];
    if (!list || list.includes(render)) return;
    list.push(render);
    changed();
}

export function removeServerListElement(position: ServerListRenderPosition, render: Render): void {
    const list = elements[position];
    const index = list ? list.indexOf(render) : -1;
    if (index < 0) return;
    list.splice(index, 1);
    changed();
}

interface WrapperProps {
    __amiricordOriginal?: Render;
    [prop: string]: unknown;
}

export function ServerListWrapper(props: WrapperProps): unknown {
    const react: ReactLike = currentReact();
    const drawnVersion = version;
    const [, redraw] = react.useState(0);

    react.useEffect(() => {
        const onChange = () => redraw(n => n + 1);
        listeners.add(onChange);
        if (version !== drawnVersion) onChange();
        return () => { listeners.delete(onChange); };
    }, []);

    const { __amiricordOriginal: Original, ...rest } = props;
    const original = Original ? react.createElement(Original, { ...rest, key: "amiricord-server-list-original" }) : null;

    try {
        const draw = (render: Render) => react.createElement(render, { key: keyFor(render) });
        const above = elements[ServerListRenderPosition.Above].map(draw);
        const inside = elements[ServerListRenderPosition.In].map(draw);
        return react.createElement(react.Fragment, null, ...above, original, ...inside);
    } catch (error) {
        reportProblemOnce("server list", `could not draw the added elements: ${error instanceof Error ? error.message : String(error)}`);
        return original;
    }
}
