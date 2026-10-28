/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What is saved about the owner's choices: which plugins are on or off, and each plugin's settings.
// Pure code with no files: reading the text, checking changes and building the text to save. Everything that comes from
// the page is checked here before it is kept, and nothing in this file can throw on bad input.
// Secrets (tokens, keys) never go here; design 01 section 9 keeps them apart.
// Design: docs/design-03-settings.md piece A.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue; };

export interface PluginSettings {
    /** `true` or `false` when the owner chose; missing means "follow the plugin's default". */
    enabled?: boolean;
    values?: Record<string, JsonValue>;
}

export interface SettingsData {
    schema: 1;
    plugins: Record<string, PluginSettings>;
}

export const LIMITS = {
    /** Plugin ids as the manifest allows them. */
    pluginId: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
    settingKey: /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/,
    maxPlugins: 1000,
    maxKeysPerPlugin: 200,
    maxDepth: 6,
    maxValueChars: 64 * 1024,
    maxFileChars: 2 * 1024 * 1024
} as const;

/** Keys that would let a saved object change the behavior of every object. Never accepted, at any depth. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const defaultSettings = (): SettingsData => ({ schema: 1, plugins: {} });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a value can be saved as JSON and read back unchanged: plain data only, limited depth, no forbidden keys. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
    if (depth > LIMITS.maxDepth) return false;
    if (value === null || typeof value === "boolean" || typeof value === "string") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1));
    if (isRecord(value)) {
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) return false;
        return Object.keys(value).every(key => !FORBIDDEN_KEYS.has(key) && isJsonValue(value[key], depth + 1));
    }
    return false;
}

const sizeOf = (value: JsonValue) => JSON.stringify(value).length;

// ---------------------------------------------------------------------------------------------------------------------
// Reading the saved text

export interface ParsedSettings {
    settings: SettingsData;
    /** What was wrong in the text and was left out. Empty when the text was fine. */
    problems: string[];
}

/** Read the saved text. A damaged file gives the defaults; a damaged entry is dropped and the rest is kept. Never throws. */
export function parseSettings(text: string): ParsedSettings {
    const problems: string[] = [];
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { settings: defaultSettings(), problems: ["the settings file is not valid JSON, using defaults"] };
    }
    if (!isRecord(data) || data.schema !== 1 || !isRecord(data.plugins)) {
        return { settings: defaultSettings(), problems: ["the settings file has an unexpected shape, using defaults"] };
    }

    const settings = defaultSettings();
    for (const [id, entry] of Object.entries(data.plugins)) {
        if (!LIMITS.pluginId.test(id) || FORBIDDEN_KEYS.has(id) || !isRecord(entry)) {
            problems.push(`a saved entry for "${id.slice(0, 40)}" is not valid and was dropped`);
            continue;
        }
        if (Object.keys(settings.plugins).length >= LIMITS.maxPlugins) {
            problems.push("too many plugins in the settings file, the rest were dropped");
            break;
        }
        const plugin: PluginSettings = {};
        if (typeof entry.enabled === "boolean") plugin.enabled = entry.enabled;
        else if (entry.enabled !== undefined) problems.push(`the saved choice for "${id}" is not true or false and was dropped`);

        if (isRecord(entry.values)) {
            const values: Record<string, JsonValue> = {};
            for (const [key, value] of Object.entries(entry.values)) {
                if (Object.keys(values).length >= LIMITS.maxKeysPerPlugin) {
                    problems.push(`"${id}" has too many saved settings, the rest were dropped`);
                    break;
                }
                if (!LIMITS.settingKey.test(key) || FORBIDDEN_KEYS.has(key) || !isJsonValue(value) || sizeOf(value) > LIMITS.maxValueChars) {
                    problems.push(`the saved setting "${id}.${key.slice(0, 40)}" is not valid and was dropped`);
                    continue;
                }
                values[key] = value;
            }
            if (Object.keys(values).length > 0) plugin.values = values;
        } else if (entry.values !== undefined) {
            problems.push(`the saved settings of "${id}" are not an object and were dropped`);
        }
        if (plugin.enabled !== undefined || plugin.values) settings.plugins[id] = plugin;
    }
    return { settings, problems };
}

/** The text to save. Keys are in a fixed order, so the same data always gives the same text. */
export function serializeSettings(settings: SettingsData): string {
    const plugins: Record<string, PluginSettings> = {};
    for (const id of Object.keys(settings.plugins).sort()) {
        const { enabled, values } = settings.plugins[id];
        const entry: PluginSettings = {};
        if (enabled !== undefined) entry.enabled = enabled;
        if (values) {
            entry.values = {};
            for (const key of Object.keys(values).sort()) entry.values[key] = values[key];
        }
        plugins[id] = entry;
    }
    return JSON.stringify({ schema: 1, plugins }, null, 1) + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// Changes that come from the page

export type SettingsChange =
    /** `enabled: null` goes back to "follow the plugin's default". */
    | { type: "plugin-enabled"; plugin: string; enabled: boolean | null; }
    /** `value: undefined` (missing) removes the setting. */
    | { type: "plugin-setting"; plugin: string; key: string; value?: JsonValue; }
    /** Forget every choice and setting of one plugin. */
    | { type: "plugin-reset"; plugin: string; };

/** Check a change that arrived from the page and rebuild it with only the known fields. Anything else gives null. */
export function parseSettingsChange(value: unknown): SettingsChange | null {
    if (!isRecord(value) || typeof value.type !== "string" || typeof value.plugin !== "string") return null;
    if (!LIMITS.pluginId.test(value.plugin) || FORBIDDEN_KEYS.has(value.plugin)) return null;

    switch (value.type) {
        case "plugin-enabled":
            return value.enabled === null || typeof value.enabled === "boolean" ? { type: value.type, plugin: value.plugin, enabled: value.enabled } : null;
        case "plugin-reset":
            return { type: value.type, plugin: value.plugin };
        case "plugin-setting": {
            if (typeof value.key !== "string" || !LIMITS.settingKey.test(value.key) || FORBIDDEN_KEYS.has(value.key)) return null;
            if (value.value === undefined) return { type: value.type, plugin: value.plugin, key: value.key };
            if (!isJsonValue(value.value) || sizeOf(value.value) > LIMITS.maxValueChars) return null;
            return { type: value.type, plugin: value.plugin, key: value.key, value: value.value };
        }
        default:
            return null;
    }
}

export interface ChangeResult {
    settings: SettingsData;
    /** Why the change was not applied. Null when it was. */
    error: string | null;
}

/** Apply a checked change. Returns a new object; the one given is never modified. A change that would break a limit is refused. */
export function applyChange(settings: SettingsData, change: SettingsChange): ChangeResult {
    const plugins = { ...settings.plugins };
    const current = plugins[change.plugin] ?? {};

    switch (change.type) {
        case "plugin-reset":
            delete plugins[change.plugin];
            break;
        case "plugin-enabled": {
            const { enabled: _old, ...rest } = current;
            const next: PluginSettings = change.enabled === null ? rest : { ...rest, enabled: change.enabled };
            if (next.enabled === undefined && !next.values) delete plugins[change.plugin];
            else plugins[change.plugin] = next;
            break;
        }
        case "plugin-setting": {
            const values = { ...current.values };
            if (change.value === undefined) delete values[change.key];
            else values[change.key] = change.value;
            if (Object.keys(values).length > LIMITS.maxKeysPerPlugin) return { settings, error: `"${change.plugin}" would have too many settings` };
            const { values: _old, ...rest } = current;
            const next: PluginSettings = Object.keys(values).length > 0 ? { ...rest, values } : rest;
            if (next.enabled === undefined && !next.values) delete plugins[change.plugin];
            else plugins[change.plugin] = next;
            break;
        }
    }

    if (Object.keys(plugins).length > LIMITS.maxPlugins) return { settings, error: "too many plugins in the settings" };
    const result: SettingsData = { schema: 1, plugins };
    if (serializeSettings(result).length > LIMITS.maxFileChars) return { settings, error: "the settings would be too large" };
    return { settings: result, error: null };
}

/** The plugin on/off choices in the shape the enabled-set decision takes. Plugins without a choice are not listed. */
export function choicesOf(settings: SettingsData): Record<string, boolean> {
    const choices: Record<string, boolean> = {};
    for (const [id, plugin] of Object.entries(settings.plugins)) {
        if (plugin.enabled !== undefined) choices[id] = plugin.enabled;
    }
    return choices;
}
