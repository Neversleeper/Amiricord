/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Every tab is drawn inside this. If a tab throws while drawing, the person sees a message and a "Try again" button instead of a
// blank settings window, and the error goes to the health report. Needs React's `Component` base class, which only the real React has,
// so the class is made when React is known and not before.

import type { ReactLike } from "../../api/common";

interface BoundaryProps {
    /** What is being drawn, for the message and the report ("Plugins tab"). */
    label: string;
    children?: unknown;
}

interface BoundaryState {
    failed: boolean;
    message: string;
}

type ComponentBase = new (props: BoundaryProps) => { props: BoundaryProps; state: BoundaryState; setState(state: BoundaryState): void; };

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The boundary class for this React. `report` is told about each error, with the label of what failed. */
export function makeErrorBoundary(react: ReactLike, report: (label: string, error: unknown) => void): (props: BoundaryProps) => unknown {
    const Base = react.Component as ComponentBase | undefined;
    // Without React's base class there is nothing to catch with; the tab is drawn as it is.
    if (typeof Base !== "function") return props => props.children;

    class Boundary extends Base {
        state: BoundaryState = { failed: false, message: "" };

        static getDerivedStateFromError(error: unknown): BoundaryState {
            return { failed: true, message: describe(error).slice(0, 300) };
        }

        componentDidCatch(error: unknown) {
            try {
                report(this.props.label, error);
            } catch {
                // Reporting must not make the failure worse.
            }
        }

        render() {
            if (!this.state.failed) return this.props.children;
            return (
                <div className="amiricord-error" role="alert">
                    <div className="amiricord-error-title">{this.props.label} could not be drawn</div>
                    <div className="amiricord-error-text">{this.state.message}</div>
                    <button type="button" className="amiricord-button" onClick={() => this.setState({ failed: false, message: "" })}>Try again</button>
                </div>
            );
        }
    }

    return Boundary as unknown as (props: BoundaryProps) => unknown;
}
