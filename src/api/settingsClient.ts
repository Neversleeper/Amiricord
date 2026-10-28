/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The page's copy of the saved settings. It starts from what the main process handed over at boot, applies every change
// at once (so the page never waits), and sends the same checked change to the main process, which keeps the file.
// The main process checks every change again; this copy is only a convenience, never the source of truth.
// Design: docs/design-03-settings.md piece B.

import { applyChange, JsonValue, parseSettingsChange, SettingsChange, SettingsData } from "../shared/settings";

export type ChangeListener = (change: SettingsChange) => void;

export class SettingsClient {
    private data: SettingsData;
    private readonly listeners = new Set<ChangeListener>();

    constructor(initial: SettingsData, private readonly send: (change: SettingsChange) => void) {
        this.data = initial;
    }

    get snapshot(): SettingsData {
        return this.data;
    }

    /** The owner's choice for a plugin: true, false, or undefined when it follows its default. */
    getEnabled(plugin: string): boolean | undefined {
        return this.data.plugins[plugin]?.enabled;
    }

    /** A saved setting, or undefined when none is saved. The plugin's own definition decides what an invalid or missing value means. */
    getValue(plugin: string, key: string): JsonValue | undefined {
        const values = this.data.plugins[plugin]?.values;
        return values && Object.hasOwn(values, key) ? values[key] : undefined;
    }

    /** Make a change. Returns why it was refused, or null when it was applied and sent. Never throws. */
    change(change: unknown): string | null {
        const checked = parseSettingsChange(change);
        if (!checked) return "not a valid settings change";
        const result = applyChange(this.data, checked);
        if (result.error !== null) return result.error;
        this.data = result.settings;
        try {
            this.send(checked);
        } catch {
            // The main process being out of reach must not break the page; the change stays in this copy for the session.
        }
        for (const listener of [...this.listeners]) {
            try {
                listener(checked);
            } catch {
                // A broken listener must not stop the others.
            }
        }
        return null;
    }

    setEnabled(plugin: string, enabled: boolean | null): string | null {
        return this.change({ type: "plugin-enabled", plugin, enabled });
    }

    setValue(plugin: string, key: string, value: JsonValue | undefined): string | null {
        return this.change({ type: "plugin-setting", plugin, key, value });
    }

    reset(plugin: string): string | null {
        return this.change({ type: "plugin-reset", plugin });
    }

    /** Be told after every applied change. Returns a function that stops it. */
    subscribe(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}
