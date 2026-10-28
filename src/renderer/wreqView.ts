/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Gives the finders a view of Discord's Webpack: the module list (`m`), the cache of modules that already ran (`c`)
// and the require function itself.

import type { ModuleView } from "../webpack/finders";

export interface WreqLike {
    (id: string): unknown;
    m: Record<string, unknown>;
    c?: Record<string, { exports?: unknown; } | undefined>;
}

/** A view over an instance that may not exist yet. Until `wreq` is set, nothing is found and nothing is run. */
export class WreqView implements ModuleView {
    wreq: WreqLike | null = null;

    /**
     * The exports of every module that has run since the hook was installed, noted by the module wrapper.
     * Discord's bundler (rspack) does not expose the module cache (`wreq.c`), so this is the only way to know what already ran.
     */
    private readonly loaded = new Map<string, unknown>();

    record(id: string, exports: unknown): void {
        this.loaded.set(id, exports);
    }

    /** Development aid: what the view knows, without any value. Used by the dev-mode debug dump. */
    debugSummary(needleKey: string) {
        const withNeedle: Array<{ id: string; keys: string[]; innerType: string; innerKeys: string[]; innerRoot: string; }> = [];
        for (const [id, exports] of this.loaded) {
            try {
                if (typeof exports === "object" && exports !== null && needleKey in exports) {
                    const inner = (exports as Record<string, unknown>)[needleKey];
                    withNeedle.push({
                        id,
                        keys: Object.keys(exports).slice(0, 12),
                        innerType: typeof inner,
                        innerKeys: typeof inner === "object" && inner !== null ? Object.keys(inner).slice(0, 30) : [],
                        innerRoot: typeof inner === "object" && inner !== null ? typeof (inner as Record<string, unknown>).ROOT : "-"
                    });
                }
            } catch {
                // A module with strange exports is simply not listed.
            }
        }
        return {
            hasInstance: this.wreq !== null,
            hasModuleCache: this.wreq?.c !== undefined,
            factories: this.ids().length,
            loaded: this.loaded.size,
            loadedSample: [...this.loaded.keys()].slice(0, 10),
            withNeedle: withNeedle.slice(0, 5)
        };
    }

    /**
     * Development aid: look for texts in the source of Discord's module factories (the same text DevTools shows).
     * Returns, for each needle, where it was found with a little code around it, and whether that module has already run (`loaded`). Never runs any module.
     * Only factories that Discord has registered are searched: a lazy chunk that was not downloaded yet is not there at all, which is not the same as a module that
     * is there but has not run.
     */
    searchSources(needles: readonly string[], maxHits = 4, context = 1500) {
        const found: Record<string, Array<{ id: string; length: number; snippet: string; loaded: boolean; }>> = Object.fromEntries(needles.map(n => [n, []]));
        const wreq = this.wreq;
        if (!wreq) return found;
        for (const id of Object.keys(wreq.m)) {
            let text: string;
            try {
                text = String(wreq.m[id]);
            } catch {
                continue;
            }
            for (const needle of needles) {
                if (found[needle].length >= maxHits) continue;
                const at = text.indexOf(needle);
                if (at >= 0) found[needle].push({ id, length: text.length, snippet: text.slice(Math.max(0, at - context), at + context), loaded: this.loaded.has(id) || wreq.c?.[id] !== undefined });
            }
        }
        return found;
    }

    ids(): string[] {
        return this.wreq ? Object.keys(this.wreq.m) : [];
    }

    exportsOf(id: string, load: boolean): unknown {
        if (this.loaded.has(id)) return this.loaded.get(id);
        const wreq = this.wreq;
        if (!wreq) return undefined;
        const cached = wreq.c?.[id];
        if (cached) return cached.exports;
        // Running a module is what a finder asks for only when it already knows the module can match.
        return load ? wreq(id) : undefined;
    }

    sourceOf(id: string): string | undefined {
        const factory = this.wreq?.m[id];
        // The wrapped factories answer `toString()` with Discord's original text. `Function.prototype.toString.call`
        // would not: on a proxy it says "[native code]".
        return typeof factory === "function" ? String(factory) : undefined;
    }
}
