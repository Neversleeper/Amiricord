/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ComponentType, ReactNode } from "react";

import { currentReact } from "../../../api/jsxRuntime";
import { reportProblem } from "./context";

type Props = Record<string, unknown> & { className?: string; children?: ReactNode; };

const element = (tag: string) => (props: Props) => currentReact().createElement(tag, props) as ReactNode;

export const Card = (props: Props & { variant?: string; }): ReactNode => {
    const { variant: _variant, ...rest } = props;
    return currentReact().createElement("div", rest) as ReactNode;
};
export const Heading = element("h2");
export const Paragraph = element("p");

interface BoundaryProps {
    noop?: boolean;
    children?: ReactNode;
}

let boundaryClass: unknown;

function getBoundaryClass(): unknown {
    if (boundaryClass) return boundaryClass;
    const React = currentReact();
    const Base = React.Component as new (props: BoundaryProps) => { props: BoundaryProps; state: { failed: boolean; }; setState(state: unknown): void; };
    boundaryClass = class QuestifyBoundary extends Base {
        constructor(props: BoundaryProps) {
            super(props);
            this.state = { failed: false };
        }

        static getDerivedStateFromError() {
            return { failed: true };
        }

        componentDidCatch(error: unknown) {
            reportProblem("screen", error);
        }

        render() {
            if (!this.state.failed) return this.props.children ?? null;
            return this.props.noop ? null : currentReact().createElement("div", { className: "questify-error" }, "Questify could not draw this part.");
        }
    };
    return boundaryClass;
}

export function ErrorBoundary(props: BoundaryProps): ReactNode {
    return currentReact().createElement(getBoundaryClass(), props) as ReactNode;
}

ErrorBoundary.wrap = function wrap<P extends object>(Component: ComponentType<P>, boundaryProps: BoundaryProps = {}): ComponentType<P> {
    const Wrapped = (props: P) => currentReact().createElement(ErrorBoundary, boundaryProps, currentReact().createElement(Component, props)) as ReactNode;
    Wrapped.displayName = `QuestifyBoundary(${Component.displayName ?? Component.name ?? "Component"})`;
    return Wrapped as ComponentType<P>;
};

export default ErrorBoundary;
