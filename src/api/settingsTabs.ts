/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Tabs a plugin adds to the Amiricord section of Discord's settings (the sidebar, under "Amiricord Settings"): `ctx.settingsTabs.add("logs", { title, Component })`.
// The core plugin Settings reads this hub when it builds the settings tree and draws each tab inside an error boundary of its own, so a tab that fails to draw cannot break the
// others. The tab's place in the list is after the core tabs, in the order the plugins added them, and the owner can hide or move it in Editor Mode like any other (its key is
// `<plugin>:<key>`, so two plugins can never clash). A plugin's tabs go when it stops. No permission is needed: a tab only draws inside the plugin's own place in the settings.
// This is what Vencord's `SettingsPlugin.customEntries` is used for; written from scratch for Amiricord's own settings tree. Nothing here was tried in a real Discord.

export const MAX_SETTINGS_TABS_PER_PLUGIN = 3;
const MAX_TITLE_CHARS = 40;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/i;

/** What a plugin gives for one tab. */
export interface PluginSettingsTab {
    /** The sidebar text. */
    title: string;
    /** The title above the panel; the sidebar text when missing. */
    panelTitle?: string;
    /** The React component that draws the tab. */
    Component: unknown;
    /** Draws the sidebar icon (a function returning a React element); a plain default is used when missing. */
    icon?: () => unknown;
}

export interface PluginSettingsTabs {
    /**
     * Add a tab. `key` is 1 to 32 letters, digits or dashes. Returns the function that takes the tab out again; a tab that is refused (a bad key or title, a component that is not a
     * component, a repeated key, more than three tabs) is written in the plugin's health report and the function does nothing. The tab goes by itself when the plugin stops.
     */
    add(key: string, tab: PluginSettingsTab): () => void;
}

/** One tab as the Settings plugin reads it. */
export interface SettingsTabEntry {
    /** `<plugin>:<key>`. */
    key: string;
    plugin: string;
    title: string;
    panelTitle?: string;
    Component: unknown;
    icon?: () => unknown;
}

export interface SettingsTabHub {
    /** Add a tab of `plugin`. Returns why it was refused, or null. */
    add(plugin: string, key: string, tab: PluginSettingsTab): string | null;
    remove(plugin: string, key: string): void;
    removeAll(plugin: string): void;
    /** The tabs, in the order they were added. */
    list(): SettingsTabEntry[];
    subscribe(listener: () => void): () => void;
    version(): number;
}

const isComponent = (value: unknown) => typeof value === "function" || (typeof value === "object" && value !== null);

export function createSettingsTabHub(): SettingsTabHub {
    let entries: SettingsTabEntry[] = [];
    let version = 0;
    const listeners = new Set<() => void>();

    const changed = () => {
        version++;
        for (const listener of [...listeners]) {
            try { listener(); } catch { /* a broken listener does not stop the others */ }
        }
    };

    return {
        add(plugin, key, tab) {
            if (typeof key !== "string" || !KEY_PATTERN.test(key)) return "the key of a settings tab is 1 to 32 letters, digits or dashes";
            if (typeof tab !== "object" || tab === null) return "a settings tab needs a title and a component";
            if (typeof tab.title !== "string" || tab.title.trim() === "" || tab.title.length > MAX_TITLE_CHARS) return `the title of a settings tab is 1 to ${MAX_TITLE_CHARS} characters`;
            if (tab.panelTitle !== undefined && (typeof tab.panelTitle !== "string" || tab.panelTitle.length > MAX_TITLE_CHARS)) return `the panel title of a settings tab is at most ${MAX_TITLE_CHARS} characters`;
            if (!isComponent(tab.Component)) return "the component of a settings tab is not a component";
            if (tab.icon !== undefined && typeof tab.icon !== "function") return "the icon of a settings tab must be a function";
            const full = `${plugin}:${key}`;
            if (entries.some(entry => entry.key === full)) return `there is already a settings tab called "${key}" from this plugin`;
            if (entries.filter(entry => entry.plugin === plugin).length >= MAX_SETTINGS_TABS_PER_PLUGIN) return `a plugin can add at most ${MAX_SETTINGS_TABS_PER_PLUGIN} settings tabs`;
            entries = [...entries, { key: full, plugin, title: tab.title.trim(), panelTitle: tab.panelTitle?.trim() || undefined, Component: tab.Component, icon: tab.icon }];
            changed();
            return null;
        },

        remove(plugin, key) {
            const full = `${plugin}:${key}`;
            const before = entries.length;
            entries = entries.filter(entry => entry.key !== full);
            if (entries.length !== before) changed();
        },

        removeAll(plugin) {
            const before = entries.length;
            entries = entries.filter(entry => entry.plugin !== plugin);
            if (entries.length !== before) changed();
        },

        list: () => entries,

        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        version: () => version
    };
}

/** The hub the engine and the core plugin Settings share. */
export const settingsTabs: SettingsTabHub = createSettingsTabHub();

export function buildSettingsTabs(hub: SettingsTabHub, plugin: string, onDispose: (callback: () => void) => void, reportError: (source: string, error: unknown) => void): PluginSettingsTabs {
    onDispose(() => { hub.removeAll(plugin); });
    return {
        add(key, tab) {
            let refused: string | null;
            try {
                refused = hub.add(plugin, key, tab);
            } catch (error) {
                refused = error instanceof Error ? error.message : String(error);
            }
            if (refused !== null) {
                reportError("settings tab", new Error(refused));
                return () => undefined;
            }
            return () => { hub.remove(plugin, key); };
        }
    };
}
