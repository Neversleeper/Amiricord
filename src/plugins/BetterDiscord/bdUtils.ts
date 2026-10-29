/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- BetterDiscord's helpers take and give anything */

// BdApi.Utils: the plain helper functions of BetterDiscord's API. Written for Amiricord from BetterDiscord's documentation.

const isObject = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null;

/** Class names joined: strings are kept, `{ name: true }` objects add their true keys, falsy values are dropped. */
function className(...parts: unknown[]): string {
    const out: string[] = [];
    for (const part of parts) {
        if (!part) continue;
        if (typeof part === "string") out.push(part);
        else if (Array.isArray(part)) out.push(className(...part));
        else if (isObject(part)) for (const [key, on] of Object.entries(part)) if (on) out.push(key);
    }
    return out.filter(Boolean).join(" ");
}

/** Copy the own properties of the sources into the target, going into plain objects. */
function extend(target: Record<string, any>, ...sources: Array<Record<string, any>>): Record<string, any> {
    for (const source of sources) {
        if (!isObject(source)) continue;
        for (const key of Object.keys(source)) {
            if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
            const value = source[key];
            if (isObject(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
                const base = isObject(target[key]) ? target[key] : {};
                target[key] = extend(base, value);
            } else {
                target[key] = value;
            }
        }
    }
    return target;
}

function debounce<T extends (...args: any[]) => void>(fn: T, delay = 100): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return function (this: unknown, ...args: Parameters<T>) {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => { fn.apply(this, args); }, delay);
    };
}

const escapeHTML = (text: unknown): string => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Walk an object (or React tree) looking for the first value the filter accepts. `walkable` limits which keys are followed, `ignore` skips keys. */
function findInTree(tree: unknown, filter: (value: any) => boolean, options: { walkable?: string[] | null; ignore?: string[]; maxDepth?: number; } = {}): any {
    const { walkable = null, ignore = [], maxDepth = 100 } = options;
    const seen = new WeakSet<object>();
    const walk = (value: unknown, depth: number): any => {
        if (!isObject(value) || depth > maxDepth || seen.has(value)) return undefined;
        seen.add(value);
        try {
            if (filter(value)) return value;
        } catch {
            // A filter that throws on one value just does not accept it.
        }
        const keys = Array.isArray(value) ? value.keys() : Object.keys(value);
        for (const key of keys) {
            const name = String(key);
            if (ignore.includes(name) || (walkable && !Array.isArray(value) && !walkable.includes(name))) continue;
            let child: unknown;
            try {
                child = (value as any)[key];
            } catch {
                continue;
            }
            const found = walk(child, depth + 1);
            if (found !== undefined) return found;
        }
        return undefined;
    };
    return walk(tree, 0);
}

function getNestedValue(object: unknown, path: string | string[]): any {
    const keys = Array.isArray(path) ? path : String(path).split(".");
    let value: any = object;
    for (const key of keys) {
        if (value === null || value === undefined) return undefined;
        value = value[key];
    }
    return value;
}

/** -1, 0 or 1 like `a.localeCompare(b)` for version strings such as "1.4.10" and "1.5". */
function semverCompare(a: string, b: string): number {
    const parts = (v: string) => String(v).replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0);
    const left = parts(a);
    const right = parts(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
}

/** Replace `{{name}}` in a text with the matching value of the object. */
function formatString(text: string, values: Record<string, unknown>): string {
    return String(text).replace(/{{(\w+)}}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

function makeMap<T>(keys: string[], value: T = true as unknown as T): Record<string, T> {
    return Object.fromEntries(keys.map(key => [key, value]));
}

/** A tiny store for plugins that want `addChangeListener` / `emitChange` like Discord's stores. */
class Store {
    private readonly listeners = new Set<() => void>();
    initialize(): void { /* nothing to set up */ }
    addChangeListener(listener: () => void): void { this.listeners.add(listener); }
    removeChangeListener(listener: () => void): void { this.listeners.delete(listener); }
    emitChange(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch (error) {
                console.error("[BdApi.Utils.Store] a listener threw", error);
            }
        }
    }
}

export const BdUtils = { className, extend, debounce, escapeHTML, findInTree, getNestedValue, semverCompare, formatString, makeMap, Store };
