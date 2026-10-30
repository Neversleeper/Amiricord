/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Part of the Amiricord port of AutoRedeem (original plugin: TestCord, by x2b and irritably).
 */

// Replaces Vencord's `ErrorBoundary.wrap(Component, { noop: true })`, which the original used so that a screen that fails to draw leaves a blank instead
// of breaking Discord's settings window. Amiricord does not give plugins an error boundary, so one is made here from the `Component` class of the React
// Discord runs. A failure is reported against this plugin (`ctx.reportError`, which feeds the health report) and the screen draws nothing.

import type { ReactLike } from "../../api/common";
import { currentReact } from "../../api/jsxRuntime";
import type { EnginePluginContext } from "../../renderer/engine";

interface BoundaryInstance {
    props: { children?: unknown; };
    state: { failed: boolean; };
}

type BoundaryBase = new (props: unknown) => BoundaryInstance;

function makeBoundary(react: ReactLike, onError: (error: unknown) => void): unknown {
    const Base = react.Component as BoundaryBase | undefined;
    if (!Base) return undefined;
    return class Boundary extends Base {
        state = { failed: false };

        static getDerivedStateFromError() {
            return { failed: true };
        }

        componentDidCatch(error: unknown) {
            onError(error);
        }

        render() {
            return this.state.failed ? null : this.props.children;
        }
    };
}

/** Draw `Inner` inside an error boundary that stays blank (and reports to the health report) when `Inner` fails. */
export function withErrorBoundary<P extends object>(
    ctx: Pick<EnginePluginContext, "reportError">,
    source: string,
    Inner: (props: P) => unknown
): (props: P) => unknown {
    let boundary: unknown;
    return function Guarded(props: P) {
        const react = currentReact();
        boundary ??= makeBoundary(react, error => { ctx.reportError(source, error); });
        // A React without a `Component` class (a test double) draws the screen as it is.
        if (!boundary) return react.createElement(Inner, props);
        return react.createElement(boundary, null, react.createElement(Inner, props));
    };
}
