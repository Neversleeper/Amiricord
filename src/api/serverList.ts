/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Things a plugin draws in Discord's server list (the column of round server icons): `ctx.serverList.add("above", Component)`. There are three places:
// "above" (the elements are drawn with the Home button, at the top), "in" (between the Home separator and the first server) and "below" (after the last
// server). The core plugin UiApi patches the three places of Discord's code to ask this hub what to draw; a plugin's elements are taken away when it stops.
// Written from scratch after reading how Vencord's ServerList API is used (not copied). Discord draws these places again only when its own state changes,
// so each place is drawn by a small component of ours (see UiApi) that listens to the hub: an element that is added while Discord is already showing the
// list appears at once, without a restart.

export type ServerListPosition = "above" | "in" | "below";

export const SERVER_LIST_POSITIONS: readonly ServerListPosition[] = ["above", "in", "below"];
export const MAX_SERVER_LIST_ELEMENTS_PER_PLUGIN = 5;

/** What the hub hands to Discord's code for one element. The core plugin supplies it (it needs the React Discord runs). */
export type ElementMaker = (component: unknown, key: string, plugin: string) => unknown;

export interface PluginServerList {
    /** Draw `component` (a React component taking no props) in that place of the server list. A higher priority is drawn first. Does nothing for a bad place. */
    add(position: ServerListPosition, component: unknown, priority?: number): void;
}

export interface ServerListHub {
    add(plugin: string, position: ServerListPosition, component: unknown, priority: number): boolean;
    /** Take back every element of a plugin. */
    removeAll(plugin: string): void;
    /** The elements to draw in one place, highest priority first, made with `make`. Never throws: a place that cannot be drawn gives an empty list. */
    render(position: ServerListPosition, make: ElementMaker): unknown[];
    /** Called after every change of what is drawn (an element added, or a plugin's elements taken back). Returns the way to stop listening. */
    subscribe(listener: () => void): () => void;
    /** Changes with every change of what is drawn; what a React subscription compares. */
    version(): number;
}

interface Entry {
    plugin: string;
    position: ServerListPosition;
    component: unknown;
    priority: number;
}

export function createServerListHub(): ServerListHub {
    let entries: Entry[] = [];
    let version = 0;
    const listeners = new Set<() => void>();

    const changed = () => {
        version++;
        for (const listener of [...listeners]) {
            try { listener(); } catch { /* a broken listener does not stop the others */ }
        }
    };

    return {
        add(plugin, position, component, priority) {
            if (!SERVER_LIST_POSITIONS.includes(position) || typeof component !== "function") return false;
            if (entries.filter(entry => entry.plugin === plugin).length >= MAX_SERVER_LIST_ELEMENTS_PER_PLUGIN) return false;
            if (entries.some(entry => entry.plugin === plugin && entry.position === position && entry.component === component)) return true;
            entries = [...entries, { plugin, position, component, priority: Number.isFinite(priority) ? priority : 0 }];
            changed();
            return true;
        },

        removeAll(plugin) {
            const before = entries.length;
            entries = entries.filter(entry => entry.plugin !== plugin);
            if (entries.length !== before) changed();
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        version: () => version,

        render(position, make) {
            try {
                return entries
                    .map((entry, index) => ({ entry, index }))
                    .filter(({ entry }) => entry.position === position)
                    .sort((a, b) => b.entry.priority - a.entry.priority || a.index - b.index)
                    .map(({ entry }, order) => make(entry.component, `amiricord-${entry.plugin}-${position}-${order}`, entry.plugin));
            } catch {
                return [];
            }
        }
    };
}

/** The hub the core plugin UiApi and the engine share. */
export const serverList: ServerListHub = createServerListHub();

export function buildServerList(hub: ServerListHub, plugin: string, onDispose: (callback: () => void) => void): PluginServerList {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(position, component, priority = 0) {
            hub.add(plugin, position, component, priority);
        }
    };
}
