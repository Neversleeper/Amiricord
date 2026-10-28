/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The list of patches waiting for their module. A patch is consumed by the first module that contains its `find`
// (unless it is marked `all`). Patches that never find a module are reported at the end.

import { compileModule, CompileOptions, CompileResult, RegisteredPatch } from "./compileModule";

interface Entry {
    patch: RegisteredPatch;
    /** Found a module, whatever happened to it afterwards. */
    matched: boolean;
    /** Not used because of the Discord build range. */
    skipped: boolean;
    consumed: boolean;
}

export class PatchRegistry {
    private entries: Entry[] = [];

    add(patch: RegisteredPatch): void {
        this.entries.push({ patch, matched: false, skipped: false, consumed: false });
    }

    /** Remove every patch of a plugin. Patches already applied to a module stay in it. */
    removeByPlugin(plugin: string): number {
        const before = this.entries.length;
        this.entries = this.entries.filter(e => e.patch.plugin !== plugin);
        return before - this.entries.length;
    }

    private waiting(): Entry[] {
        return this.entries.filter(e => !e.consumed);
    }

    /** Whether any patch still waits for a module. When none does, modules need no inspection at all. */
    hasPending(): boolean {
        return this.entries.some(e => !e.consumed);
    }

    /** Patches that found no module and were not skipped by the build range. */
    neverMatched(): RegisteredPatch[] {
        return this.entries.filter(e => !e.matched && !e.skipped).map(e => e.patch);
    }

    /** Compile one module with the patches that still wait, then consume the ones that found it. */
    compile(moduleId: string, source: string, options: CompileOptions = {}): CompileResult {
        const waiting = this.waiting();
        const result = compileModule(moduleId, source, waiting.map(e => e.patch), options);

        for (const outcome of result.outcomes) {
            const entry = waiting[outcome.index];
            if (outcome.status === "skipped") {
                entry.skipped = true;
                entry.consumed = true;
                continue;
            }
            entry.matched = true;
            if (!entry.patch.all) entry.consumed = true;
        }
        return result;
    }
}
