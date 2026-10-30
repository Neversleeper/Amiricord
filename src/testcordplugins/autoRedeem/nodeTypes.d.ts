/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Types for the few Node modules that the main-process code of this plugin imports (native.ts and nightyAlts.ts). The repository's `tsconfig.json`
// has `"types": []`, so the page-side program has no Node typings, and the other plugins' native files use only `host`. These declarations cover
// exactly what AutoRedeem calls and nothing else, and they are modules, not globals: no code in the page can reach `process` or `Buffer` by accident.
// At run time the imports are the real Node modules (the build bundles native files for Node).

declare module "fs" {
    export interface FSWatcher {
        close(): void;
        once(event: string, listener: (...args: unknown[]) => void): FSWatcher;
    }
    export function watch(filename: string, listener: (eventType: string, filename: string | null) => void): FSWatcher;
}

declare module "fs/promises" {
    export interface FileHandle {
        stat(): Promise<{ size: number; }>;
        read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number; }>;
        close(): Promise<void>;
    }
    export function open(path: string, flags: string): Promise<FileHandle>;
}

declare module "path" {
    export function resolve(...paths: string[]): string;
    export const sep: string;
}

declare module "buffer" {
    export interface Buffer extends Uint8Array {
        toString(encoding?: string, start?: number, end?: number): string;
    }
    export const Buffer: { alloc(size: number): Buffer; };
}

declare module "process" {
    const process: { env: Record<string, string | undefined>; };
    export default process;
}

declare module "timers/promises" {
    export function setTimeout<T = void>(delay?: number, value?: T, options?: { signal?: AbortSignal; }): Promise<T>;
}
