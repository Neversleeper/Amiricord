/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The one owner of Electron's `session.webRequest` events. Electron keeps only one listener per event, and registering another one
// silently replaces the first, so every feature that needs to look at requests registers here instead, as a small handler.
// The listener Discord's own code registers (if any) is kept and called after ours, so neither side replaces the other.
// No Electron in this file: `electronGlue.ts` hands it the real object. Design: docs/analysis-14-request-hub.md.

export interface RequestDetails {
    url: string;
    method?: string;
    resourceType?: string;
    requestHeaders?: Record<string, string>;
    [key: string]: unknown;
}

/** What a handler may answer before a request is made. Nothing means "I only looked". */
export type RequestAnswer = void | undefined | { cancel: true; } | { redirectURL: string; };
/** What a handler may answer before the headers are sent. */
export type HeadersAnswer = void | undefined | { cancel: true; } | { requestHeaders: Record<string, string>; };

export interface RequestHandler {
    /** Shown in the status and the trace when the handler fails. */
    name: string;
    beforeRequest?(details: RequestDetails): RequestAnswer;
    beforeSendHeaders?(details: RequestDetails): HeadersAnswer;
}

type Callback = (answer: Record<string, unknown>) => void;
type Listener = (details: RequestDetails, callback: Callback) => void;

/** The part of Electron's `WebRequest` this needs. The methods are replaced on the object, so they are assignable. */
export interface WebRequestLike {
    onBeforeRequest: (...args: unknown[]) => void;
    onBeforeSendHeaders: (...args: unknown[]) => void;
}

export interface HubStatus {
    installed: boolean;
    /** True when Discord's own listeners can be kept (the methods could be replaced). */
    chaining: boolean;
    handlers: string[];
    errors: Record<string, number>;
    /** Which events have a listener of Discord's stored. */
    host: { beforeRequest: boolean; beforeSendHeaders: boolean; };
}

export interface HubOptions {
    /** Told when a handler throws. Must not throw. */
    onError?: (handler: string, error: unknown) => void;
}

interface HostListener {
    listener: Listener;
    /** URL patterns of the filter Discord gave, or null for every request. */
    patterns: string[] | null;
}

/** The schemes a `*` scheme stands for in a match pattern. */
const WILDCARD_SCHEMES = ["http", "https", "ws", "wss"];

/** Does a Chromium match pattern (`<all_urls>`, `*://*.discord.com/*`) cover this address? Anything it cannot parse matches nothing. */
export function matchesPattern(url: string, pattern: string): boolean {
    if (pattern === "<all_urls>") return /^(?:https?|wss?|ftp|file):/i.test(url);
    const parts = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
    if (!parts) return false;
    const [, scheme, host, path] = parts;
    let address: URL;
    try {
        address = new URL(url);
    } catch {
        return false;
    }
    const urlScheme = address.protocol.replace(/:$/, "").toLowerCase();
    if (scheme === "*" ? !WILDCARD_SCHEMES.includes(urlScheme) : scheme.toLowerCase() !== urlScheme) return false;
    const urlHost = address.hostname.toLowerCase();
    const wanted = host.toLowerCase();
    if (wanted !== "*") {
        if (wanted.startsWith("*.")) {
            const base = wanted.slice(2);
            if (urlHost !== base && !urlHost.endsWith("." + base)) return false;
        } else if (wanted.replace(/:\d+$/, "") !== urlHost) return false;
    }
    const regex = new RegExp("^" + path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return regex.test(address.pathname + address.search);
}

const hostMatches = (host: HostListener, url: string) => host.patterns === null || host.patterns.some(pattern => matchesPattern(url, pattern));

/** What Discord passed to `onBeforeRequest(filter?, listener)`: its listener and the URL patterns of its filter. */
function readRegistration(args: unknown[]): HostListener | null {
    const listener = args[args.length - 1];
    if (typeof listener !== "function") return null;
    const filter = args.length > 1 ? args[0] : undefined;
    const urls = filter && typeof filter === "object" ? (filter as { urls?: unknown; }).urls : undefined;
    return { listener: listener as Listener, patterns: Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string") : null };
}

export class RequestHub {
    private readonly handlers: RequestHandler[] = [];
    private readonly errors: Record<string, number> = {};
    private host: { beforeRequest: HostListener | null; beforeSendHeaders: HostListener | null; } = { beforeRequest: null, beforeSendHeaders: null };
    private installed = false;
    private chaining = false;

    constructor(private readonly webRequest: WebRequestLike, private readonly options: HubOptions = {}) { }

    /** Register our one listener per event and start keeping Discord's own. Safe to call twice. */
    install(): void {
        if (this.installed) return;
        this.installed = true;
        // Electron's own methods, kept before they are replaced.
        const register = {
            beforeRequest: this.webRequest.onBeforeRequest.bind(this.webRequest),
            beforeSendHeaders: this.webRequest.onBeforeSendHeaders.bind(this.webRequest)
        };
        try {
            this.webRequest.onBeforeRequest = (...args: unknown[]) => { this.host.beforeRequest = readRegistration(args); };
            this.webRequest.onBeforeSendHeaders = (...args: unknown[]) => { this.host.beforeSendHeaders = readRegistration(args); };
            this.chaining = true;
        } catch {
            this.chaining = false;
        }
        const filter = { urls: ["<all_urls>"] };
        register.beforeRequest(filter, (details: RequestDetails, callback: Callback) => { this.dispatchRequest(details, callback); });
        register.beforeSendHeaders(filter, (details: RequestDetails, callback: Callback) => { this.dispatchHeaders(details, callback); });
    }

    /** Add a handler at the end of the chain. Returns the function that removes it. */
    add(handler: RequestHandler): () => void {
        this.handlers.push(handler);
        return () => {
            const at = this.handlers.indexOf(handler);
            if (at >= 0) this.handlers.splice(at, 1);
        };
    }

    status(): HubStatus {
        return {
            installed: this.installed,
            chaining: this.chaining,
            handlers: this.handlers.map(h => h.name),
            errors: { ...this.errors },
            host: { beforeRequest: this.host.beforeRequest !== null, beforeSendHeaders: this.host.beforeSendHeaders !== null }
        };
    }

    private fail(handler: RequestHandler, error: unknown): void {
        this.errors[handler.name] = (this.errors[handler.name] ?? 0) + 1;
        try {
            this.options.onError?.(handler.name, error);
        } catch {
            // Reporting must never break a request.
        }
    }

    private dispatchRequest(details: RequestDetails, callback: Callback): void {
        for (const handler of [...this.handlers]) {
            if (!handler.beforeRequest) continue;
            try {
                const answer = handler.beforeRequest(details);
                if (answer && "cancel" in answer && answer.cancel) { callback({ cancel: true }); return; }
                if (answer && "redirectURL" in answer && typeof answer.redirectURL === "string") { callback({ redirectURL: answer.redirectURL }); return; }
            } catch (error) {
                this.fail(handler, error);
            }
        }
        this.callHost(this.host.beforeRequest, details, callback, () => { callback({}); });
    }

    private dispatchHeaders(details: RequestDetails, callback: Callback): void {
        let headers = details.requestHeaders;
        let changed = false;
        for (const handler of [...this.handlers]) {
            if (!handler.beforeSendHeaders) continue;
            try {
                const answer = handler.beforeSendHeaders(headers === details.requestHeaders ? details : { ...details, requestHeaders: headers });
                if (answer && "cancel" in answer && answer.cancel) { callback({ cancel: true }); return; }
                if (answer && "requestHeaders" in answer && answer.requestHeaders) { headers = answer.requestHeaders; changed = true; }
            } catch (error) {
                this.fail(handler, error);
            }
        }
        const given = changed ? { ...details, requestHeaders: headers } : details;
        // What goes back to Electron: Discord's answer, with our header changes kept when it did not set headers itself.
        const answer: Callback = reply => {
            if (changed && reply && !("requestHeaders" in reply) && !reply.cancel) callback({ ...reply, requestHeaders: headers });
            else callback(reply);
        };
        this.callHost(this.host.beforeSendHeaders, given, answer, () => { callback(changed ? { requestHeaders: headers } : {}); });
    }

    /** Call the listener Discord registered, if there is one and its filter covers the address; otherwise (or if it throws) `without` answers. */
    private callHost(host: HostListener | null, details: RequestDetails, answer: Callback, without: () => void): void {
        if (!host || !hostMatches(host, details.url)) {
            without();
            return;
        }
        try {
            host.listener(details, answer);
        } catch {
            // Discord's listener failing must never leave a request waiting.
            without();
        }
    }
}
