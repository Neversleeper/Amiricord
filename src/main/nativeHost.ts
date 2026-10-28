/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs the main-process part of plugins ("native" code) when the page asks. Each call is checked before anything runs: the plugin must be one
// that is switched on and has native code, the function must be one it declared, and the arguments must be plain data. A native function gets
// a `host` as its first argument; `host.fetch` is its only way to the network and it refuses every host the plugin did not declare, redirects included.
// No Electron in this file (the window that made a call arrives as a small description, `nativeWindow.ts`). Honest limit: all plugins share one page, so the name of the caller in a message is a claim, not a proof.
// Design: docs/analysis-29-plugin-native-bridge.md.

import type { NativeWindow } from "./nativeWindow";

/** The part of a network answer a native function may use. The real `Response` fits. */
export interface NativeResponse {
    status: number;
    ok: boolean;
    headers: { get(name: string): string | null; getSetCookie?(): string[]; };
    /** The address this answer came from (after the redirects the host followed). */
    url?: string;
    /** The stream of the answer, when there is one: it is read in pieces so a size limit can stop it early. */
    body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array; }>; cancel(): Promise<unknown>; }; } | null;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json(): Promise<unknown>;
}

export interface NativeFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** The largest answer to accept, in bytes. Default: the host's `maxFetchBytes`. A bigger answer is refused as soon as it is known, or when the limit is passed while reading. */
    maxBytes?: number;
}

export interface NativeHostApi {
    /** Only https, only declared hosts, every redirect checked, with a time limit. Throws when a host is not declared. */
    fetch(url: string, init?: NativeFetchInit): Promise<NativeResponse>;
    /** One of the plugin's own secrets (a name it declared in `secrets`), or null when there is none, it is not declared or it cannot be read. Never throws. */
    secret(name: string): string | null;
}

/** What a native function gets when its plugin declares `permissions.system.devtools`; without it these two do not exist on `host`. */
export interface NativeDevToolsApi {
    /** Whether the window that made the call is there and can open its developer tools. Never throws. */
    canOpenDevTools(): Promise<boolean>;
    /** Open the developer tools of the window that made the call. True when they were open right after (Discord may close them again). Never throws. */
    openDevTools(): Promise<boolean>;
}

export type NativeFunction = (host: NativeHostApi & Partial<NativeDevToolsApi>, ...args: unknown[]) => unknown;

/** What is known about one plugin that is switched on and has native code. */
export interface NativePlugin {
    /** The function names the manifest declared. */
    functions: readonly string[];
    /** The hosts the manifest declared for `from: "main"`: bare names or `*.domain`. */
    hosts: readonly string[];
    /** The secret names the manifest declared. `host.secret` answers only for these. */
    secrets?: readonly string[];
    /** The manifest declares `permissions.system.devtools`: the host of this plugin also has `canOpenDevTools` and `openDevTools`. */
    devtools?: boolean;
    /** The plugin's native module. Called once, at the first call, so a plugin that is never used never loads its code. */
    load(): Record<string, unknown>;
}

export type NativeEvent =
    | { type: "call"; plugin: string; fn: string; ok: boolean; }
    | { type: "fetch"; plugin: string; host: string; allowed: boolean; }
    | { type: "devtools"; plugin: string; opened: boolean; }
    | { type: "refused"; reason: string; };

export interface NativeHostOptions {
    plugins: Readonly<Record<string, NativePlugin | undefined>>;
    /** The real network call (Node's `fetch`). */
    fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; redirect: "manual"; signal: AbortSignal; }) => Promise<NativeResponse>;
    onEvent?: (event: NativeEvent) => void;
    /** A call that has not answered after this long gives an error. Default 120 000 ms. */
    callTimeoutMs?: number;
    /** One network request. Default 12 000 ms. */
    fetchTimeoutMs?: number;
    /** Largest answer, in bytes of text and binary data. Default 64 MB. */
    maxResultBytes?: number;
    /** Largest network answer a native function may read unless it asks for less. Default 64 MB. */
    maxFetchBytes?: number;
    /** Where `host.secret` reads from (the main process's secret store). Without it every secret is null. */
    secret?: (plugin: string, name: string) => string | null;
}

export type NativeAnswer = { ok: true; value: unknown; } | { ok: false; error: string; };

export const MAX_ARGUMENT_BYTES = 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_NODES = 10_000;
const MAX_REDIRECTS = 4;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== "object" || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

/**
 * Whether a value is plain data: text, numbers, booleans, null, arrays and plain objects, and (only when `allowBinary`) byte buffers.
 * Depth, number of nodes and total size are capped. Functions, class instances, symbols, undefined and cycles are refused.
 */
export function isPlainData(value: unknown, maxBytes: number, allowBinary: boolean): boolean {
    let nodes = 0;
    let bytes = 0;
    const seen = new Set<object>();
    const visit = (item: unknown, depth: number): boolean => {
        if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
        switch (typeof item) {
            case "string": bytes += item.length * 2; return bytes <= maxBytes;
            case "number": bytes += 8; return Number.isFinite(item);
            case "boolean": bytes += 1; return true;
            case "undefined": return true;
            case "object": break;
            default: return false;
        }
        if (item === null) return true;
        if (allowBinary && (item instanceof ArrayBuffer || ArrayBuffer.isView(item))) {
            bytes += item.byteLength;
            return bytes <= maxBytes;
        }
        if (seen.has(item)) return false;
        seen.add(item);
        try {
            if (Array.isArray(item)) return item.every(entry => visit(entry, depth + 1));
            if (!isPlainObject(item)) return false;
            return Object.keys(item).every(key => { bytes += key.length * 2; return key !== "__proto__" && visit(item[key], depth + 1); });
        } finally {
            seen.delete(item);
        }
    };
    return visit(value, 0);
}

/** Whether `host` is allowed by one declared entry: the same name, or `*.domain` for any subdomain of it (never the bare domain). */
export function hostMatches(host: string, pattern: string): boolean {
    const name = host.toLowerCase();
    const wanted = pattern.toLowerCase();
    return wanted.startsWith("*.") ? name.endsWith(wanted.slice(1)) : name === wanted;
}

/**
 * The handler behind the page's native channel: only Discord's own pages are answered, whatever the message says.
 * `trusted` is `isTrustedSender` (kept as a parameter so this file stays free of the shared IPC code and is tested on its own).
 */
export function answerNativeCall(host: NativeHost, trusted: (url: unknown) => boolean, senderUrl: unknown, message: unknown, window?: NativeWindow): Promise<NativeAnswer> {
    if (!trusted(senderUrl)) return Promise.resolve({ ok: false, error: "The caller is not Discord's page." });
    return host.call(message, window);
}

/**
 * The answer a native function gets: the same status and headers, but its body is read at most `maxBytes` long. A declared length over the limit is refused
 * before anything is read; otherwise the stream is read in pieces and stopped (and cancelled) the moment the limit is passed, so a server that sends no length
 * cannot fill the memory. Without a stream (a test double) the whole body is read first and checked.
 */
function limitResponse(response: NativeResponse, maxBytes: number, url: string): NativeResponse {
    const declared = Number(response.headers.get("content-length") || 0);
    const tooBig = () => new Error(`The answer is bigger than ${maxBytes} bytes.`);
    let bytes: Promise<ArrayBuffer> | undefined;
    const read = () => (bytes ??= (async () => {
        if (declared > maxBytes) throw tooBig();
        const reader = response.body?.getReader();
        if (!reader) {
            const all = await response.arrayBuffer();
            if (all.byteLength > maxBytes) throw tooBig();
            return all;
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw tooBig();
            }
            chunks.push(value);
        }
        const out = new Uint8Array(total);
        let at = 0;
        for (const chunk of chunks) {
            out.set(chunk, at);
            at += chunk.byteLength;
        }
        return out.buffer as ArrayBuffer;
    })());
    return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        url: response.url ?? url,
        arrayBuffer: read,
        text: async () => new TextDecoder().decode(await read()),
        json: async () => JSON.parse(new TextDecoder().decode(await read())) as unknown
    };
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class NativeHost {
    private readonly loaded = new Map<string, Record<string, unknown>>();
    private readonly hosts = new Map<string, NativeHostApi>();

    constructor(private readonly options: NativeHostOptions) { }

    private emit(event: NativeEvent) {
        try {
            this.options.onEvent?.(event);
        } catch {
            // A broken listener must not break a call.
        }
    }

    private refuse(reason: string): NativeAnswer {
        this.emit({ type: "refused", reason });
        return { ok: false, error: reason };
    }

    /**
     * The host of a plugin that declared `permissions.system.devtools`, for one call: the plugin's usual host plus the two functions, tied to the window that made THIS
     * call (so it is made again for each call, and the plugin's own host stays the same one). A plugin without the permission never gets them.
     */
    private withDevTools(plugin: string, base: NativeHostApi, window: NativeWindow | undefined): NativeHostApi & NativeDevToolsApi {
        return {
            ...base,
            canOpenDevTools: async () => {
                try {
                    return window?.canOpenDevTools() === true;
                } catch {
                    return false;
                }
            },
            openDevTools: async () => {
                let opened = false;
                try {
                    opened = window?.openDevTools() === true;
                } catch {
                    opened = false;
                }
                this.emit({ type: "devtools", plugin, opened });
                return opened;
            }
        };
    }

    /** One host object per plugin, the same for every call, so native code may keep it (a client made once). */
    private hostFor(plugin: string, entry: NativePlugin): NativeHostApi {
        const known = this.hosts.get(plugin);
        if (known) return known;
        const made = this.makeHost(plugin, entry);
        this.hosts.set(plugin, made);
        return made;
    }

    private makeHost(plugin: string, entry: NativePlugin): NativeHostApi {
        const fetchTimeoutMs = this.options.fetchTimeoutMs ?? 12_000;
        const allowed = (url: URL) => {
            const ok = url.protocol === "https:" && entry.hosts.some(pattern => hostMatches(url.hostname, pattern));
            this.emit({ type: "fetch", plugin, host: url.hostname, allowed: ok });
            return ok;
        };
        return {
            secret: name => {
                if (!entry.secrets?.includes(name)) return null;
                try {
                    return this.options.secret?.(plugin, name) ?? null;
                } catch {
                    return null;
                }
            },
            fetch: async (rawUrl, init) => {
                let url: URL;
                try {
                    url = new URL(rawUrl);
                } catch {
                    throw new Error("Invalid URL.");
                }
                const { maxBytes, ...request } = init ?? {};
                const limit = Math.min(Number.isFinite(maxBytes) && (maxBytes as number) > 0 ? (maxBytes as number) : Infinity, this.options.maxFetchBytes ?? 64 * 1024 * 1024);
                for (let hops = 0; ; hops++) {
                    if (!allowed(url)) throw new Error(`${plugin}: host ${url.hostname} is not declared for this plugin.`);
                    const response = await this.options.fetch(url.href, { ...request, redirect: "manual", signal: AbortSignal.timeout(fetchTimeoutMs) });
                    if (!REDIRECT_STATUSES.includes(response.status)) return limitResponse(response, limit, url.href);
                    const location = response.headers.get("location");
                    if (!location) throw new Error("The redirect has no destination.");
                    if (hops >= MAX_REDIRECTS) throw new Error("Too many redirects.");
                    url = new URL(location, url);
                }
            }
        };
    }

    /** Check and run one call from the page. Never throws: every failure is an answer with `ok: false`. */
    async call(message: unknown, window?: NativeWindow): Promise<NativeAnswer> {
        if (!isPlainObject(message) || typeof message.plugin !== "string" || typeof message.fn !== "string" || !Array.isArray(message.args)) {
            return this.refuse("The call is malformed.");
        }
        const { plugin, fn, args } = message as { plugin: string; fn: string; args: unknown[]; };
        const entry = Object.prototype.hasOwnProperty.call(this.options.plugins, plugin) ? this.options.plugins[plugin] : undefined;
        if (!entry) return this.refuse(`${plugin}: no native code is running for this plugin.`);
        if (!entry.functions.includes(fn)) return this.refuse(`${plugin}: ${fn} is not a declared native function.`);
        if (!isPlainData(args, MAX_ARGUMENT_BYTES, false)) return this.refuse(`${plugin}: the arguments of ${fn} are not plain data or are too big.`);

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            let module = this.loaded.get(plugin);
            if (!module) {
                module = entry.load();
                this.loaded.set(plugin, module);
            }
            const target = module[fn];
            if (typeof target !== "function") throw new Error(`${fn} is declared but the plugin's native code does not have it.`);
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${fn} did not answer in time.`)), this.options.callTimeoutMs ?? 120_000);
            });
            const host = entry.devtools === true ? this.withDevTools(plugin, this.hostFor(plugin, entry), window) : this.hostFor(plugin, entry);
            const value = await Promise.race([Promise.resolve((target as NativeFunction)(host, ...args)), timeout]);
            if (!isPlainData(value, this.options.maxResultBytes ?? 64 * 1024 * 1024, true)) throw new Error(`${fn} answered with something that cannot be sent to the page.`);
            this.emit({ type: "call", plugin, fn, ok: true });
            return { ok: true, value };
        } catch (error) {
            this.emit({ type: "call", plugin, fn, ok: false });
            return { ok: false, error: `${plugin}: ${describe(error)}` };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }
}
