/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- the pieces are drawn with React's createElement, which has no types here (as in Themes and ProfilePresets) */

// A small way for a plugin to show a list or a form in Amiricord's own look: a tab in the settings, or a window. The plugin gives a function that draws the content
// with `panelKit` (see `panelKit.ts`); the function runs inside a React component, so it may call React hooks itself, and `refresh()` draws it again after the plugin
// changed something it keeps. The look (the panel CSS) is added the first time. Nothing here was tried outside the engine's tests and one real Discord.

import { currentReact } from "./jsxRuntime";
import { PANEL_CSS, panelKit } from "./panelKit";

type Kit = ReturnType<typeof panelKit>;

/** Draws the content. `react` is Discord's React, `refresh` draws the content again. */
export type PanelRender = (kit: Kit, react: any, refresh: () => void) => unknown;

/** The part of the plugin context these helpers use. */
export interface PanelHostContext {
    addStyle(css: string, name?: string): unknown;
    components: { Button: { get(): unknown; }; ModalRoot: { get(): unknown; }; ModalContent: { get(): unknown; }; ModalCloseButton: { get(): unknown; }; };
    settingsTabs: { add(tab: { title: string; panelTitle?: string; Component: unknown; icon?: () => unknown; }): boolean; };
    modals: { open(render: (props: { onClose(): void; }) => unknown): string | undefined; };
}

/** A component that draws `render` and draws it again when `refresh` is called (or when `subscribe` says the data changed). */
export function panelComponent(ctx: PanelHostContext, render: PanelRender, subscribe?: (listener: () => void) => () => void) {
    return function PanelComponent() {
        const react = currentReact() as any;
        const [, setTick] = react.useState(0) as [number, (value: number) => void];
        const refresh = () => { setTick(Date.now() + Math.random()); };
        react.useEffect(() => subscribe?.(refresh), []);
        return render(panelKit({ react, Button: ctx.components.Button.get() }), react, refresh);
    };
}

/** A tab in the Amiricord settings. Returns false when the engine did not accept the tab. */
export function addPanelTab(ctx: PanelHostContext, options: { title: string; panelTitle?: string; render: PanelRender; subscribe?: (listener: () => void) => () => void; }): boolean {
    ctx.addStyle(PANEL_CSS, "panel");
    return ctx.settingsTabs.add({ title: options.title, panelTitle: options.panelTitle, Component: panelComponent(ctx, options.render, options.subscribe) });
}

/** A window with the content. Returns false when Discord's window pieces were not found. */
export function openPanelWindow(ctx: PanelHostContext, title: string, render: PanelRender): boolean {
    const react = currentReact() as any;
    const h = react.createElement;
    const Root = ctx.components.ModalRoot.get() as any;
    const Content = ctx.components.ModalContent.get() as any;
    const Close = ctx.components.ModalCloseButton.get() as any;
    if (!Root || !Content) return false;
    ctx.addStyle(PANEL_CSS, "panel");
    const Body = panelComponent(ctx, render);
    return ctx.modals.open(props => h(Root, { size: "medium", onClose: props.onClose, label: title }, h(Content, null,
        h("div", { style: { padding: "16px" } }, h("h2", { style: { color: "var(--header-primary, #f2f3f5)", margin: "0 0 8px" } }, title), h(Body))),
    Close ? h(Close, { onClick: props.onClose }) : null)) !== undefined;
}
