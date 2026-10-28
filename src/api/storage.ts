/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Room for a plugin's own data that does not belong in the settings page: lists, caches, favourites. Each plugin sees only its own keys; a value is plain JSON of at most
// 1 MB. The data lives in IndexedDB inside Discord's page (Discord removes `localStorage`), so it is per Discord (Stable and Canary are separate) and goes away if
// Discord's data is cleared: a plugin that keeps something precious offers an export. Nothing here is sent anywhere. Design: docs/analysis-31-pinterest-tool-settings-and-storage.md.

import { isJsonValue, JsonValue } from "../shared/settings";

/** Where the text goes. One entry per full key; the real one is IndexedDB, tests use a Map. */
export interface StorageBackend {
    get(key: string): Promise<string | undefined>;
    set(key: string, text: string): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
}

export interface PluginStorage {
    /** The saved value, or undefined when there is none or it cannot be read. */
    get(key: string): Promise<JsonValue | undefined>;
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<void>;
    /** This plugin's keys. */
    keys(): Promise<string[]>;
}

export const STORAGE_LIMITS = { maxValueChars: 1024 * 1024, key: /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/ } as const;

export function buildStorage(plugin: string, backend: StorageBackend | undefined): PluginStorage {
    const prefix = `${plugin}/`;
    const use = () => {
        if (!backend) throw new Error(`${plugin}: storage is not available in this page`);
        return backend;
    };
    const full = (key: string) => {
        if (typeof key !== "string" || !STORAGE_LIMITS.key.test(key)) throw new Error(`${plugin}: "${String(key).slice(0, 40)}" is not a valid storage key`);
        return prefix + key;
    };
    return {
        async get(key) {
            const text = await use().get(full(key));
            if (text === undefined) return undefined;
            try {
                const value: unknown = JSON.parse(text);
                return isJsonValue(value) ? value : undefined;
            } catch {
                return undefined;
            }
        },
        async set(key, value) {
            const name = full(key);
            if (!isJsonValue(value)) throw new Error(`${plugin}: the value for ${key} is not plain data`);
            const text = JSON.stringify(value);
            if (text.length > STORAGE_LIMITS.maxValueChars) throw new Error(`${plugin}: the value for ${key} is too big (the limit is ${STORAGE_LIMITS.maxValueChars} characters)`);
            await use().set(name, text);
        },
        async delete(key) {
            await use().delete(full(key));
        },
        async keys() {
            return (await use().keys()).filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)).sort();
        }
    };
}

/** The little of IndexedDB this needs, written here so the code builds without the browser's type library (it also builds under Node, for the tests). */
interface IdbRequest<T> { result: T; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; }
interface IdbStore {
    get(key: string): IdbRequest<unknown>;
    put(value: string, key: string): IdbRequest<unknown>;
    delete(key: string): IdbRequest<unknown>;
    getAllKeys(): IdbRequest<unknown[]>;
}
interface IdbTransaction { objectStore(name: string): IdbStore; error: unknown; onabort: (() => void) | null; }
interface IdbDatabase { transaction(name: string, mode: "readonly" | "readwrite"): IdbTransaction; createObjectStore(name: string): unknown; }
interface IdbOpenRequest extends IdbRequest<IdbDatabase> { onupgradeneeded: (() => void) | null; }
export interface IndexedDbFactory { open(name: string, version: number): IdbOpenRequest; }

/** The real backend: one IndexedDB database with one store. Not covered by the tests (no IndexedDB under the test runner); checked by typecheck only. */
export function indexedDbBackend(factory: IndexedDbFactory, name = "amiricord-plugin-data"): StorageBackend {
    let opened: Promise<IdbDatabase> | undefined;
    const open = () => (opened ??= new Promise<IdbDatabase>((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => { request.result.createObjectStore("kv"); };
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => {
            opened = undefined;
            reject(request.error instanceof Error ? request.error : new Error("the plugin data could not be opened"));
        };
    }));
    const run = async <T>(mode: "readonly" | "readwrite", work: (store: IdbStore) => IdbRequest<T>) => {
        const db = await open();
        return new Promise<T>((resolve, reject) => {
            const transaction = db.transaction("kv", mode);
            const request = work(transaction.objectStore("kv"));
            request.onsuccess = () => { resolve(request.result); };
            request.onerror = () => { reject(request.error instanceof Error ? request.error : new Error("the plugin data could not be used")); };
            transaction.onabort = () => { reject(transaction.error instanceof Error ? transaction.error : new Error("the plugin data change was cancelled")); };
        });
    };
    return {
        get: async key => {
            const value = await run("readonly", store => store.get(key));
            return typeof value === "string" ? value : undefined;
        },
        set: async (key, text) => { await run("readwrite", store => store.put(text, key)); },
        delete: async key => { await run("readwrite", store => store.delete(key)); },
        keys: async () => (await run("readonly", store => store.getAllKeys())).filter((key): key is string => typeof key === "string")
    };
}
