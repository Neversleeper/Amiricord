/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A tab a plugin adds to the Amiricord section of Discord's settings: `ctx.settingsTabs.add({ title, Component })`. TestCord let a plugin push itself into the list of the
// settings plugin (the Token Login Manager is a tab there); here the plugin asks through its context and the core plugin Settings draws the tab after its own ones, inside
// the same error boundary and with the same sidebar look. One tab per plugin, and it goes when the plugin stops. The tab is drawn the next time Settings is opened (Discord
// builds the settings tree when Settings opens, so a tab added while Settings is open shows from the next opening). Nothing here was tried in a real Discord.

export interface PluginSettingsTab {
    /** The sidebar text. */
    title: string;
    /** The title above the panel; the sidebar text when missing. */
    panelTitle?: string;
    /** The React component that draws the tab. */
    Component: unknown;
    /** Draws the sidebar icon; a plain default is used when missing. */
    icon?: () => unknown;
}

export interface PluginSettingsTabs {
    /** Show a tab for this plugin. A second call replaces the first. Returns false when the tab is not valid. */
    add(tab: PluginSettingsTab): boolean;
}

export interface SettingsTabEntry extends PluginSettingsTab {
    /** `plugin-<id>`: unique among tabs; the sidebar nodes get keys derived from it. */
    key: string;
    plugin: string;
}

export const MAX_TITLE_CHARS = 40;

export interface SettingsTabsHub {
    add(plugin: string, tab: PluginSettingsTab): boolean;
    removeAll(plugin: string): void;
    /** The tabs in the order they were added. Copies; never throws. */
    list(): SettingsTabEntry[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createSettingsTabsHub(): SettingsTabsHub {
    let entries: SettingsTabEntry[] = [];
    return {
        add(plugin, tab) {
            if (!ID.test(plugin)) return false;
            if (typeof tab?.title !== "string" || tab.title.trim() === "" || tab.title.length > MAX_TITLE_CHARS) return false;
            if (tab.panelTitle !== undefined && (typeof tab.panelTitle !== "string" || tab.panelTitle.length > MAX_TITLE_CHARS * 2)) return false;
            if (typeof tab.Component !== "function") return false;
            if (tab.icon !== undefined && typeof tab.icon !== "function") return false;
            const entry: SettingsTabEntry = { key: `plugin-${plugin}`, plugin, title: tab.title.trim(), panelTitle: tab.panelTitle?.trim() || undefined, Component: tab.Component, icon: tab.icon };
            const at = entries.findIndex(existing => existing.plugin === plugin);
            entries = at === -1 ? [...entries, entry] : entries.map((existing, index) => (index === at ? entry : existing));
            return true;
        },
        removeAll(plugin) {
            entries = entries.filter(entry => entry.plugin !== plugin);
        },
        list: () => entries.map(entry => ({ ...entry }))
    };
}

/** The hub the core plugin Settings and the engine share. */
export const settingsTabs: SettingsTabsHub = createSettingsTabsHub();

export function buildSettingsTabs(hub: SettingsTabsHub, plugin: string, onDispose: (callback: () => void) => void): PluginSettingsTabs {
    onDispose(() => { hub.removeAll(plugin); });
    return { add: tab => hub.add(plugin, tab) };
}
