/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The list of tabs in the Amiricord section. Each feature adds its own entry, so adding a tab later never changes the page code.
// The order in the sidebar is the one TestCord shows (the owner's decision, 2026-10-25); a tab that is not built yet simply is not
// in the list, and an entry with a key this file does not know goes at the end in the order it was added.

import type { SettingsEntry } from "./layout";

/** Sidebar order, first to last. */
export const SIDEBAR_ORDER = [
    "amiricord", "privacy", "plugins", "themes", "updater", "changelog", "stats", "health", "presets", "cloud", "backup", "patchHelper"
] as const;

export class EntryRegistry {
    private readonly entries = new Map<string, SettingsEntry>();

    /** Add a tab. Returns the function that takes it out again. A second entry with the same key is refused. */
    register(entry: SettingsEntry): () => void {
        if (this.entries.has(entry.key)) throw new Error(`there is already a settings tab called "${entry.key}"`);
        this.entries.set(entry.key, entry);
        return () => {
            if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        };
    }

    /** The tabs in sidebar order. */
    list(): SettingsEntry[] {
        const rank = (key: string) => {
            const at = (SIDEBAR_ORDER as readonly string[]).indexOf(key);
            return at === -1 ? SIDEBAR_ORDER.length : at;
        };
        // Array.prototype.sort is stable, so entries with an unknown key keep the order they were added in.
        return [...this.entries.values()].sort((a, b) => rank(a.key) - rank(b.key));
    }

    clear(): void {
        this.entries.clear();
    }
}
