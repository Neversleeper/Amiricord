/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Starts and stops plugins. A plugin that fails to start is rolled back completely, never left half started.
// Everything a plugin registers goes through its context and leaves an undo behind.
// Design: docs/design-02-core.md section 7.

import type { Stage } from "../shared/manifest";

export type Undo = () => void | Promise<void>;

export interface PluginContext {
    readonly id: string;
    /** Register how to undo something this plugin set up. Undos run in reverse order on stop or on a failed start. */
    onDispose(undo: Undo): void;
}

/** What the lifecycle needs to know about one plugin. The registry gives the data, the plugin's code gives the functions. */
export interface PluginRuntime {
    id: string;
    startAt: Stage;
    deferrable: boolean;
    dependencies: string[];
    start?(ctx: PluginContext): void | Promise<void>;
    stop?(ctx: PluginContext): void | Promise<void>;
}

export type PluginState = "idle" | "starting" | "started" | "failed" | "stopping";

export type LifecycleEvent =
    | { type: "started"; plugin: string; ms: number; }
    /** `rolledBack` is how many undos ran. */
    | { type: "start-failed"; plugin: string; error: string; rolledBack: number; }
    | { type: "stopped"; plugin: string; }
    | { type: "stop-error"; plugin: string; error: string; }
    | { type: "dispose-error"; plugin: string; error: string; };

export interface LifecycleOptions {
    onEvent?: (event: LifecycleEvent) => void;
    now?: () => number;
    /** Milliseconds a start pass may run before it hands control back to the page. Default 12. */
    sliceMs?: number;
    yieldToEventLoop?: () => Promise<void>;
    /** Runs work later, when the page is idle. Without it, deferrable plugins start in the normal pass. */
    defer?: (work: () => void) => void;
}

export interface StageResult {
    started: string[];
    failed: Array<{ id: string; error: string; }>;
    /** Plugins left to start later through `defer`. Their result arrives as events. */
    deferred: string[];
}

interface Entry {
    runtime: PluginRuntime;
    state: PluginState;
    error: string | null;
    undos: Undo[];
}

const describe = (value: unknown) => (value instanceof Error ? `${value.name}: ${value.message}` : String(value));

export class PluginLifecycle {
    private readonly entries = new Map<string, Entry>();

    constructor(runtimes: readonly PluginRuntime[], private readonly options: LifecycleOptions = {}) {
        for (const runtime of runtimes) this.entries.set(runtime.id, { runtime, state: "idle", error: null, undos: [] });
    }

    /** Whether a plugin is known to this lifecycle (it may be idle, running or failed). */
    has(id: string): boolean {
        return this.entries.has(id);
    }

    /** Add a plugin after the lifecycle was made, for one switched on while Discord runs. False if the id is already known. */
    add(runtime: PluginRuntime): boolean {
        if (this.entries.has(runtime.id)) return false;
        this.entries.set(runtime.id, { runtime, state: "idle", error: null, undos: [] });
        return true;
    }

    stateOf(id: string): PluginState | undefined {
        return this.entries.get(id)?.state;
    }

    errorOf(id: string): string | null {
        return this.entries.get(id)?.error ?? null;
    }

    private now() {
        return (this.options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now())))();
    }

    private emit(event: LifecycleEvent) {
        try {
            this.options.onEvent?.(event);
        } catch {
            // A broken listener must not break the lifecycle.
        }
    }

    private contextFor(entry: Entry): PluginContext {
        return { id: entry.runtime.id, onDispose: undo => { entry.undos.push(undo); } };
    }

    /** Run every undo, last registered first. All of them run even if some fail. Returns how many ran and how many failed. */
    private async runUndos(entry: Entry): Promise<{ ran: number; failed: number; }> {
        const undos = entry.undos.splice(0).reverse();
        let failed = 0;
        for (const undo of undos) {
            try {
                await undo();
            } catch (err) {
                failed++;
                this.emit({ type: "dispose-error", plugin: entry.runtime.id, error: describe(err) });
            }
        }
        return { ran: undos.length, failed };
    }

    private fail(entry: Entry, error: string, rolledBack: number): false {
        entry.state = "failed";
        entry.error = error;
        this.emit({ type: "start-failed", plugin: entry.runtime.id, error, rolledBack });
        return false;
    }

    /** Start one plugin. Returns true when it is running afterwards. Never throws. */
    async startPlugin(id: string): Promise<boolean> {
        const entry = this.entries.get(id);
        if (!entry) return false;
        if (entry.state === "started") return true;
        if (entry.state === "starting" || entry.state === "stopping") return false;

        for (const dep of entry.runtime.dependencies) {
            const needed = this.entries.get(dep);
            if (needed && needed.state !== "started") {
                return this.fail(entry, `needs ${dep}, which is not running`, 0);
            }
        }

        entry.state = "starting";
        entry.error = null;
        entry.undos = [];
        const startedAt = this.now();

        try {
            await entry.runtime.start?.(this.contextFor(entry));
        } catch (err) {
            const { ran } = await this.runUndos(entry);
            return this.fail(entry, describe(err), ran);
        }

        entry.state = "started";
        this.emit({ type: "started", plugin: id, ms: this.now() - startedAt });
        return true;
    }

    /** Stop one plugin: its own `stop`, then every undo in reverse. Returns true when nothing went wrong. */
    async stopPlugin(id: string): Promise<boolean> {
        const entry = this.entries.get(id);
        if (!entry || entry.state !== "started") return false;

        entry.state = "stopping";
        let ok = true;
        try {
            await entry.runtime.stop?.(this.contextFor(entry));
        } catch (err) {
            ok = false;
            this.emit({ type: "stop-error", plugin: id, error: describe(err) });
        }
        const { failed } = await this.runUndos(entry);
        if (failed > 0) ok = false;

        entry.state = "idle";
        this.emit({ type: "stopped", plugin: id });
        return ok;
    }

    /**
     * Start the plugins of one stage, in the order given (dependencies first). Time slicing keeps the page responsive.
     * A deferrable plugin that nothing else needs waits for `defer` when it is available.
     */
    async startStage(stage: Stage, enabledInOrder: readonly string[]): Promise<StageResult> {
        const { sliceMs = 12, defer } = this.options;
        const yieldNow = this.options.yieldToEventLoop ?? (() => new Promise<void>(resolve => { setTimeout(resolve, 0); }));
        const needed = new Set(enabledInOrder.flatMap(id => this.entries.get(id)?.runtime.dependencies ?? []));
        const result: StageResult = { started: [], failed: [], deferred: [] };

        const run = async (id: string) => {
            if (await this.startPlugin(id)) result.started.push(id);
            else result.failed.push({ id, error: this.errorOf(id) ?? "did not start" });
        };

        let sliceStart = this.now();
        for (const id of enabledInOrder) {
            const entry = this.entries.get(id);
            if (!entry || entry.runtime.startAt !== stage) continue;

            if (defer && entry.runtime.deferrable && !needed.has(id)) {
                result.deferred.push(id);
                continue;
            }

            await run(id);
            if (this.now() - sliceStart > sliceMs) {
                await yieldNow();
                sliceStart = this.now();
            }
        }

        if (defer && result.deferred.length > 0) {
            const later = [...result.deferred];
            defer(() => {
                void (async () => {
                    for (const id of later) await this.startPlugin(id);
                })();
            });
        }
        return result;
    }
}
