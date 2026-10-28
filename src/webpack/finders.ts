/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Finders: how a plugin gets hold of something inside Discord's modules (a function, a store, a component).
// Each plugin gets its own finders, so a miss is recorded against that plugin. Where a finder succeeded is remembered
// per Discord build in a ResolutionCache and only trusted after the module's source still matches its fingerprint.
// Design: docs/design-02-core.md section 5.

import { CacheEntry, fingerprint, ResolutionCache } from "./resolutionCache";

/** What the finders may look at. The renderer backs it with Webpack's module list; tests back it with a fake. */
export interface ModuleView {
    ids(): string[];
    /** The exports of a module. With `load` the module is run if it has not run yet; without it, undefined for modules not loaded. */
    exportsOf(id: string, load: boolean): unknown;
    /** Discord's original factory source, or undefined for an unknown module. */
    sourceOf(id: string): string | undefined;
}

export type FinderKind = "props" | "code" | "store" | "component";

export interface FinderSpec {
    kind: FinderKind;
    args: string[];
}

export interface FinderMiss {
    plugin: string;
    description: string;
    /** The plugin asked for it with `require()` or `ready()`, so it cannot work without it. */
    required: boolean;
}

export interface Finder<T> {
    readonly description: string;
    /** The thing, or undefined if it is not there (yet). A miss is recorded once. */
    get(): T | undefined;
    /** The thing, or an error that names the finder. */
    require(): T;
    /** Resolves when a module that matches is loaded. Rejects after the timeout (the engine's default, or `timeoutMs`). */
    ready(timeoutMs?: number): Promise<T>;
}

/** What the engine hands out: a finder that can also be asked quietly. */
export interface PeekFinder<T> extends Finder<T> {
    /** Like `get`, but a miss is NOT recorded: for something that is expected to appear later and is asked for again and again. */
    peek(): T | undefined;
}

export class FinderError extends Error {
    constructor(readonly plugin: string, readonly description: string, message: string) {
        super(message);
        this.name = "FinderError";
    }
}

export interface FinderEngineOptions {
    view: ModuleView;
    cache?: ResolutionCache;
    onMiss?: (miss: FinderMiss) => void;
    /** How long `ready()` waits before it gives up. Default 60 000 ms. */
    timeoutMs?: number;
}

interface Hit {
    moduleId: string;
    path: string | null;
    value: unknown;
}

const describeSpec = (spec: FinderSpec) => `${spec.kind}(${spec.args.map(a => JSON.stringify(a.length > 40 ? a.slice(0, 40) + "…" : a)).join(", ")})`;
const keyOf = (spec: FinderSpec) => `${spec.kind}:${JSON.stringify(spec.args)}`;
const isObjectLike = (value: unknown): value is Record<string, unknown> => (typeof value === "object" && value !== null) || typeof value === "function";

/** Things a finder must never return: the page's globals, raw buffers, and proxies that answer for any key. */
export function isBlacklisted(value: unknown): boolean {
    if (!isObjectLike(value)) return true;
    try {
        // Read through globalThis: this file is also type-checked and tested outside a browser.
        const page = globalThis as Record<string, unknown>;
        if (value === globalThis || value === page.window || value === page.document) return true;
        if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
        // An object that claims to have a made-up key is a catch-all (a proxy that answers anything), whichever way it answers.
        if ("__amiricord_probe__" in value) return true;
        if ((value as Record<string, unknown>).__amiricord_probe__ !== undefined) return true;
        // A promise or anything with a callable `then` would be swallowed by `await` and `resolve`, so a finder can never return it.
        return typeof (value as Record<string, unknown>).then === "function";
    } catch {
        return true;
    }
}

function sourceOfFunction(value: unknown): string | undefined {
    if (typeof value === "function") return Function.prototype.toString.call(value);
    // React wrappers (memo, forwardRef) keep the real function inside.
    if (isObjectLike(value) && "$$typeof" in value) {
        const inner = value.type ?? value.render;
        if (typeof inner === "function") return Function.prototype.toString.call(inner);
    }
    return undefined;
}

function safe<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch {
        return undefined;
    }
}

export function matches(spec: FinderSpec, value: unknown): boolean {
    if (isBlacklisted(value)) return false;
    const object = value as Record<string, unknown>;
    switch (spec.kind) {
        case "props":
            // A name that starts with "!" must be absent: it tells two objects with the same methods apart (a generic request library and Discord's own client).
            return spec.args.every(prop => prop.startsWith("!") ? safe(() => object[prop.slice(1)]) === undefined : safe(() => object[prop]) !== undefined);
        case "store":
            return safe(() => typeof object.getName === "function" && (object.getName as () => unknown)() === spec.args[0])
                === true || safe(() => (object.constructor as { displayName?: unknown; } | undefined)?.displayName === spec.args[0]) === true;
        case "code":
        case "component": {
            const source = sourceOfFunction(value);
            return source !== undefined && spec.args.every(snippet => source.includes(snippet));
        }
    }
}

/** The exports themselves, then each own property of them: where Discord keeps what plugins want. */
function candidates(exports: unknown): Array<{ path: string | null; value: unknown; }> {
    if (!isObjectLike(exports)) return [];
    const list: Array<{ path: string | null; value: unknown; }> = [{ path: null, value: exports }];
    for (const key of safe(() => Object.keys(exports)) ?? []) {
        const value = safe(() => exports[key]);
        if (value !== undefined) list.push({ path: key, value });
    }
    return list;
}

const needsSource = (spec: FinderSpec) => spec.kind === "code" || spec.kind === "component";

export class FinderEngine {
    private readonly view: ModuleView;
    private readonly cache: ResolutionCache | undefined;
    private readonly onMiss: ((miss: FinderMiss) => void) | undefined;
    private readonly timeoutMs: number;
    private readonly reported = new Set<string>();
    private readonly waiting = new Set<{ spec: FinderSpec; resolve: (value: unknown) => void; }>();

    constructor(options: FinderEngineOptions) {
        this.view = options.view;
        this.cache = options.cache;
        this.onMiss = options.onMiss;
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }

    private inModule(moduleId: string, spec: FinderSpec): Hit | undefined {
        if (needsSource(spec)) {
            const source = this.view.sourceOf(moduleId);
            // The source is checked first so only modules that can match are ever run.
            if (source === undefined || !spec.args.every(snippet => source.includes(snippet))) return undefined;
        }
        for (const { path, value } of candidates(safe(() => this.view.exportsOf(moduleId, needsSource(spec))))) {
            if (matches(spec, value)) return { moduleId, path, value };
        }
        return undefined;
    }

    private fromCache(spec: FinderSpec): Hit | undefined {
        const key = keyOf(spec);
        const entry = this.cache?.get(key);
        if (!entry) return undefined;

        const source = this.view.sourceOf(entry.moduleId);
        if (source !== undefined && fingerprint(source) === entry.fingerprint) {
            const exports = safe(() => this.view.exportsOf(entry.moduleId, true));
            const value = entry.path === null ? exports : isObjectLike(exports) ? safe(() => exports[entry.path!]) : undefined;
            if (matches(spec, value)) return { moduleId: entry.moduleId, path: entry.path, value };
        }
        // Discord changed this module, or the entry is stale: forget it and search again.
        this.cache?.delete(key);
        return undefined;
    }

    private resolve(spec: FinderSpec): Hit | undefined {
        const cached = this.fromCache(spec);
        if (cached) return cached;

        for (const id of this.view.ids()) {
            const hit = this.inModule(id, spec);
            if (hit) {
                const source = this.view.sourceOf(id);
                if (source !== undefined) this.cache?.set(keyOf(spec), { moduleId: id, path: hit.path, fingerprint: fingerprint(source) } satisfies CacheEntry);
                return hit;
            }
        }
        return undefined;
    }

    private notifications = 0;

    /** Counters for debugging: how many finders wait, and how many module loads were announced. */
    stats() {
        return { waiting: this.waiting.size, notifications: this.notifications };
    }

    /** Tell the engine a module has just loaded, so `ready()` waiters can be answered. */
    notifyLoaded(moduleId: string): void {
        this.notifications++;
        for (const waiter of [...this.waiting]) {
            const hit = this.inModule(moduleId, waiter.spec);
            if (!hit) continue;
            const source = this.view.sourceOf(moduleId);
            if (source !== undefined) this.cache?.set(keyOf(waiter.spec), { moduleId, path: hit.path, fingerprint: fingerprint(source) });
            this.waiting.delete(waiter);
            waiter.resolve(hit.value);
        }
    }

    /** Finders for one plugin. */
    forPlugin(plugin: string) {
        const make = <T>(spec: FinderSpec): PeekFinder<T> => {
            const description = describeSpec(spec);
            let found: Hit | undefined;

            const miss = (required: boolean) => {
                const key = `${plugin}\u0000${keyOf(spec)}`;
                if (this.reported.has(key + required)) return;
                this.reported.add(key + required);
                try {
                    this.onMiss?.({ plugin, description, required });
                } catch {
                    // Reporting must never break the plugin.
                }
            };

            const lookup = (required: boolean): T | undefined => {
                found ??= this.resolve(spec);
                if (!found) miss(required);
                return found?.value as T | undefined;
            };

            const finder: PeekFinder<T> = {
                description,
                get: () => lookup(false),
                peek: () => {
                    found ??= this.resolve(spec);
                    return found?.value as T | undefined;
                },
                require() {
                    const value = lookup(true);
                    if (value === undefined) throw new FinderError(plugin, description, `${plugin}: finder ${description} found nothing`);
                    return value;
                },
                ready: (timeoutMs = this.timeoutMs) => new Promise<T>((resolve, reject) => {
                    found ??= this.resolve(spec);
                    if (found) {
                        resolve(found.value as T);
                        return;
                    }
                    const waiter = {
                        spec,
                        resolve: (value: unknown) => {
                            clearTimeout(timer);
                            resolve(value as T);
                        }
                    };
                    const timer = setTimeout(() => {
                        this.waiting.delete(waiter);
                        miss(true);
                        reject(new FinderError(plugin, description, `${plugin}: finder ${description} found nothing after ${timeoutMs} ms`));
                    }, timeoutMs);
                    this.waiting.add(waiter);
                })
            };
            return finder;
        };

        return {
            byProps: <T = unknown>(...props: string[]) => make<T>({ kind: "props", args: props }),
            byCode: <T = unknown>(...snippets: string[]) => make<T>({ kind: "code", args: snippets }),
            byStore: <T = unknown>(name: string) => make<T>({ kind: "store", args: [name] }),
            componentByCode: <T = unknown>(...snippets: string[]) => make<T>({ kind: "component", args: snippets })
        };
    }
}
