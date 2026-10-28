/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Wraps Discord's module factories so that, the first time Discord asks for a module, the patch compiler gets to patch it.
// A patched factory is never run twice. If it throws, the original is used only when the failed run left no trace.
// Design: docs/design-02-core.md section 5.

import type { CompileResult } from "./compileModule";
import type { PatchRegistry } from "./patchRegistry";

type Factory = (this: unknown, ...args: unknown[]) => unknown;

export interface FactoryError {
    moduleId: string;
    phase: "evaluate" | "run";
    error: unknown;
    /** Plugins whose patches are in this module. */
    plugins: string[];
    /** The original factory ran in place of the patched one. */
    fellBack: boolean;
}

export interface WrapOptions {
    registry: PatchRegistry;
    /** Turns patched source into a function. The default compiles it with `new Function`. */
    evaluate?: (code: string, moduleId: string) => Factory;
    getBuild?: () => number | null;
    /** Called for every module that was compiled, with the full result (feeds the health report). */
    onCompiled?: (result: CompileResult) => void;
    onError?: (info: FactoryError) => void;
    /** Called after a module finished loading, with its exports (feeds `waitFor`). */
    onModuleLoaded?: (moduleId: string, exports: unknown) => void;
    /** Run the original factory when the patched one threw without leaving any trace. Default true. */
    fallbackToOriginal?: boolean;
}

/** Compile patched source into a factory. Patched code is checked by the compiler before it gets here. */
export function evaluatePatched(code: string, moduleId: string): Factory {
    // Patched Discord modules must be turned into functions at run time; this is the engine's declared use of dynamic code.
    // eslint-disable-next-line no-new-func
    return new Function(`return (\n${code}\n)\n//# sourceURL=AmiricordModule${moduleId}`)() as Factory;
}

const isModuleLike = (value: unknown): value is { exports?: unknown; } => typeof value === "object" && value !== null;

/** A run that touched nothing: the exports object has no property at all, so running the original cannot repeat visible work. */
function leftNoTrace(module: unknown, exportsArg: unknown): boolean {
    const target = isModuleLike(module) && typeof module.exports === "object" && module.exports !== null ? module.exports : exportsArg;
    return typeof target === "object" && target !== null && Reflect.ownKeys(target).length === 0;
}

function makeHandler(moduleId: string, options: WrapOptions): ProxyHandler<Factory> {
    return {
        apply(original, thisArg, args) {
            const { registry } = options;
            let factory = original;
            let compiled: CompileResult | null = null;

            if (registry.hasPending()) {
                compiled = registry.compile(moduleId, Function.prototype.toString.call(original), { build: options.getBuild?.() ?? null });
                options.onCompiled?.(compiled);
                if (compiled.changed) {
                    try {
                        factory = (options.evaluate ?? evaluatePatched)(compiled.code, moduleId);
                    } catch (error) {
                        options.onError?.({ moduleId, phase: "evaluate", error, plugins: compiled.patchedBy, fellBack: true });
                        factory = original;
                    }
                }
            }

            let result: unknown;
            try {
                result = Reflect.apply(factory, thisArg, args);
            } catch (error) {
                const patched = factory !== original;
                const fellBack = patched && options.fallbackToOriginal !== false && leftNoTrace(args[0], args[1]);
                options.onError?.({ moduleId, phase: "run", error, plugins: compiled?.patchedBy ?? [], fellBack });
                if (!fellBack) throw error;
                result = Reflect.apply(original, thisArg, args);
            }

            try {
                options.onModuleLoaded?.(moduleId, isModuleLike(args[0]) ? args[0].exports : undefined);
            } catch {
                // A broken listener must not break Discord's module loading.
            }
            return result;
        },

        // Anything that reads the factory's source (finders, other tools) must see Discord's original text.
        get(original, property) {
            if (property === "toString") return () => Function.prototype.toString.call(original);
            return Reflect.get(original, property, original);
        }
    };
}

/**
 * Wrap every factory in `modules`, and every factory that is added later (Discord loads more modules as the user opens screens).
 * Returns the object Discord must use from now on in place of `modules`.
 */
export function wrapModuleFactories(modules: Record<string, unknown>, options: WrapOptions): Record<string, unknown> {
    const wrapped = new WeakSet<object>();

    const wrapOne = (key: string, value: unknown): unknown => {
        if (typeof value !== "function" || wrapped.has(value)) return value;
        const proxy = new Proxy(value as Factory, makeHandler(key, options));
        wrapped.add(proxy);
        return proxy;
    };

    for (const key of Object.keys(modules)) modules[key] = wrapOne(key, modules[key]);

    return new Proxy(modules, {
        set(target, property, value) {
            return Reflect.set(target, property, typeof property === "string" ? wrapOne(property, value) : value, target);
        }
    });
}
