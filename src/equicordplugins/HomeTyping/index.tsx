/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Discord's stores and components have no types */

// Adapted for Amiricord (2026) from the plugin HomeTyping (author Samwich) of Equicord. Both patches were checked against the text of Discord's web build
// (module with `.BUTTON_HOME}`): the home button draws `children:(0,r.jsx)(nu,{})` right after the analytics object, and the same function starts with `if(null==n)return null;`.
// The original asked Vencord's `useStateFromStores`; here the hook is written with React's own hooks. Not tried in a real Discord at the time of writing.

import { currentReact } from "../../api/jsxRuntime";
import type { PluginCode } from "../../renderer/engine";

// The finders are kept and asked when used: the stores are not in Discord's modules yet when the plugin starts.
type Lazy = { get(): any; } | undefined;
let typingStore: Lazy;
let channelSortStore: Lazy;
let userStore: Lazy;
let threeDots: Lazy;

/** Re-draws the caller when one of the stores changes, like Discord's own hook. The same hooks are called on every draw, whatever is found. */
function useStores(stores: any[], read: () => boolean): boolean {
    const react = currentReact() as any;
    const [, redraw] = react.useState(0) as [number, (update: (n: number) => number) => void];
    const value = read();
    react.useEffect(() => {
        const listener = () => redraw(n => n + 1);
        const live = stores.filter(store => typeof store?.addChangeListener === "function");
        live.forEach(store => store.addChangeListener(listener));
        return () => live.forEach(store => store.removeChangeListener(listener));
    }, stores);
    return value;
}

const plugin: PluginCode & { TypingIcon(): unknown; isTyping(): boolean; } = {
    patches: [
        {
            find: ".BUTTON_HOME}",
            group: true,
            replacements: [
                {
                    match: /(?<=BUTTON_HOME.{0,10}children:(?:\i(?:\.\i|\["[^"]*"\])*\()?)(\(0,\i.jsxs?\)\(\i,{}\))/,
                    replace: "arguments[0].user == null ? null : (vcIsTyping ? $self.TypingIcon() : $1)"
                },
                // The hook is called before the early return so the order of hooks never changes.
                {
                    match: /if\(null==\i\)return null;/,
                    replace: "let vcIsTyping = $self.isTyping();$&"
                }
            ]
        }
    ],

    TypingIcon() {
        const react = currentReact() as any;
        const dots = threeDots?.get();
        return dots ? react.createElement(dots, { dotRadius: 3, themed: true, style: { marginRight: 2 } }) : null;
    },

    isTyping() {
        return useStores([typingStore?.get(), channelSortStore?.get()], () => {
            try {
                const me = userStore?.get()?.getCurrentUser?.()?.id;
                const ids: string[] = channelSortStore?.get()?.getPrivateChannelIds?.() ?? [];
                return ids.some(id => Object.keys(typingStore?.get()?.getTypingUsers?.(id) ?? {}).some(userId => userId !== me));
            } catch {
                return false;
            }
        });
    },

    start(ctx) {
        typingStore = ctx.finders.byStore("TypingStore");
        channelSortStore = ctx.finders.byStore("PrivateChannelSortStore");
        userStore = ctx.common.UserStore;
        threeDots = ctx.finders.componentByCode("Math.min(1,Math.max(", "dotRadius:");
    },

    stop() {
        typingStore = channelSortStore = userStore = threeDots = undefined;
    }
};

export default plugin;
