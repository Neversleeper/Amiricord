/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How a plugin's page code calls its own main-process functions (its `native` file). A call is a message with the plugin's id, the function name and the arguments;
// the main process checks it (`src/main/nativeHost.ts`) and the answer is either a value or an error that becomes a rejected promise. Without the bridge, or when the
// main process says no, only that call fails: the plugin decides what to show. Design: docs/analysis-29-plugin-native-bridge.md.

/** What the preload gives the page: one function that sends the message and waits for the answer. */
export type NativeBridge = (message: unknown) => Promise<unknown>;

export interface PluginNativeCaller {
    /** Call a native function by name. Rejects with an `Error` that names the plugin when the call is refused or the function fails. */
    call(fn: string, ...args: unknown[]): Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function buildNative(plugin: string, bridge: NativeBridge | undefined): PluginNativeCaller {
    return {
        async call(fn, ...args) {
            if (!bridge) throw new Error(`${plugin}: the main process is not reachable, so native functions are not available`);
            let answer: unknown;
            try {
                answer = await bridge({ plugin, fn, args });
            } catch (error) {
                throw new Error(`${plugin}: ${fn} could not be called (${error instanceof Error ? error.message : String(error)})`);
            }
            if (!isRecord(answer) || typeof answer.ok !== "boolean") throw new Error(`${plugin}: the main process gave an answer for ${fn} that cannot be read`);
            if (!answer.ok) throw new Error(typeof answer.error === "string" ? answer.error : `${plugin}: ${fn} failed`);
            return answer.value;
        }
    };
}

/**
 * What a plugin sees of its own native file: every exported function, without the first parameter (the `host` the main process hands in), answering with a promise.
 * Use it with the file's own type: `nativeOf<typeof import("./native")>(ctx.native)`.
 */
export type NativeFunctions<T> = {
    [K in keyof T as T[K] extends (host: never, ...args: never[]) => unknown ? K : never]:
    T[K] extends (host: never, ...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

/** A typed view of the native functions: `native.search(query)` calls `search` in the main process. */
export function nativeOf<T>(caller: PluginNativeCaller): NativeFunctions<T> {
    return new Proxy({}, {
        // Only plain names become calls: a symbol, or `then` (so the view is never taken for a promise), does not.
        get: (_target, name) => (typeof name === "string" && name !== "then" ? (...args: unknown[]) => caller.call(name, ...args) : undefined)
    }) as NativeFunctions<T>;
}
