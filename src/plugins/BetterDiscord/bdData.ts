/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// BdApi.Data: what a BetterDiscord plugin saves between runs. BetterDiscord's functions are synchronous, so the data of every plugin is read into memory before
// the plugin starts (`preload`), reads and writes then work on the memory, and each change is written back to the engine's own storage a moment later.

export interface DataBackend {
    read(plugin: string): Promise<Record<string, unknown> | undefined>;
    write(plugin: string, data: Record<string, unknown>): Promise<void>;
    /** A write that failed (too big, storage missing). The plugin is not told: BetterDiscord's functions have no way to fail. */
    onError?(plugin: string, error: unknown): void;
}

export interface BdData {
    preload(plugin: string): Promise<void>;
    save(plugin: string, key: string, value: unknown): void;
    load(plugin: string, key: string): unknown;
    delete(plugin: string, key: string): void;
    /** Drop what is in memory for a plugin and read it again from the backend. */
    recache(plugin: string): Promise<void>;
    /** Wait until the pending writes are done (used by tests and before a restart). */
    flush(): Promise<void>;
}

export function createBdData(backend: DataBackend, options: { delayMs?: number; setTimeout?: (run: () => void, ms: number) => unknown; } = {}): BdData {
    const memory = new Map<string, Record<string, unknown>>();
    const dirty = new Set<string>();
    const pending = new Set<Promise<void>>();
    const delay = options.delayMs ?? 250;
    const later = options.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    let scheduled = false;

    const write = (plugin: string): void => {
        const data = memory.get(plugin);
        if (!data) return;
        const job = backend.write(plugin, JSON.parse(JSON.stringify(data)) as Record<string, unknown>).catch((error: unknown) => { backend.onError?.(plugin, error); });
        pending.add(job);
        void job.finally(() => pending.delete(job));
    };
    const writeAll = () => {
        scheduled = false;
        for (const plugin of [...dirty]) {
            dirty.delete(plugin);
            write(plugin);
        }
    };
    const touch = (plugin: string) => {
        dirty.add(plugin);
        if (scheduled) return;
        scheduled = true;
        later(writeAll, delay);
    };
    const dataOf = (plugin: string): Record<string, unknown> => {
        let data = memory.get(plugin);
        if (!data) {
            data = {};
            memory.set(plugin, data);
        }
        return data;
    };

    return {
        async preload(plugin) {
            if (memory.has(plugin)) return;
            // A copy: what the backend hands over may be an object it keeps, and the plugin's changes must reach it only through `write`.
            const stored = await backend.read(plugin);
            memory.set(plugin, stored ? JSON.parse(JSON.stringify(stored)) as Record<string, unknown> : {});
        },
        async recache(plugin) {
            memory.delete(plugin);
            await this.preload(plugin);
        },
        save(plugin, key, value) {
            // A value is stored as JSON, as BetterDiscord does; one that cannot be (a cycle, a function) is refused with the same kind of error.
            dataOf(plugin)[String(key)] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
            touch(plugin);
        },
        load(plugin, key) {
            const value = dataOf(plugin)[String(key)];
            return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        },
        delete(plugin, key) {
            delete dataOf(plugin)[String(key)];
            touch(plugin);
        },
        async flush() {
            if (dirty.size > 0) writeAll();
            await Promise.all([...pending]);
        }
    };
}
