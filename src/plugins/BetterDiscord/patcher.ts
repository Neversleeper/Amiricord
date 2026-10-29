/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi.Patcher: wraps a function of an object so that plugins can run code before it, after it, or instead of it, and take their wrapping away again.
// Written for Amiricord from BetterDiscord's documented behaviour: `before(this, args)` may change `args`; `instead(this, args, original)` replaces the call;
// `after(this, args, returnValue)` may return a new value; a callback that throws is reported and skipped, the call goes on. One wrapper per function, however
// many plugins patch it; when the last callback goes the original function is put back.

export type PatchType = "before" | "after" | "instead";

export interface PatchOptions {
    /** Patch even when the object has no such function yet (an empty one is made). Default false. */
    forcePatch?: boolean;
    /** Undo this one patch after its first call. */
    once?: boolean;
}

type Callback = (thisArg: unknown, args: unknown[], extra?: unknown) => unknown;

interface Child {
    caller: string;
    type: PatchType;
    callback: Callback;
    once: boolean;
}

interface Record_ {
    target: Record<string, unknown>;
    key: string;
    original: (...args: unknown[]) => unknown;
    wrapper: (...args: unknown[]) => unknown;
    children: Child[];
}

export interface Patcher {
    before(caller: string, target: unknown, key: string, callback: Callback, options?: PatchOptions): () => void;
    after(caller: string, target: unknown, key: string, callback: Callback, options?: PatchOptions): () => void;
    instead(caller: string, target: unknown, key: string, callback: Callback, options?: PatchOptions): () => void;
    /** Take back every patch of one caller. */
    unpatchAll(caller: string): void;
    /** How many patches one caller has (for tests and for the plugin list). */
    countOf(caller: string): number;
}

/** `onError(caller, where, error)` hears about callbacks that threw. */
export function createPatcher(onError: (caller: string, where: string, error: unknown) => void = () => undefined): Patcher {
    const records: Record_[] = [];

    function recordFor(target: Record<string, unknown>, key: string): Record_ {
        const found = records.find(r => r.target === target && r.key === key);
        if (found) return found;
        const original = target[key] as (...args: unknown[]) => unknown;
        const record: Record_ = { target, key, original, wrapper: undefined as never, children: [] };
        record.wrapper = function (this: unknown, ...args: unknown[]) {
            // Work on a copy of the list: a callback may remove itself ("once") while this call is running.
            const children = [...record.children];
            const report = (child: Child, error: unknown) => { onError(child.caller, `${child.type} patch of ${key}`, error); };
            /** Runs one callback. A callback that throws is reported and counts as having done nothing: `ok` is false. */
            const run = (child: Child, call: () => unknown): { ok: boolean; value: unknown; } => {
                try {
                    return { ok: true, value: call() };
                } catch (error) {
                    report(child, error);
                    return { ok: false, value: undefined };
                } finally {
                    if (child.once) remove(record, child);
                }
            };
            for (const child of children.filter(c => c.type === "before")) run(child, () => child.callback(this, args));
            // Each "instead" gets the call the earlier ones would have made, so they stack the way BetterDiscord's do. One that throws falls back to that call.
            let next: (...a: unknown[]) => unknown = (...a) => original.apply(this, a);
            for (const child of children.filter(c => c.type === "instead")) {
                const inner = next;
                next = (...a) => {
                    const out = run(child, () => child.callback(this, a, inner));
                    return out.ok ? out.value : inner(...a);
                };
            }
            let value = next(...args);
            for (const child of children.filter(c => c.type === "after")) {
                const out = run(child, () => child.callback(this, args, value));
                if (out.ok && out.value !== undefined) value = out.value;
            }
            return value;
        };
        // The wrapper looks like the original to code that inspects it (name, own properties, source text).
        try {
            Object.defineProperty(record.wrapper, "name", { value: original.name, configurable: true });
            Object.assign(record.wrapper, original);
            Object.defineProperty(record.wrapper, "toString", { value: () => String(original), configurable: true });
            (record.wrapper as unknown as { __bdOriginal?: unknown; }).__bdOriginal = original;
        } catch {
            // A function that refuses extra properties is still wrapped.
        }
        target[key] = record.wrapper;
        records.push(record);
        return record;
    }

    function remove(record: Record_, child: Child): void {
        const at = record.children.indexOf(child);
        if (at >= 0) record.children.splice(at, 1);
        if (record.children.length > 0) return;
        // Put the original back, but only if nothing else replaced our wrapper in the meantime.
        if (record.target[record.key] === record.wrapper) record.target[record.key] = record.original;
        const index = records.indexOf(record);
        if (index >= 0) records.splice(index, 1);
    }

    function add(type: PatchType, caller: string, target: unknown, key: string, callback: Callback, options: PatchOptions = {}): () => void {
        if (typeof callback !== "function") throw new TypeError("a patch needs a function to run");
        if ((typeof target !== "object" && typeof target !== "function") || target === null) throw new TypeError("the thing to patch must be an object or a function");
        const holder = target as Record<string, unknown>;
        if (typeof holder[key] !== "function") {
            if (!options.forcePatch) throw new TypeError(`${key} is not a function of the object to patch`);
            holder[key] = function () { return undefined; };
        }
        const record = recordFor(holder, key);
        const child: Child = { caller, type, callback, once: options.once === true };
        record.children.push(child);
        return () => { remove(record, child); };
    }

    return {
        before: (caller, target, key, callback, options) => add("before", caller, target, key, callback, options),
        after: (caller, target, key, callback, options) => add("after", caller, target, key, callback, options),
        instead: (caller, target, key, callback, options) => add("instead", caller, target, key, callback, options),
        unpatchAll(caller) {
            for (const record of [...records]) {
                for (const child of record.children.filter(c => c.caller === caller)) remove(record, child);
            }
        },
        countOf: caller => records.reduce((sum, r) => sum + r.children.filter(c => c.caller === caller).length, 0)
    };
}
