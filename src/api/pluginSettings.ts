/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How a plugin declares its settings. Each setting has a type, a default and a description; the plugin reads and writes
// them through `settings.store`, and the values live in the settings store (piece A). A saved value that does not fit
// the declaration (the owner edited the file, or the plugin changed its mind between versions) is ignored and the
// default is used, so a plugin never sees a value of the wrong type.
// Design: docs/design-03-settings.md piece B.

import { JsonValue, LIMITS } from "../shared/settings";
import type { SettingsClient } from "./settingsClient";

interface SettingBase {
    /** Shown to the owner next to the setting. */
    description: string;
    /** The change only takes effect after Discord restarts (the settings page says so). */
    restartNeeded?: boolean;
}

export interface BooleanSetting extends SettingBase {
    type: "boolean";
    default: boolean;
}

export interface NumberSetting extends SettingBase {
    type: "number";
    default: number;
    min?: number;
    max?: number;
    integer?: boolean;
}

export interface StringSetting extends SettingBase {
    type: "string";
    default: string;
    /** Default 10 000. */
    maxLength?: number;
}

export interface SelectOption {
    label: string;
    value: string | number;
}

export interface SelectSetting extends SettingBase {
    type: "select";
    default: string | number;
    options: readonly SelectOption[];
}

export type SettingDefinition = BooleanSetting | NumberSetting | StringSetting | SelectSetting;

export type SettingsDefinition = Record<string, SettingDefinition>;

type ValueOf<S> = S extends { type: "boolean"; } ? boolean : S extends { type: "number"; } ? number : S extends { type: "string"; } ? string : S extends { type: "select"; options: readonly { value: infer V; }[]; } ? V : never;

/** The object a plugin reads and writes: one property per declared setting, typed from the declaration. */
export type StoreOf<D extends SettingsDefinition> = { -readonly [K in keyof D]: ValueOf<D[K]> };

export const DEFAULT_MAX_STRING = 10_000;

/** Why a value does not fit its declaration, or null when it fits. */
export function checkValue(definition: SettingDefinition, value: unknown): string | null {
    switch (definition.type) {
        case "boolean":
            return typeof value === "boolean" ? null : "must be true or false";
        case "number":
            if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
            if (definition.integer && !Number.isInteger(value)) return "must be a whole number";
            if (definition.min !== undefined && value < definition.min) return `must be at least ${definition.min}`;
            if (definition.max !== undefined && value > definition.max) return `must be at most ${definition.max}`;
            return null;
        case "string":
            if (typeof value !== "string") return "must be text";
            return value.length <= (definition.maxLength ?? DEFAULT_MAX_STRING) ? null : `must be at most ${definition.maxLength ?? DEFAULT_MAX_STRING} characters`;
        case "select":
            return definition.options.some(option => option.value === value) ? null : "must be one of the listed options";
    }
}

/** Throws a plain error for a declaration that cannot work. Called when the plugin's code loads, so it shows as a start failure. */
export function validateDefinition(definition: SettingsDefinition): void {
    const keys = Object.keys(definition);
    if (keys.length > LIMITS.maxKeysPerPlugin) throw new Error(`a plugin may declare at most ${LIMITS.maxKeysPerPlugin} settings`);
    for (const key of keys) {
        const entry = definition[key];
        if (!LIMITS.settingKey.test(key) || key === "__proto__" || key === "constructor" || key === "prototype") throw new Error(`"${key}" is not a valid setting name`);
        if (typeof entry.description !== "string" || entry.description.length === 0) throw new Error(`${key}: a description is required`);
        if (entry.type === "select") {
            if (entry.options.length === 0) throw new Error(`${key}: a select needs at least one option`);
            if (new Set(entry.options.map(o => o.value)).size !== entry.options.length) throw new Error(`${key}: two options have the same value`);
        }
        if (entry.type === "number" && entry.min !== undefined && entry.max !== undefined && entry.min > entry.max) throw new Error(`${key}: min is above max`);
        const problem = checkValue(entry, entry.default);
        if (problem) throw new Error(`${key}: the default ${problem}`);
    }
}

export interface PluginSettings<D extends SettingsDefinition = SettingsDefinition> {
    readonly definition: D;
    /** Read a setting: the saved value if it fits the declaration, the default otherwise. Assigning saves it (a wrong type throws). */
    readonly store: StoreOf<D>;
    /** The plugin's id once the engine has attached these settings to it; null before (reading gives the defaults). */
    readonly pluginId: string | null;
    /** Be told when one setting changes, with its new value. Returns a function that stops it. */
    onChange<K extends keyof D & string>(key: K, listener: (value: StoreOf<D>[K]) => void): () => void;
    /** Be told when any of the plugin's settings changes. */
    subscribe(listener: () => void): () => void;
    /** Forget the saved value of one setting, or of all of them: the defaults apply again. */
    reset(key?: keyof D & string): void;
    /** For the engine: attach to a plugin and the page's copy of the settings. */
    bind(client: SettingsClient, pluginId: string): void;
    unbind(): void;
}

/**
 * One declared setting as plain data for the settings window: what it is, its limits, its default and its value right now.
 * Never functions, and never anything the plugin did not declare.
 */
export interface SettingInfo {
    key: string;
    type: SettingDefinition["type"];
    description: string;
    default: JsonValue;
    /** The value in use: the saved one if it fits the declaration, the default otherwise. */
    value: JsonValue;
    /** True when the value in use is not the default. */
    changed: boolean;
    restartNeeded: boolean;
    /** The manifest lists this setting as risky to change (`riskySettings`). */
    risky: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
    maxLength?: number;
    options?: Array<{ label: string; value: string | number; }>;
}

/**
 * A component a plugin draws in its own settings window, for what the declared settings cannot show (a colour picker, a list to edit, a preview).
 * A function component: it gets `onClose`, which closes the window. It runs in the page like the rest of the plugin's code.
 */
export type PluginSettingsComponent = (props: { onClose(): void; }) => unknown;

/** What the settings window may know about a running plugin's settings. */
export type PluginSettingsAnswer =
    /** The plugin's code is running and declares settings (the list may be empty). */
    | { state: "ready"; settings: SettingInfo[]; }
    /** The plugin declares settings but its code is not loaded, because it is off: they cannot be read now. */
    | { state: "not-loaded"; }
    /** The plugin has no settings, or is not known. */
    | { state: "none"; };

/** Whether something is the object `definePluginSettings` gives back (a plugin's code may hand over anything). */
export function isPluginSettings(value: unknown): value is PluginSettings {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<PluginSettings>;
    return typeof candidate.definition === "object" && candidate.definition !== null && typeof candidate.store === "object" && candidate.store !== null && typeof candidate.reset === "function";
}

/** The declared settings of a plugin as plain data, in the order they were declared. `risky` are the names the manifest lists as risky. */
export function describeSettings(settings: Pick<PluginSettings, "definition" | "store">, risky: readonly string[] = []): SettingInfo[] {
    const riskySet = new Set(risky);
    return Object.keys(settings.definition).map((key): SettingInfo => {
        const declared = settings.definition[key];
        const value = (settings.store as Record<string, JsonValue>)[key];
        const info: SettingInfo = {
            key, type: declared.type, description: declared.description, default: declared.default, value,
            changed: value !== declared.default, restartNeeded: declared.restartNeeded === true, risky: riskySet.has(key)
        };
        if (declared.type === "number") {
            if (declared.min !== undefined) info.min = declared.min;
            if (declared.max !== undefined) info.max = declared.max;
            if (declared.integer) info.integer = true;
        } else if (declared.type === "string") {
            info.maxLength = declared.maxLength ?? DEFAULT_MAX_STRING;
        } else if (declared.type === "select") {
            info.options = declared.options.map(option => ({ label: option.label, value: option.value }));
        }
        return info;
    });
}

export function definePluginSettings<const D extends SettingsDefinition>(definition: D): PluginSettings<D> {
    validateDefinition(definition);

    let client: SettingsClient | null = null;
    let id: string | null = null;
    let stop: (() => void) | null = null;
    const byKey = new Map<string, Set<(value: never) => void>>();
    const any = new Set<() => void>();

    const read = (key: string): JsonValue => {
        const entry = definition[key];
        const saved = client && id ? client.getValue(id, key) : undefined;
        return saved !== undefined && checkValue(entry, saved) === null ? saved : entry.default;
    };

    const store = {} as StoreOf<D>;
    for (const key of Object.keys(definition)) {
        Object.defineProperty(store, key, {
            enumerable: true,
            get: () => read(key),
            set: (value: unknown) => {
                const problem = checkValue(definition[key], value);
                if (problem) throw new TypeError(`${id ?? "plugin"}.${key} ${problem}`);
                if (!client || !id) throw new Error(`${key} cannot be saved before the plugin is loaded`);
                const refused = client.setValue(id, key, value as JsonValue);
                if (refused) throw new Error(`${id}.${key} was not saved: ${refused}`);
            }
        });
    }

    const tell = (keys: readonly string[]) => {
        for (const key of keys) {
            for (const listener of [...(byKey.get(key) ?? [])]) {
                try {
                    (listener as (value: JsonValue) => void)(read(key));
                } catch {
                    // A broken listener must not stop the others.
                }
            }
        }
        for (const listener of [...any]) {
            try {
                listener();
            } catch {
                // Same.
            }
        }
    };

    return {
        definition,
        store,
        get pluginId() { return id; },

        onChange(key, listener) {
            const set = byKey.get(key) ?? new Set();
            set.add(listener as (value: never) => void);
            byKey.set(key, set);
            return () => { set.delete(listener as (value: never) => void); };
        },

        subscribe(listener) {
            any.add(listener);
            return () => { any.delete(listener); };
        },

        reset(key) {
            if (!client || !id) return;
            for (const name of key ? [key] : Object.keys(definition)) client.setValue(id, name, undefined);
        },

        bind(settingsClient, pluginId) {
            if (client) throw new Error(`these settings are already attached to "${id}"`);
            client = settingsClient;
            id = pluginId;
            stop = settingsClient.subscribe(change => {
                if (change.plugin !== pluginId) return;
                if (change.type === "plugin-setting") {
                    if (Object.hasOwn(definition, change.key)) tell([change.key]);
                } else if (change.type === "plugin-reset") {
                    tell(Object.keys(definition));
                }
            });
        },

        unbind() {
            stop?.();
            stop = null;
            client = null;
            id = null;
        }
    };
}
