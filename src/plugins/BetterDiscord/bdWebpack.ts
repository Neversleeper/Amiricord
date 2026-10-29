/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi.Webpack: find things inside Discord's modules by a filter function, the way BetterDiscord plugins expect.
// Discord's bundler gives no module cache to read, so the list of modules comes from the engine (`ctx.modules`): every module that has already run. A module that
// has not run yet is not searched, which is why `waitForModule` and `getLazy` ask again when a new module appears. Modules that hold the account's token are
// never offered to a filter (a plugin that really needs one has no business in this layer).

/* eslint-disable @typescript-eslint/no-explicit-any -- a BetterDiscord plugin's filters, and what they find, are untyped */

export interface ModuleEntry {
    id: string;
    exports: unknown;
}

export interface ModuleSource {
    /** Every module that has run so far. */
    loaded(): ModuleEntry[];
    /** Discord's original source text of one module, when known. */
    sourceOf?(id: string): string | undefined;
}

export type ModuleFilter = (exports: any, module: { id: string; exports: unknown; }, id: string) => unknown;

export interface FindOptions {
    /** Return the first match (default true) or every match. */
    first?: boolean;
    /** When the match is `exports.default`, return it (default true) instead of the whole `exports`. */
    defaultExport?: boolean;
    /** Also try each property of the exports (default false). */
    searchExports?: boolean;
    /** Return the module record `{ id, exports }` instead of the exports. */
    raw?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => (typeof value === "object" && value !== null) || typeof value === "function";

function safe<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch {
        return undefined;
    }
}

const TOKEN_KEYS = ["getToken", "showToken", "getEmail"];

/** A module that gives out the token or the e-mail of the account. */
function holdsSecrets(exports: unknown): boolean {
    if (!isObject(exports)) return false;
    return TOKEN_KEYS.some(key => safe(() => exports[key]) !== undefined || safe(() => (exports.default as Record<string, unknown> | undefined)?.[key]) !== undefined);
}

function textOf(value: unknown): string | undefined {
    if (typeof value === "function") return safe(() => Function.prototype.toString.call(value));
    if (isObject(value) && "$$typeof" in value) {
        const inner = value.type ?? value.render;
        if (typeof inner === "function") return safe(() => Function.prototype.toString.call(inner));
    }
    return undefined;
}

export const Filters = {
    byKeys: (...keys: string[]): ModuleFilter => exports => isObject(exports) && keys.every(key => key in exports),
    byProps: (...props: string[]): ModuleFilter => exports => isObject(exports) && props.every(prop => safe(() => exports[prop]) !== undefined),
    byStrings: (...strings: string[]): ModuleFilter => exports => {
        const text = textOf(exports);
        return text !== undefined && strings.every(s => text.includes(s));
    },
    byRegex: (regex: RegExp): ModuleFilter => exports => {
        const text = textOf(exports);
        return text !== undefined && new RegExp(regex.source, regex.flags.replace("g", "")).test(text);
    },
    byDisplayName: (name: string): ModuleFilter => exports => isObject(exports) && safe(() => exports.displayName) === name,
    byPrototypeKeys: (...keys: string[]): ModuleFilter => exports => {
        const prototype = isObject(exports) ? safe(() => exports.prototype) : undefined;
        return isObject(prototype) && keys.every(key => key in prototype);
    },
    byStoreName: (name: string): ModuleFilter => exports => isObject(exports)
        && (safe(() => typeof exports.getName === "function" && (exports.getName as () => unknown)() === name) === true
            || safe(() => (exports.constructor as { displayName?: unknown; } | undefined)?.displayName === name) === true),
    /** Matches when the module's own source text has all the strings (or patterns). Needs `sourceOf`, so it is built from a source. */
    bySource: (...needles: Array<string | RegExp>) => (source: ModuleSource): ModuleFilter => (_exports, module) => {
        const text = source.sourceOf?.(module.id);
        return text !== undefined && needles.every(n => (typeof n === "string" ? text.includes(n) : new RegExp(n.source, n.flags.replace("g", "")).test(text)));
    },
    combine: (...filters: ModuleFilter[]): ModuleFilter => (exports, module, id) => filters.every(f => f(exports, module, id)),
    not: (filter: ModuleFilter): ModuleFilter => (exports, module, id) => !filter(exports, module, id)
};

export interface BdWebpack {
    Filters: Omit<typeof Filters, "bySource"> & { bySource(...needles: Array<string | RegExp>): ModuleFilter; };
    readonly modules: ModuleEntry[];
    getModule(filter: ModuleFilter, options?: FindOptions): any;
    getModules(filter: ModuleFilter, options?: Omit<FindOptions, "first">): any[];
    getByKeys(...args: any[]): any;
    getAllByKeys(...args: any[]): any[];
    getByProps(...args: any[]): any;
    getAllByProps(...args: any[]): any[];
    getByStrings(...args: any[]): any;
    getAllByStrings(...args: any[]): any[];
    getByRegex(regex: RegExp, options?: FindOptions): any;
    getBySource(...args: any[]): any;
    getByDisplayName(name: string, options?: FindOptions): any;
    getByPrototypeKeys(...args: any[]): any;
    getStore(name: string): any;
    getWithKey(filter: ModuleFilter, options?: { target?: unknown; }): [unknown, string] | [];
    waitForModule(filter: ModuleFilter, options?: FindOptions & { signal?: AbortSignal; timeout?: number; }): Promise<any>;
    getLazy(filter: ModuleFilter, options?: FindOptions & { signal?: AbortSignal; timeout?: number; }): Promise<any>;
    Bulk(...queries: Array<ModuleFilter | ({ filter: ModuleFilter; } & FindOptions)>): any[];
    // Old names that plugins still use.
    findModule(filter: ModuleFilter): any;
    findModuleByProps(...props: string[]): any;
    findModuleByDisplayName(name: string): any;
}

/** The last argument, when it is an options object and not a name. */
function split<T extends object>(args: any[]): [string[], T] {
    const last = args[args.length - 1];
    if (isObject(last) && typeof last !== "function") return [args.slice(0, -1) as string[], last as unknown as T];
    return [args as string[], {} as T];
}

export function createBdWebpack(source: ModuleSource, options: { timeoutMs?: number; pollMs?: number; } = {}): BdWebpack {
    const defaultTimeout = options.timeoutMs ?? 5000;
    const pollMs = options.pollMs ?? 100;

    function search(filter: ModuleFilter, opts: FindOptions): unknown[] {
        const { first = true, defaultExport = true, searchExports = false, raw = false } = opts;
        const found: unknown[] = [];
        for (const record of source.loaded()) {
            const { exports, id } = record;
            if (!isObject(exports) || exports === (globalThis as unknown) || holdsSecrets(exports)) continue;
            const module = { id, exports };
            const give = (value: unknown) => (raw ? module : value);
            const test = (value: unknown) => Boolean(safe(() => filter(value, module, id)));
            /** Notes a match; true when the search can stop. */
            const hit = (result: unknown): boolean => {
                found.push(give(result));
                return first;
            };
            if (searchExports) {
                for (const key of safe(() => Object.keys(exports)) ?? []) {
                    const value = safe(() => exports[key]);
                    if (!isObject(value)) continue;
                    if (test(value) && hit(value)) return found;
                }
                continue;
            }
            if (test(exports) && hit(exports)) return found;
            const inner = safe(() => exports.default);
            if (isObject(inner) && test(inner) && hit(defaultExport ? inner : exports)) return found;
        }
        return found;
    }

    const getModule = (filter: ModuleFilter, opts: FindOptions = {}): any => {
        if (typeof filter !== "function") return undefined;
        const first = opts.first !== false;
        const out = search(filter, { ...opts, first });
        return first ? out[0] : out;
    };
    const getModules = (filter: ModuleFilter, opts: Omit<FindOptions, "first"> = {}): any[] => (typeof filter === "function" ? search(filter, { ...opts, first: false }) : []);

    const poll = (filter: ModuleFilter, opts: FindOptions & { signal?: AbortSignal; timeout?: number; }): Promise<any> => new Promise((resolve, reject) => {
        const now = getModule(filter, opts);
        if (now !== undefined) {
            resolve(now);
            return;
        }
        const timeout = opts.timeout ?? defaultTimeout;
        const done = (settle: () => void) => {
            clearInterval(timer);
            clearTimeout(limit);
            opts.signal?.removeEventListener("abort", onAbort);
            settle();
        };
        const timer = setInterval(() => {
            const value = getModule(filter, opts);
            if (value !== undefined) done(() => { resolve(value); });
        }, pollMs);
        const limit = setTimeout(() => { done(() => { reject(new Error(`no module matched within ${timeout} ms`)); }); }, timeout);
        const onAbort = () => { done(() => { reject(new Error("the search was cancelled")); }); };
        opts.signal?.addEventListener("abort", onAbort);
    });

    const bySource = (...needles: Array<string | RegExp>) => Filters.bySource(...needles)(source);

    const api: BdWebpack = {
        Filters: { ...Filters, bySource },
        get modules() { return source.loaded(); },
        getModule,
        getModules,
        getByKeys: (...args) => { const [keys, opts] = split<FindOptions>(args); return getModule(Filters.byKeys(...keys), opts); },
        getAllByKeys: (...args) => { const [keys, opts] = split<FindOptions>(args); return getModules(Filters.byKeys(...keys), opts); },
        getByProps: (...args) => { const [props, opts] = split<FindOptions>(args); return getModule(Filters.byProps(...props), opts); },
        getAllByProps: (...args) => { const [props, opts] = split<FindOptions>(args); return getModules(Filters.byProps(...props), opts); },
        getByStrings: (...args) => { const [strings, opts] = split<FindOptions>(args); return getModule(Filters.byStrings(...strings), { searchExports: true, ...opts }); },
        getAllByStrings: (...args) => { const [strings, opts] = split<FindOptions>(args); return getModules(Filters.byStrings(...strings), { searchExports: true, ...opts }); },
        getByRegex: (regex, opts) => getModule(Filters.byRegex(regex), { searchExports: true, ...opts }),
        getBySource: (...args) => { const [needles, opts] = split<FindOptions>(args); return getModule(bySource(...needles), opts); },
        getByDisplayName: (name, opts) => getModule(Filters.byDisplayName(name), opts),
        getByPrototypeKeys: (...args) => { const [keys, opts] = split<FindOptions>(args); return getModule(Filters.byPrototypeKeys(...keys), opts); },
        getStore: name => getModule(Filters.byStoreName(name), { searchExports: true }),
        getWithKey(filter, opts = {}) {
            const target = getModule(filter, { first: true, defaultExport: false, searchExports: false, raw: false });
            const owner = opts.target ?? target;
            if (!isObject(owner)) return [];
            for (const key of safe(() => Object.keys(owner)) ?? []) {
                if (safe(() => filter(owner[key], { id: "", exports: owner }, "")) === true) return [owner, key];
            }
            return [];
        },
        waitForModule: (filter, opts = {}) => poll(filter, opts),
        getLazy: (filter, opts = {}) => poll(filter, opts),
        Bulk(...queries) {
            return queries.map(query => (typeof query === "function" ? getModule(query) : getModule(query.filter, query)));
        },
        findModule: filter => getModule(filter),
        findModuleByProps: (...props) => getModule(Filters.byProps(...props)),
        findModuleByDisplayName: name => getModule(Filters.byDisplayName(name))
    };
    return api;
}
