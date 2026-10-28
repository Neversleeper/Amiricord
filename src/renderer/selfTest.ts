/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The privacy self-test of the start: does the client tell Discord that it has mods? Two checks, both read-only:
//  - "super-properties": the properties object Discord builds, read as soon as the module that builds it is found.
//  - "first-gateway-message": the first messages the page sends on the gateway (WebSocket), looked at for a short while and then released.
// Only a verdict, a send number and a time are kept: no token, no message content, no other property.
// A failure only reports; "not seen" is never a pass. Design: docs/design-05-privacy-engine.md section 3 and docs/analysis-13-has-client-mods-selftest.md.

import { readFlagFrom, readFlagFromSuperProperties } from "../shared/modFlag";

export type SelfTestName = "super-properties" | "first-gateway-message";
export type SelfTestStatus = "pass" | "fail" | "not-seen";

export interface SelfTestResult {
    name: SelfTestName;
    status: SelfTestStatus;
    /** A short sentence for the report. Never holds content of a message. */
    detail: string;
    /** Milliseconds since the self-test started. */
    ms: number;
}

/** The part of the page's WebSocket class this needs. */
export interface WebSocketLike {
    prototype: { send: (this: unknown, ...args: unknown[]) => unknown; };
}

export interface SelfTestOptions {
    /** The page's WebSocket class. Missing means there is nothing to watch (reported as not seen). */
    webSocket?: WebSocketLike;
    /** Gives the base64 text of Discord's super properties once its module is available, or undefined while it is not. May throw. */
    getSuperProperties?: () => unknown;
    /** Gets every result once. Must not throw (a throw is swallowed). */
    report: (result: SelfTestResult) => void;
    now?: () => number;
    later?: (work: () => void, ms: number) => void;
    /** Sends looked at on the gateway. Default 40. */
    maxSends?: number;
    /** Longest wait for each check, in milliseconds. Default 60 000. */
    maxMs?: number;
    /** How often the properties are tried again, in milliseconds. Default 1000. */
    pollMs?: number;
}

export interface SelfTest {
    /** Copies of the results so far. */
    results(): SelfTestResult[];
}

export const DEFAULT_MAX_SENDS = 40;
export const DEFAULT_MAX_MS = 60_000;

const defaultNow = () => {
    const perf = (globalThis as { performance?: { now(): number; }; }).performance;
    return perf ? perf.now() : Date.now();
};
const defaultLater = (work: () => void, ms: number) => { setTimeout(work, ms); };

export function startSelfTest(options: SelfTestOptions): SelfTest {
    const now = options.now ?? defaultNow;
    const later = options.later ?? defaultLater;
    const maxSends = options.maxSends ?? DEFAULT_MAX_SENDS;
    const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
    const pollMs = options.pollMs ?? 1000;
    const started = now();
    const results: SelfTestResult[] = [];

    const finish = (name: SelfTestName, status: SelfTestStatus, detail: string) => {
        const result: SelfTestResult = { name, status, detail, ms: Math.max(0, Math.round(now() - started)) };
        results.push(result);
        try {
            options.report({ ...result });
        } catch {
            // Reporting must never disturb Discord.
        }
    };

    watchGateway(options.webSocket, { maxSends, maxMs, later, finish: (status, detail) => finish("first-gateway-message", status, detail) });
    watchProperties(options.getSuperProperties, { maxMs, pollMs, later, now, started, finish: (status, detail) => finish("super-properties", status, detail) });

    return { results: () => results.map(r => ({ ...r })) };
}

// ---------------------------------------------------------------------------------------------------------------------

interface GatewayDeps {
    maxSends: number;
    maxMs: number;
    later: (work: () => void, ms: number) => void;
    finish: (status: SelfTestStatus, detail: string) => void;
}

function watchGateway(webSocket: WebSocketLike | undefined, deps: GatewayDeps): void {
    if (!webSocket?.prototype || typeof webSocket.prototype.send !== "function") {
        deps.finish("not-seen", "the page has no WebSocket to watch");
        return;
    }
    const proto = webSocket.prototype;
    const original = proto.send;
    let sends = 0;
    let unsupported = 0;
    let unreadableAt = 0;
    let done = false;
    let stuck = false;

    const end = (status: SelfTestStatus, detail: string) => {
        if (done) return;
        done = true;
        try {
            if (proto.send === wrapper) proto.send = original;
            else stuck = true;
        } catch {
            stuck = true;
        }
        deps.finish(status, stuck ? `${detail} (the watcher could not be removed: it only passes messages through now)` : detail);
    };

    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        // Discord's own send first, with its own arguments; what it returns or throws is what the caller gets.
        const returned = Reflect.apply(original, this, args);
        if (!done) {
            try {
                sends++;
                const value = readFlagFrom(args[0]);
                if (value === "false") end("pass", `has_client_mods was false in gateway send number ${sends}`);
                else if (value === "true") end("fail", `has_client_mods was TRUE in gateway send number ${sends}`);
                else if (value === "unreadable" && !unreadableAt) unreadableAt = sends;
                else if (value === "unsupported") unsupported++;
                if (!done && sends >= deps.maxSends) {
                    end("not-seen", unreadableAt
                        ? `the key was in send number ${unreadableAt} but its value could not be read`
                        : `none of the first ${sends} gateway sends carried the key${unsupported ? ` (${unsupported} could not be read)` : ""}`);
                }
            } catch {
                // Looking must never disturb Discord's send.
            }
        }
        return returned;
    };

    try {
        proto.send = wrapper as WebSocketLike["prototype"]["send"];
    } catch {
        done = true;
        deps.finish("not-seen", "the page's WebSocket could not be watched");
        return;
    }

    deps.later(() => {
        end("not-seen", unreadableAt
            ? `the key was in send number ${unreadableAt} but its value could not be read`
            : `no gateway send carried the key within ${Math.round(deps.maxMs / 1000)} seconds (${sends} sends seen)`);
    }, deps.maxMs);
}

// ---------------------------------------------------------------------------------------------------------------------

interface PropertiesDeps {
    maxMs: number;
    pollMs: number;
    later: (work: () => void, ms: number) => void;
    now: () => number;
    started: number;
    finish: (status: SelfTestStatus, detail: string) => void;
}

function watchProperties(get: (() => unknown) | undefined, deps: PropertiesDeps): void {
    if (!get) {
        deps.finish("not-seen", "there is no way to read Discord's properties in this page");
        return;
    }
    let done = false;
    const poll = () => {
        if (done) return;
        let raw: unknown;
        try {
            raw = get();
        } catch {
            raw = undefined;
        }
        if (raw !== undefined) {
            const value = readFlagFromSuperProperties(raw);
            done = true;
            if (value === "false") deps.finish("pass", "has_client_mods is false in Discord's properties");
            else if (value === "true") deps.finish("fail", "has_client_mods is TRUE in Discord's properties");
            else deps.finish("not-seen", "Discord's properties did not hold a readable has_client_mods");
            return;
        }
        if (deps.now() - deps.started >= deps.maxMs) {
            done = true;
            deps.finish("not-seen", `the module that builds Discord's properties was not found within ${Math.round(deps.maxMs / 1000)} seconds`);
            return;
        }
        deps.later(poll, deps.pollMs);
    };
    poll();
}
