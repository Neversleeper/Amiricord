/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- plugin settings are stored untyped and read through proxies */

import type { ComponentType } from "react";

import { currentReact } from "../../../api/jsxRuntime";
import { definePluginSettings as defineAmiricordSettings, type PluginSettings, type SettingsDefinition as AmiricordDefinition } from "../../../api/pluginSettings";
import type { BindableSettings } from "../../../renderer/engine";

export const PLUGIN_ID = "Questify";

export enum OptionType { STRING = 0, NUMBER = 1, BIGINT = 2, BOOLEAN = 3, SELECT = 4, SLIDER = 5, COMPONENT = 6, CUSTOM = 7 }

export interface VencordSetting {
    type: OptionType;
    description: string;
    default?: unknown;
    hidden?: boolean;
    restartNeeded?: boolean;
    component?: unknown;
    options?: ReadonlyArray<{ label: string; value: string | number; }>;
}

export type VencordDefinition = Record<string, VencordSetting>;

type Kind = "boolean" | "number" | "string" | "select" | "json";

const MAX_JSON = 60_000;

type IsPlainNumber<T> = [OptionType.STRING] extends [T] ? ([OptionType.BOOLEAN] extends [T] ? true : false) : false;

type ValueOf<S> = IsPlainNumber<S extends { type: infer T; } ? T : never> extends true ? (S extends { default: infer T; } ? T : never) : S extends { type: OptionType.STRING; } ? string : S extends { type: OptionType.NUMBER; } ? number : S extends { type: OptionType.BOOLEAN; } ? boolean : S extends { default: infer T; } ? T : never;

export type StoreOf<D extends VencordDefinition> = { -readonly [K in keyof D as D[K] extends { default: any; } ? K : never]: ValueOf<D[K]> };

export interface DefinedSettings<D extends VencordDefinition = VencordDefinition> extends BindableSettings {
    readonly def: D;
    readonly pluginName: string;
    readonly store: StoreOf<D>;
    subscribe(listener: () => void): () => void;
    onChange(key: string, listener: (value: any) => void): () => void;
}

const runtime = { enabled: true };

export function setPluginEnabled(enabled: boolean): void {
    runtime.enabled = enabled;
}

let registered: { settings: DefinedSettings; keys: Set<string>; } | undefined;

export interface SettingsScreen {
    key: string;
    description: string;
    component: ComponentType<any>;
}

let screens: SettingsScreen[] = [];

export function getSettingsScreens(): readonly SettingsScreen[] {
    return screens;
}

const KEPT_ON_RESET = new Set(["migrationVersion", "acknowledgedNotices", "ignoredQuestIDs", "resumeQuestIDs", "isOnQuestsPage", "questButtonBadgeCount"]);

export function resetPluginSettings(): number {
    if (!registered) return 0;
    const store = registered.settings.store as Record<string, unknown>;
    let written = 0;
    for (const key of registered.keys) {
        if (KEPT_ON_RESET.has(key)) continue;
        const setting = registered.settings.def[key];
        const fallback = setting?.default;
        store[key] = fallback !== null && typeof fallback === "object" ? JSON.parse(JSON.stringify(fallback)) : fallback;
        written++;
    }
    return written;
}

function observe<T>(root: T, onWrite: () => void): T {
    const proxies = new WeakMap<object, object>();
    const wrap = (value: unknown): unknown => {
        if (!value || typeof value !== "object") return value;
        const known = proxies.get(value);
        if (known) return known;
        const proxy = new Proxy(value, {
            get: (target, key, receiver) => wrap(Reflect.get(target, key, receiver)),
            set: (target, key, newValue) => {
                const done = Reflect.set(target, key, newValue);
                onWrite();
                return done;
            },
            deleteProperty: (target, key) => {
                const done = Reflect.deleteProperty(target, key);
                onWrite();
                return done;
            }
        });
        proxies.set(value, proxy);
        return proxy;
    };
    return wrap(root) as T;
}

export function definePluginSettings<D extends VencordDefinition>(definition: D): DefinedSettings<D> {
    const kinds = new Map<string, Kind>();
    const mapped: AmiricordDefinition = {};
    screens = [];
    for (const [key, setting] of Object.entries(definition)) {
        const { description, restartNeeded } = setting;
        switch (setting.type) {
            case OptionType.COMPONENT:
                if (setting.component) screens.push({ key, description, component: setting.component as ComponentType<any> });
                break;
            case OptionType.BOOLEAN:
                kinds.set(key, "boolean");
                mapped[key] = { type: "boolean", default: setting.default as boolean, description, restartNeeded };
                break;
            case OptionType.NUMBER:
            case OptionType.SLIDER:
                kinds.set(key, "number");
                mapped[key] = { type: "number", default: setting.default as number, description, restartNeeded };
                break;
            case OptionType.STRING:
                kinds.set(key, "string");
                mapped[key] = { type: "string", default: setting.default as string, description, restartNeeded };
                break;
            case OptionType.SELECT:
                kinds.set(key, "select");
                mapped[key] = { type: "select", default: setting.default as string | number, options: setting.options ?? [], description, restartNeeded };
                break;
            default:
                kinds.set(key, "json");
                mapped[key] = { type: "string", default: JSON.stringify(setting.default ?? null), maxLength: MAX_JSON, description, restartNeeded };
        }
    }

    const inner: PluginSettings = defineAmiricordSettings(mapped);
    const raw = inner.store as Record<string, any>;
    const cache = new Map<string, { raw: string; value: unknown; }>();

    const read = (key: string): unknown => {
        if (kinds.get(key) !== "json") return raw[key];
        const text = raw[key] as string;
        const hit = cache.get(key);
        if (hit && hit.raw === text) return hit.value;
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = JSON.parse((mapped[key] as { default: string; }).default);
        }
        const value: unknown = observe(parsed, () => {
            const saved = JSON.stringify(parsed);
            raw[key] = saved;
            cache.set(key, { raw: saved, value });
        });
        cache.set(key, { raw: text, value });
        return value;
    };

    const write = (key: string, value: unknown): void => {
        if (kinds.get(key) !== "json") {
            raw[key] = value;
            return;
        }
        const text = JSON.stringify(value === undefined ? null : value);
        raw[key] = text;
        cache.delete(key);
    };

    const store = {} as Record<string, unknown>;
    for (const key of kinds.keys()) {
        Object.defineProperty(store, key, { enumerable: true, get: () => read(key), set: (value: unknown) => write(key, value) });
    }

    const defined: DefinedSettings<D> = {
        def: definition,
        pluginName: PLUGIN_ID,
        store: store as StoreOf<D>,
        subscribe: listener => inner.subscribe(listener),
        onChange: (key, listener) => inner.onChange(key, (() => listener(read(key))) as never),
        bind: (client, pluginId) => inner.bind(client, pluginId),
        unbind: () => inner.unbind()
    };
    registered = { settings: defined as unknown as DefinedSettings, keys: new Set(kinds.keys()) };
    return defined;
}

const view: Record<string, any> = new Proxy({}, {
    get: (_target, key) => {
        if (key === "enabled") return runtime.enabled;
        return typeof key === "string" && registered?.keys.has(key) ? (registered.settings.store as Record<string, unknown>)[key] : undefined;
    },
    set: (_target, key, value) => {
        if (typeof key === "string" && registered?.keys.has(key)) (registered.settings.store as Record<string, unknown>)[key] = value;
        return true;
    },
    has: (_target, key) => key === "enabled" || (typeof key === "string" && !!registered?.keys.has(key)),
    ownKeys: () => ["enabled", ...(registered?.keys ?? [])],
    getOwnPropertyDescriptor: (_target, key) => (typeof key === "string" && (key === "enabled" || registered?.keys.has(key))
        ? { enumerable: true, configurable: true, writable: true, value: view[key] }
        : undefined)
});

type QuestifySettingsStore = (typeof import("../settings/store"))["settings"]["store"] & { enabled: boolean; };

export interface SettingsShape {
    plugins: { Questify: QuestifySettingsStore; };
}

export type Settings = SettingsShape;

export const Settings: Settings = {
    plugins: new Proxy({} as SettingsShape["plugins"], { get: (_target, key) => (key === PLUGIN_ID ? view : undefined) })
};

export const PlainSettings: { plugins: Record<string, any>; } = {
    plugins: new Proxy({} as Record<string, any>, {
        get: (_target, key) => (key === PLUGIN_ID ? { enabled: runtime.enabled, migrationVersion: 1 } : undefined),
        set: () => true
    })
};

export function useSettings(_paths?: readonly string[]): SettingsShape {
    const React = currentReact() as any;
    const [, redraw] = React.useState(0) as [number, (update: (n: number) => number) => void];
    React.useEffect(() => registered?.settings.subscribe(() => redraw(n => n + 1)), []);
    return Settings;
}

const listeners = new Map<string, () => void>();

export const SettingsStore = {
    addChangeListener(path: string, listener: (value: unknown) => void): void {
        const key = path.split(".").pop() ?? "";
        const remove = registered?.settings.onChange(key, listener);
        if (remove) listeners.set(`${path}\u0000${String(listener)}`, remove);
    },
    removeChangeListener(path: string, listener: (value: unknown) => void): void {
        const id = `${path}\u0000${String(listener)}`;
        listeners.get(id)?.();
        listeners.delete(id);
    },
    markAsChanged(): void { }
};
