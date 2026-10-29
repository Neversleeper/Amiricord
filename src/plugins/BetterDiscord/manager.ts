/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- a BetterDiscord plugin can be anything */

// Keeps the list of the BetterDiscord plugins bundled in the build and starts and stops them. A plugin is read (its header only) when the layer starts; its code runs the
// first time it is switched on, and a fresh copy runs each time it is switched on again. The list of plugins that are on is kept in the layer's own storage. A plugin that
// fails to run, start or stop is marked failed with the reason and everything it added is taken away; the others go on.

import type { CreatedBdApi } from "./bdApi";
import type { BdData } from "./bdData";
import { type BdMeta, idOf, parseBdMeta } from "./meta";
import type { RunInput } from "./runner";

export interface BdSourceFile {
    file: string;
    code: string;
}

export type BdState = "off" | "on" | "failed";

export interface BdPluginInfo {
    id: string;
    file: string;
    name: string;
    version: string;
    author: string;
    description: string;
    source?: string;
    website?: string;
    state: BdState;
    error?: string;
    hasSettings: boolean;
}

export interface ManagerDeps {
    data: BdData;
    /** A fresh `BdApi` for one plugin. */
    makeApi(name: string): CreatedBdApi;
    run(input: RunInput): any;
    page: unknown;
    /** The ids of the plugins that are on, kept between runs. */
    readEnabled(): Promise<string[]>;
    writeEnabled(ids: string[]): Promise<void>;
    report(plugin: string, where: string, error: unknown): void;
    /** A MutationObserver constructor and the node to watch, for plugins that define `observer(mutation)`; absent in tests without a page. */
    watch?(callback: (mutations: MutationRecord[]) => void): () => void;
}

interface Entry {
    meta: BdMeta;
    id: string;
    file: string;
    code: string;
    state: BdState;
    error?: string;
    instance?: any;
    api?: CreatedBdApi;
    stopWatching?: () => void;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class BdManager {
    private readonly entries = new Map<string, Entry>();
    private readonly listeners = new Set<() => void>();
    private enabled = new Set<string>();

    constructor(private readonly deps: ManagerDeps) {}

    /** Read the headers. Two files with the same name: the first is kept and the second is listed as failed. */
    register(files: readonly BdSourceFile[]): void {
        for (const { file, code } of files) {
            const meta = parseBdMeta(code, file);
            const id = idOf(meta.name) || idOf(file);
            if (this.entries.has(id)) {
                this.entries.set(`${id}_${file}`.replace(/[^A-Za-z0-9_]/g, "_"), { meta, id, file, code, state: "failed", error: `another file already uses the name ${meta.name}` });
                continue;
            }
            this.entries.set(id, { meta, id, file, code, state: "off" });
        }
    }

    list(): BdPluginInfo[] {
        return [...this.entries.values()].map(e => ({
            id: e.id, file: e.file, name: e.meta.name, version: e.meta.version, author: e.meta.author, description: e.meta.description,
            source: e.meta.source, website: e.meta.website, state: e.state, error: e.error,
            hasSettings: e.state === "on" && typeof e.instance?.getSettingsPanel === "function"
        }));
    }

    /** For `BdApi.Plugins`: running or not, with the plugin object. */
    instances(): Array<{ id: string; name: string; enabled: boolean; instance: unknown; }> {
        return [...this.entries.values()].map(e => ({ id: e.id, name: e.meta.name, enabled: e.state === "on", instance: e.instance }));
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    private changed(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A screen that failed to refresh does not stop the manager.
            }
        }
    }

    /** Switch on the plugins the person left on at the last run. */
    async startSaved(): Promise<void> {
        this.enabled = new Set(await this.deps.readEnabled());
        for (const id of this.enabled) {
            if (this.entries.has(id)) await this.start(id);
        }
    }

    private async remember(id: string, on: boolean): Promise<void> {
        if (on) this.enabled.add(id); else this.enabled.delete(id);
        try {
            await this.deps.writeEnabled([...this.enabled]);
        } catch (error) {
            this.deps.report(id, "saving the list of plugins that are on", error);
        }
    }

    /** Switch a plugin on and remember it. Returns false when it failed (the reason is in its entry). */
    async enable(id: string): Promise<boolean> {
        await this.remember(id, true);
        return this.start(id);
    }

    /** Switch a plugin off and remember it. */
    async disable(id: string): Promise<void> {
        await this.remember(id, false);
        this.stop(id);
    }

    async reload(id: string): Promise<boolean> {
        this.stop(id);
        return this.start(id);
    }

    private async start(id: string): Promise<boolean> {
        const entry = this.entries.get(id);
        if (!entry) return false;
        if (entry.state === "on") return true;
        entry.error = undefined;
        entry.state = "off";
        let api: CreatedBdApi | undefined;
        try {
            await this.deps.data.preload(entry.meta.name);
            api = this.deps.makeApi(entry.meta.name);
            const instance = this.deps.run({ source: entry.code, fileName: entry.file, meta: entry.meta, bdApi: api.BdApi, page: this.deps.page });
            entry.api = api;
            entry.instance = instance;
            if (typeof instance.load === "function" && typeof instance.start === "function") instance.load();
            const starter = instance.start ?? instance.onStart ?? instance.load;
            await starter.call(instance);
            if (typeof instance.observer === "function" && this.deps.watch) {
                entry.stopWatching = this.deps.watch(mutations => {
                    for (const mutation of mutations) {
                        try {
                            instance.observer(mutation);
                        } catch (error) {
                            this.deps.report(entry.meta.name, "observer", error);
                        }
                    }
                });
            }
            entry.state = "on";
        } catch (error) {
            entry.state = "failed";
            entry.error = describe(error);
            this.deps.report(entry.meta.name, "start", error);
            // A plugin that stopped half way is stopped as far as it can be, and its patches and styles go.
            this.safeStop(entry);
            api?.dispose();
            entry.api = undefined;
            entry.instance = undefined;
        }
        this.changed();
        return entry.state === "on";
    }

    private safeStop(entry: Entry): void {
        entry.stopWatching?.();
        entry.stopWatching = undefined;
        const instance = entry.instance;
        if (!instance) return;
        const stopper = instance.stop ?? instance.onStop ?? instance.unload;
        if (typeof stopper !== "function") return;
        try {
            stopper.call(instance);
        } catch (error) {
            this.deps.report(entry.meta.name, "stop", error);
        }
    }

    private stop(id: string): void {
        const entry = this.entries.get(id);
        if (!entry || entry.state !== "on") return;
        this.safeStop(entry);
        entry.api?.dispose();
        entry.api = undefined;
        entry.instance = undefined;
        entry.state = "off";
        this.changed();
    }

    /** What the plugin draws in its settings window, or undefined. A plugin whose `getSettingsPanel` throws is reported and has no panel. */
    settingsPanelOf(id: string): unknown {
        const entry = this.entries.get(id);
        if (entry?.state !== "on" || typeof entry.instance?.getSettingsPanel !== "function") return undefined;
        try {
            return entry.instance.getSettingsPanel();
        } catch (error) {
            this.deps.report(entry.meta.name, "getSettingsPanel", error);
            return undefined;
        }
    }

    /** Stop every plugin that is on without forgetting that it is on (the layer itself is stopping). */
    stopAll(): void {
        for (const id of [...this.entries.keys()]) this.stop(id);
    }
}
