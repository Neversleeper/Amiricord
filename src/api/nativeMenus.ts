/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entries inside Discord's own context menus: `ctx.contextMenu.addNative(navId, (children, props) => void)`. Discord draws every menu with one Menu component that takes
// a `navId` and a list of `children` (groups and items). The core plugin ContextMenuApi patches that component to ask this hub first: for the `navId` of the menu being
// opened, every callback added for it gets a COPY of the list of children (so a menu Discord keeps in memory is not changed again at every draw) and may add, remove or
// reorder them; the Menu then draws the list the callbacks left. The second argument is what the code that makes the menu was given (for the menu of a Quest tile, an
// object with the `quest`): another patch adds that to every menu with a fixed `navId`. A callback that throws is reported and the menu is drawn without its work.
// What is not covered: a menu whose `navId` is not written as text in Discord's code, and the menus of a Discord build whose Menu component the patch does not find.
// Design: docs/analysis-50-engine-apis-devtools-menus-sounds-notifications.md (section 2c).

export type NativeMenuCallback = (children: unknown[], props: unknown) => void;

export interface NativeMenuHub {
    /** Run `callback` every time Discord opens the menu with this `navId`. Returns false (and adds nothing) for a bad `navId` or callback or when the plugin has too many. */
    add(plugin: string, navId: string, callback: NativeMenuCallback, onError: (error: unknown) => void): boolean;
    /** Stop one callback. */
    remove(plugin: string, navId: string, callback: NativeMenuCallback): void;
    /** Stop every callback of a plugin. */
    removeAll(plugin: string): void;
    /** What the patched Menu component calls with its props: the same props when nothing is registered for its `navId`, else new props with the changed list of children. */
    patchProps(props: unknown): unknown;
}

export const MAX_NATIVE_MENU_CALLBACKS_PER_PLUGIN = 20;
const NAV_ID = /^[A-Za-z0-9_-]{1,80}$/;

interface Entry {
    plugin: string;
    callback: NativeMenuCallback;
    onError(error: unknown): void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The first argument of the code that made the menu, from the `arguments` the patch handed over; the props of the menu itself when there is none. */
function sourceProps(props: Record<string, unknown>): unknown {
    const given = props.contextMenuAPIArguments;
    if (isObject(given) && typeof (given as { length?: unknown; }).length === "number" && (given as { length: number; }).length > 0) return (given as unknown as ArrayLike<unknown>)[0];
    return props;
}

export function createNativeMenuHub(): NativeMenuHub {
    const byNav = new Map<string, Entry[]>();

    const count = (plugin: string) => {
        let total = 0;
        for (const list of byNav.values()) for (const entry of list) if (entry.plugin === plugin) total++;
        return total;
    };

    return {
        add(plugin, navId, callback, onError) {
            if (typeof navId !== "string" || !NAV_ID.test(navId) || typeof callback !== "function") return false;
            if (count(plugin) >= MAX_NATIVE_MENU_CALLBACKS_PER_PLUGIN) return false;
            const list = byNav.get(navId) ?? [];
            list.push({ plugin, callback, onError });
            byNav.set(navId, list);
            return true;
        },

        remove(plugin, navId, callback) {
            const list = byNav.get(navId);
            if (!list) return;
            const at = list.findIndex(entry => entry.plugin === plugin && entry.callback === callback);
            if (at >= 0) list.splice(at, 1);
            if (list.length === 0) byNav.delete(navId);
        },

        removeAll(plugin) {
            for (const [navId, list] of [...byNav]) {
                const left = list.filter(entry => entry.plugin !== plugin);
                if (left.length === 0) byNav.delete(navId);
                else byNav.set(navId, left);
            }
        },

        patchProps(props) {
            if (!isObject(props) || typeof props.navId !== "string") return props;
            const list = byNav.get(props.navId);
            if (!list || list.length === 0) return props;
            const children = Array.isArray(props.children) ? props.children.slice() : props.children === undefined || props.children === null ? [] : [props.children];
            const given = sourceProps(props);
            for (const entry of [...list]) {
                try {
                    entry.callback(children, given);
                } catch (error) {
                    try {
                        entry.onError(error);
                    } catch {
                        // Reporting must never break the menu.
                    }
                }
            }
            return { ...props, children };
        }
    };
}

/** The one hub of this page: the patch of the core plugin and the engine both use it. */
export const nativeMenus: NativeMenuHub = createNativeMenuHub();
