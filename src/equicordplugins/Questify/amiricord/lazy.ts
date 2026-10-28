/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function lazyOf<T>(resolve: () => T | undefined, description: string): T {
    let value: T | undefined;
    const real = (): NonNullable<T> => {
        value ??= resolve();
        if (value === undefined || value === null) throw new Error(`Questify: ${description} was not found in Discord's code`);
        return value as NonNullable<T>;
    };
    const target = function () { } as unknown as object;
    return new Proxy(target, {
        get(_target, key) {
            const object = real() as unknown as Record<PropertyKey, unknown>;
            const found = Reflect.get(object, key, object);
            return typeof found === "function" ? (found as (...args: unknown[]) => unknown).bind(object) : found;
        },
        set(_target, key, newValue) {
            const object = real() as unknown as object;
            return Reflect.set(object, key, newValue, object);
        },
        has: (_target, key) => Reflect.has(real() as unknown as object, key),
        ownKeys: () => Reflect.ownKeys(real() as unknown as object),
        getOwnPropertyDescriptor: (_target, key) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(real() as unknown as object, key);
            return descriptor && { ...descriptor, configurable: true };
        },
        getPrototypeOf: () => Reflect.getPrototypeOf(real() as unknown as object),
        apply: (_target, thisArg, args) => Reflect.apply(real() as unknown as (...args: unknown[]) => unknown, thisArg, args),
        construct: (_target, args) => Reflect.construct(real() as unknown as new (...args: unknown[]) => object, args)
    }) as unknown as T;
}
