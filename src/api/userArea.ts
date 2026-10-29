/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Buttons a plugin adds to the user panel (the bar at the bottom left with the microphone, headphones and settings buttons): `ctx.userArea.add(Component)`.
// The core plugin UiApi patches the function that draws that bar to put one small component of ours in front of Discord's own buttons; that component listens to this
// hub, so a button added while Discord is already showing the bar appears at once. Each button is a React component that receives `{ nameplate, iconForeground }`
// (the same two things Discord gives its own buttons, so a button can look like them) and draws a panel button. A plugin's buttons go when it stops.
// Written from scratch after reading how Vencord's UserArea API is used (not copied). Nothing here was tried in a real Discord.

/** What Discord's bar gives each button so it can look like the others. */
export interface UserAreaButtonProps {
    /** The nameplate of the current user, or null/undefined. A button draws itself "plated" when there is one. */
    nameplate?: unknown;
    /** The class name Discord puts on its own icons when there is a nameplate. */
    iconForeground?: string;
}

export const MAX_USER_AREA_BUTTONS_PER_PLUGIN = 3;

export interface PluginUserArea {
    /** Draw `component` (a React component taking `UserAreaButtonProps`) in the user panel. A lower priority is drawn first. */
    add(component: unknown, priority?: number): void;
}

export type UserAreaMaker = (component: unknown, key: string, plugin: string) => unknown;

export interface UserAreaHub {
    add(plugin: string, component: unknown, priority: number): boolean;
    removeAll(plugin: string): void;
    /** The buttons to draw, lowest priority first, made with `make`. Never throws. */
    render(make: UserAreaMaker): unknown[];
    subscribe(listener: () => void): () => void;
    version(): number;
}

interface Entry {
    plugin: string;
    component: unknown;
    priority: number;
}

export function createUserAreaHub(): UserAreaHub {
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
        add(plugin, component, priority) {
            if (typeof component !== "function") return false;
            if (entries.filter(entry => entry.plugin === plugin).length >= MAX_USER_AREA_BUTTONS_PER_PLUGIN) return false;
            if (entries.some(entry => entry.plugin === plugin && entry.component === component)) return true;
            entries = [...entries, { plugin, component, priority: Number.isFinite(priority) ? priority : 0 }];
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

        render(make) {
            try {
                return entries
                    .map((entry, index) => ({ entry, index }))
                    .sort((a, b) => a.entry.priority - b.entry.priority || a.index - b.index)
                    .map(({ entry }, order) => make(entry.component, `amiricord-${entry.plugin}-user-area-${order}`, entry.plugin));
            } catch {
                return [];
            }
        }
    };
}

/** The hub the core plugin UiApi and the engine share. */
export const userArea: UserAreaHub = createUserAreaHub();

export function buildUserArea(hub: UserAreaHub, plugin: string, onDispose: (callback: () => void) => void): PluginUserArea {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(component, priority = 0) {
            hub.add(plugin, component, priority);
        }
    };
}
