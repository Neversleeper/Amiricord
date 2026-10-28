/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turning plugins on and off from the Plugins page. A plugin with patches only changes after a restart (its patches are
// applied while Discord loads its modules); every other plugin is started or stopped on the spot, after the plugins it
// needs are running and only if no running plugin needs it. The rules live here; the engine supplies the pieces.
// Changes to the SAME plugin go one after the other, so two quick clicks never interleave a start and a stop; changes to
// DIFFERENT plugins do not wait for each other, so a plugin whose start waits for something in Discord (up to the 60 seconds
// of the finders) never holds the switches of the others. Docs: docs/design-03-settings.md piece F, docs/analysis-45-switch-blocking.md.

import type { Manifest } from "../shared/manifest";
import { needsRestartToToggle } from "../shared/manifest";
import type { PluginState } from "./lifecycle";

export type ToggleResult =
    /** It is now running (or stopped), as asked. */
    | { status: "applied"; }
    /** The choice is saved; it takes effect after the next restart. */
    | { status: "restart-needed"; }
    /** Nothing to do: it was already like that. The choice is saved. */
    | { status: "unchanged"; }
    /** Nothing was changed, for the reason given. */
    | { status: "refused"; reason: string; }
    /** The choice is saved but the plugin did not start; `error` says why. */
    | { status: "failed"; error: string; };

/** What the switch needs to know about a plugin: a small part of its registry entry. */
export interface SwitchPlugin {
    id: string;
    core: boolean;
    dependencies: string[];
    hasPatches: boolean;
    /** The plugin has main-process code, which is loaded only when Discord starts. Missing means no. */
    hasNative?: boolean;
    requiresRestart: Manifest["requiresRestart"];
}

export interface SwitchDeps {
    plugins: readonly SwitchPlugin[];
    /** Names a plugin may list in `dependencies` that are not plugins. */
    engineApis: readonly string[];
    stateOf(id: string): PluginState | undefined;
    errorOf(id: string): string | null;
    start(id: string): Promise<boolean>;
    stop(id: string): Promise<boolean>;
    /**
     * Get the plugin ready to start: load its code, attach its settings, give it to the lifecycle. Returns "restart" when the
     * code turns out to have patches (the build scan missed them), which cannot be applied now.
     */
    prepare(id: string): "ready" | "restart";
    /** Let go of what `prepare` attached, after the plugin stopped. */
    release(id: string): void;
    /** The user's choice as it is now. */
    choiceOf(id: string): boolean | undefined;
    /** Save the user's choice. Returns an error text, or null when it was saved. */
    setChoice(id: string, enabled: boolean): string | null;
    /** Why a plugin cannot run in this session at all (safe mode, quarantine), or undefined. */
    blockedReason(id: string): string | undefined;
}

export class PluginSwitch {
    private readonly byId: Map<string, SwitchPlugin>;
    /** The last change asked of each plugin that has not ended. A new change to the same plugin waits for it; a change to another plugin does not. */
    private readonly locks = new Map<string, Promise<unknown>>();
    /** Starts that are going on right now, by plugin id, so a plugin asked for twice (by a click and by something that needs it) starts once. */
    private readonly starting = new Map<string, Promise<boolean>>();
    /** Plugins whose turning ON is going on (waiting for what they need, or starting). Something they need must not be turned off meanwhile. */
    private readonly turningOn = new Set<string>();
    /** Plugins that are being stopped right now. Something that would need them must not start meanwhile. */
    private readonly stopping = new Set<string>();

    constructor(private readonly deps: SwitchDeps) {
        this.byId = new Map(deps.plugins.map(p => [p.id, p]));
    }

    /** Turn a plugin on or off. Never throws. */
    toggle(id: string, enabled: boolean): Promise<ToggleResult> {
        const previous = this.locks.get(id) ?? Promise.resolve();
        const run: Promise<ToggleResult> = previous.then(() => this.run(id, enabled)).catch((error: unknown): ToggleResult => ({ status: "failed", error: error instanceof Error ? error.message : String(error) }));
        this.locks.set(id, run);
        // Let go of the lock when this change is the last one waiting, so the table does not grow.
        void run.then(() => { if (this.locks.get(id) === run) this.locks.delete(id); });
        return run;
    }

    private isRunning(id: string) {
        return this.deps.stateOf(id) === "started";
    }

    private async run(id: string, enabled: boolean): Promise<ToggleResult> {
        const plugin = this.byId.get(id);
        if (!plugin) return { status: "refused", reason: `there is no plugin called "${id}"` };
        if (plugin.core) return enabled ? { status: "unchanged" } : { status: "refused", reason: "core plugins cannot be turned off" };

        const before = this.deps.choiceOf(id);

        if (needsRestartToToggle(plugin.requiresRestart, plugin.hasPatches, plugin.hasNative === true)) {
            const error = this.deps.setChoice(id, enabled);
            if (error) return { status: "refused", reason: error };
            return before === enabled ? { status: "unchanged" } : { status: "restart-needed" };
        }

        return enabled ? this.turnOn(plugin) : this.turnOff(plugin);
    }

    private async turnOn(plugin: SwitchPlugin): Promise<ToggleResult> {
        const blocked = this.deps.blockedReason(plugin.id);
        if (blocked) return { status: "refused", reason: blocked };
        const error = this.deps.setChoice(plugin.id, true);
        if (error) return { status: "refused", reason: error };
        if (this.isRunning(plugin.id)) return { status: "unchanged" };

        // Everything it needs must be running first. A needed plugin that has to wait for a restart makes this one wait too.
        this.turningOn.add(plugin.id);
        let outcome: Awaited<ReturnType<PluginSwitch["ensureRunning"]>>;
        try {
            outcome = await this.ensureRunning(plugin.id, new Set());
        } finally {
            this.turningOn.delete(plugin.id);
        }
        if (outcome === "restart") return { status: "restart-needed" };
        if (outcome !== "ok") return { status: "failed", error: outcome };
        return { status: "applied" };
    }

    /** "ok" when the plugin is running afterwards, "restart" when it cannot start before a restart, or the error text. */
    private async ensureRunning(id: string, visiting: Set<string>): Promise<"ok" | "restart" | string> {
        // Still running but on its way off: it cannot be counted on.
        if (this.stopping.has(id)) return `needs ${id}, which is being turned off`;
        if (this.isRunning(id)) return "ok";
        if (visiting.has(id)) return `dependency cycle at "${id}"`;
        const plugin = this.byId.get(id);
        if (!plugin) return `needs "${id}", which does not exist`;
        if (needsRestartToToggle(plugin.requiresRestart, plugin.hasPatches, plugin.hasNative === true)) return "restart";
        const blocked = this.deps.blockedReason(id);
        if (blocked) return `needs ${id}, which cannot run (${blocked})`;

        // Somebody else already started it and it has not finished: wait for that start instead of starting it twice.
        const going = this.starting.get(id);
        if (going) {
            await going.catch(() => false);
            return this.isRunning(id) ? "ok" : this.deps.errorOf(id) ?? "did not start";
        }

        visiting.add(id);
        for (const dep of plugin.dependencies) {
            if (this.deps.engineApis.includes(dep)) continue;
            const result = await this.ensureRunning(dep, visiting);
            if (result !== "ok") return result;
        }
        visiting.delete(id);

        if (this.deps.prepare(id) === "restart") return "restart";
        const start = this.deps.start(id);
        this.starting.set(id, start);
        try {
            if (await start) return "ok";
        } finally {
            this.starting.delete(id);
        }
        return this.deps.errorOf(id) ?? "did not start";
    }

    private async turnOff(plugin: SwitchPlugin): Promise<ToggleResult> {
        const users = this.deps.plugins
            .filter(p => p.id !== plugin.id && p.dependencies.includes(plugin.id) && (this.isRunning(p.id) || this.turningOn.has(p.id)))
            .map(p => p.id);
        if (users.length) return { status: "refused", reason: `${users.join(", ")} ${users.length > 1 ? "need" : "needs"} it and ${users.length > 1 ? "are" : "is"} ${users.some(id => this.isRunning(id)) ? "running" : "starting"}` };

        const error = this.deps.setChoice(plugin.id, false);
        if (error) return { status: "refused", reason: error };
        if (!this.isRunning(plugin.id)) return { status: "unchanged" };

        this.stopping.add(plugin.id);
        try {
            const clean = await this.deps.stop(plugin.id);
            this.deps.release(plugin.id);
            return clean ? { status: "applied" } : { status: "failed", error: this.deps.errorOf(plugin.id) ?? "it stopped with errors" };
        } finally {
            this.stopping.delete(plugin.id);
        }
    }
}
