/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Finds Discord's main Webpack instance and replaces its module list with the wrapped one.
// Discord loads several Webpack bundles (Sentry, the native layer, the web app). Only the web app's is wanted, so every
// bundle is checked against a set of named signals before it is touched. The signals come from reading Discord's
// bootstrap; they are checked against a fake Webpack in the tests and against the real client on Canary (step 7).
// Design: docs/design-02-core.md section 5.

import { wrapModuleFactories, WrapOptions } from "./moduleWrapper";

export interface MainSignalInput {
    /** Call stack at the moment the bundle assigned its public path. */
    stack: string;
    /** Source text of the bundle's `__webpack_require__` function. */
    requireSource: string;
    /** The public path the bundle set (`__webpack_require__.p`). */
    bundlePath: unknown;
    /** Source text of the bundle's chunk url function (`__webpack_require__.u`), empty when it has none. */
    chunkUrlSource: string;
}

export interface Signal {
    name: string;
    ok: boolean;
}

export interface MainSignalReport {
    main: boolean;
    signals: Signal[];
}

const NOT_THE_APP = /sentry|libdiscore|fast-connect/i;

/** A function whose whole body is one string literal: `() => ""` or `function(){return"x"}`. */
const CONSTANT_FUNCTION = /^(?:[\w$(),\s]*=>\s*|function[^{]*\{\s*return\s*)(["'`])[^"'`]*\1\s*;?\s*\}?\s*$/;

/** Decide whether a Webpack instance is the web app's. Every signal must hold. Never throws. */
export function evaluateMainSignals(input: MainSignalInput): MainSignalReport {
    const file = /\/assets\/(.+?\.js)/.exec(input.stack)?.[1];
    const signals: Signal[] = [
        { name: "script-url", ok: input.stack.includes("http") },
        { name: "known-file", ok: file !== undefined && !NOT_THE_APP.test(file) },
        { name: "require-shape", ok: input.requireSource.includes("exports:{}") },
        { name: "bundle-path", ok: input.bundlePath === "/assets/" },
        // A constant answer means a stub that builds no real chunk addresses.
        { name: "real-chunk-urls", ok: input.chunkUrlSource !== "" && !CONSTANT_FUNCTION.test(input.chunkUrlSource) }
    ];
    return { main: signals.every(s => s.ok), signals };
}

type AnyFunction = Record<string, unknown>;

export interface HookOptions {
    /** Where Webpack's `m` assignment is caught. Discord's bundles are plain functions, so the default is `Function.prototype`. */
    target?: object;
    getStack?: () => string;
    wrapOptions: WrapOptions;
    /** The main instance was found and its modules are now wrapped. */
    onMain?: (wreq: AnyFunction, report: MainSignalReport) => void;
    /** A bundle was looked at and left alone. */
    onRejected?: (report: MainSignalReport) => void;
}

/** Start listening. Returns a function that stops listening. */
export function installWebpackHook(options: HookOptions): () => void {
    const target = options.target ?? Function.prototype;
    const getStack = options.getStack ?? (() => new Error().stack ?? "");
    let stopped = false;

    const stop = () => {
        if (stopped) return;
        stopped = true;
        Reflect.deleteProperty(target, "m");
    };

    const own = (instance: AnyFunction, key: string, value: unknown) =>
        Object.defineProperty(instance, key, { value, writable: true, configurable: true, enumerable: true });

    const watch = (instance: AnyFunction, modules: unknown) => {
        // From here the instance owns a plain `m`, as Webpack expects.
        own(instance, "m", modules);

        Object.defineProperty(instance, "p", {
            configurable: true,
            enumerable: true,
            set(path: unknown) {
                own(instance, "p", path);
                if (stopped || typeof modules !== "object" || modules === null) return;

                const u = instance.u;
                const report = evaluateMainSignals({
                    stack: getStack(),
                    requireSource: Function.prototype.toString.call(instance),
                    bundlePath: path,
                    chunkUrlSource: typeof u === "function" ? Function.prototype.toString.call(u) : ""
                });
                if (!report.main) {
                    options.onRejected?.(report);
                    return;
                }

                instance.m = wrapModuleFactories(modules as Record<string, unknown>, options.wrapOptions);
                stop();
                options.onMain?.(instance, report);
            }
        });
    };

    Object.defineProperty(target, "m", {
        configurable: true,
        enumerable: false,
        set(this: AnyFunction, modules: unknown) {
            watch(this, modules);
        }
    });

    return stop;
}
