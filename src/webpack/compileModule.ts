/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The patch compiler: given the source text of one Discord module and the patches that target it, produce the patched
// source and a report of what happened to every replacement. It only works on text, it never runs the module.
// Design: docs/design-02-core.md section 5.

import { PROJECT_NAME } from "../shared/project";

export interface PatchReplacement {
    /** Text or regular expression to look for in the module. `\i` in a regular expression matches a minified identifier. */
    match: string | RegExp;
    /** New text (`$1` and friends work as in String.replace, `$self` is the plugin) or a function that builds it. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- must accept the same functions as String.replace
    replace: string | ((substring: string, ...args: any[]) => string);
    /**
     * For a global regular expression that adds code to many places: if the result does not parse, try the places one by one and keep the ones that do,
     * instead of dropping the whole replacement. (`arguments`, for example, is not allowed in a class field, but is fine in the same module elsewhere.)
     */
    perMatch?: boolean;
}

export interface PatchDefinition {
    /** Fixed text, or a regular expression, that identifies the module. */
    find: string | RegExp;
    replacements: PatchReplacement[];
    /** All replacements apply, or none of them do. */
    group?: boolean;
    /** Default true. A required patch that does not apply is a failure of its plugin. */
    required?: boolean;
    /**
     * The module is loaded only when a screen opens (Discord's settings tree, for example), so not having found it a few seconds after
     * the start says nothing about the patch. The engine does not report such a patch as "no module matched"; it still applies the moment
     * the module appears. Default false.
     */
    lazy?: boolean;
    /** Apply to every module that contains `find`, not only the first one. */
    all?: boolean;
    /** Range of Discord build numbers the patch was written for. */
    discord?: { minBuild?: number | null; maxBuild?: number | null; };
}

export interface RegisteredPatch extends PatchDefinition {
    /** Id of the plugin that owns the patch. */
    plugin: string;
}

export type ReplacementStatus =
    /** Changed the code. */
    | "applied"
    /** Found nothing to change (or its result was identical). */
    | "no-effect"
    /** Threw while running (a bad regular expression, or a replace function that failed). */
    | "errored"
    /** Applied, then taken back because another replacement of its group failed. */
    | "undone"
    /** Never ran, because an earlier replacement of its group failed. */
    | "not-run"
    /** Made the module unparseable and was dropped by the recovery step. */
    | "syntax-error"
    /** A place-by-place replacement that no place of this module accepts (every one is somewhere the new code is not allowed). Not a problem. */
    | "not-applicable";

export interface ReplacementOutcome {
    /** The match, as text, for the report. */
    match: string;
    status: ReplacementStatus;
    error?: string;
    /** Time spent in this replacement, in milliseconds. */
    ms: number;
}

export type PatchStatus = "applied" | "partial" | "failed" | "undone" | "skipped";

export interface PatchOutcome {
    /** Position of the patch in the list given to `compileModule`. */
    index: number;
    plugin: string;
    find: string;
    moduleId: string;
    required: boolean;
    group: boolean;
    status: PatchStatus;
    replacements: ReplacementOutcome[];
}

export interface CompileOptions {
    /** The Discord build number, or null/undefined when unknown (then build ranges are ignored). */
    build?: number | null;
    /** The text `$self` becomes for a plugin. Defaults to a lookup on the one global entry. */
    selfExpression?: (pluginId: string) => string;
    /** Tells whether code is valid. The default uses the JavaScript engine's own parser without running the code. */
    canParse?: (code: string) => boolean;
}

export interface CompileResult {
    moduleId: string;
    /** The patched function expression, ready to be evaluated. */
    code: string;
    changed: boolean;
    /** Plugins with at least one replacement in the final code. */
    patchedBy: string[];
    /** One entry per patch that targeted this module. */
    outcomes: PatchOutcome[];
    problems: string[];
}

const IDENTIFIER = String.raw`(?:[A-Za-z_$][\w$]*)`;

/** Replace `\i` with a minified identifier pattern. An escaped backslash followed by `i` stays as it is. */
export function expandIdentifiers(source: string): string {
    let out = "";
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === "\\" && i + 1 < source.length) {
            const next = source[i + 1];
            out += next === "i" ? IDENTIFIER : ch + next;
            i++;
        } else {
            out += ch;
        }
    }
    return out;
}

const preparedRegExps = new WeakMap<RegExp, RegExp>();

function prepare(regex: RegExp): RegExp {
    let prepared = preparedRegExps.get(regex);
    if (!prepared) {
        prepared = new RegExp(expandIdentifiers(regex.source), regex.flags);
        preparedRegExps.set(regex, prepared);
    }
    prepared.lastIndex = 0;
    return prepared;
}

/**
 * Turn what `String(factory)` gives into a function expression. Discord's factories are written as methods
 * (`123(e,t,n){...}`), as function expressions or as arrow functions.
 */
export function normalizeFactorySource(source: string): string {
    const text = source.trimStart();
    if (/^(?:async\s+)?(?:\(|[\w$]+\s*=>)/.test(text)) return text;
    return "function" + text.slice(text.indexOf("("));
}

function defaultCanParse(code: string): boolean {
    try {
        // The patch engine must be able to check that patched code is valid before it is used (design 02 s5).
        // eslint-disable-next-line no-new-func
        new Function(`return (\n${code}\n);`);
        return true;
    } catch {
        return false;
    }
}

const defaultSelf = (pluginId: string) => `${PROJECT_NAME}.plugin(${JSON.stringify(pluginId)})`;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const displayOf = (value: string | RegExp) => String(value);

function finds(source: string, find: string | RegExp): boolean {
    if (typeof find === "string") return source.includes(find);
    return prepare(find).test(source);
}

function applyReplacement(code: string, replacement: PatchReplacement, self: string): string {
    const match = typeof replacement.match === "string" ? replacement.match : prepare(replacement.match);
    const { replace } = replacement;
    if (typeof replace === "string") {
        return code.replace(match, replace.split("$self").join(self.replaceAll("$", "$$$$")));
    }
    return code.replace(match, (...args: [string, ...unknown[]]) => String(Reflect.apply(replace, undefined, args)).split("$self").join(self));
}

/**
 * Apply a global regular expression to one place at a time, from the last to the first so earlier positions stay valid, and keep each place only if the
 * code still parses. Returns the code and how many places were kept and tried.
 */
function applyPlaceByPlace(code: string, replacement: PatchReplacement, self: string, canParse: (code: string) => boolean): { code: string; kept: number; tried: number; } {
    if (typeof replacement.match === "string") return { code, kept: 0, tried: 0 };
    const global = prepare(replacement.match);
    const places = [...code.matchAll(global)].map(m => m.index);
    const flags = global.flags.replace("g", "").replace("y", "") + "y";
    let current = code;
    let kept = 0;
    for (const at of places.reverse()) {
        const sticky = new RegExp(global.source, flags);
        sticky.lastIndex = at;
        // Not through `applyReplacement`: it would prepare the expression again and lose where this one must start.
        const { replace } = replacement;
        const next = typeof replace === "string"
            ? current.replace(sticky, replace.split("$self").join(self.replaceAll("$", "$$$$")))
            : current.replace(sticky, (...args: [string, ...unknown[]]) => String(Reflect.apply(replace, undefined, args)).split("$self").join(self));
        if (next !== current && canParse(next)) {
            current = next;
            kept++;
        }
    }
    return { code: current, kept, tried: places.length };
}

const isNumber = (value: number | null | undefined): value is number => typeof value === "number";

function outOfRange(patch: RegisteredPatch, build: number | null | undefined): boolean {
    if (!isNumber(build) || !patch.discord) return false;
    const { minBuild, maxBuild } = patch.discord;
    return (isNumber(minBuild) && build < minBuild) || (isNumber(maxBuild) && build > maxBuild);
}

interface AppliedStep {
    patchIndex: number;
    replacementIndex: number;
}

function statusOfPatch(outcome: PatchOutcome): PatchStatus {
    const applied = outcome.replacements.filter(r => r.status === "applied").length;
    if (applied === outcome.replacements.length && applied > 0) return "applied";
    if (outcome.replacements.some(r => r.status === "undone")) return "undone";
    return applied > 0 ? "partial" : "failed";
}

/** Apply the patches that target one module. Never throws; every problem goes into the result. */
export function compileModule(moduleId: string, source: string, patches: readonly RegisteredPatch[], options: CompileOptions = {}): CompileResult {
    const canParse = options.canParse ?? defaultCanParse;
    const selfOf = options.selfExpression ?? defaultSelf;
    const original = normalizeFactorySource(source);
    const problems: string[] = [];
    const outcomes: PatchOutcome[] = [];

    // Which patches target this module, and which of those are in range for this build.
    const targeting: Array<{ patch: RegisteredPatch; outcome: PatchOutcome; }> = [];
    for (const [index, patch] of patches.entries()) {
        let hit: boolean;
        try {
            hit = finds(original, patch.find);
        } catch (err) {
            problems.push(`the find of ${patch.plugin} is not valid (${(err as Error).message})`);
            continue;
        }
        if (!hit) continue;

        const outcome: PatchOutcome = {
            index,
            plugin: patch.plugin,
            find: displayOf(patch.find),
            moduleId,
            required: patch.required ?? true,
            group: patch.group ?? false,
            status: "failed",
            replacements: patch.replacements.map(r => ({ match: displayOf(r.match), status: "not-run" as ReplacementStatus, ms: 0 }))
        };
        outcomes.push(outcome);
        if (outOfRange(patch, options.build)) {
            outcome.status = "skipped";
            continue;
        }
        targeting.push({ patch, outcome });
    }

    if (targeting.length === 0) {
        return { moduleId, code: original, changed: false, patchedBy: [], outcomes, problems };
    }

    if (!canParse(original)) {
        problems.push(`the source of module ${moduleId} does not parse, so no patch was applied`);
        for (const { outcome } of targeting) {
            outcome.replacements.forEach(r => { r.status = "errored"; r.error = "the module source does not parse"; });
            outcome.status = "failed";
        }
        return { moduleId, code: original, changed: false, patchedBy: [], outcomes, problems };
    }

    // First pass: apply everything in order, remembering what applied.
    let code = original;
    const applied: AppliedStep[] = [];
    targeting.forEach(({ patch, outcome }, patchIndex) => {
        const before = code;
        const appliedBefore = applied.length;
        const self = selfOf(patch.plugin);

        for (let i = 0; i < patch.replacements.length; i++) {
            const result = outcome.replacements[i];
            const started = now();
            let failed = false;
            try {
                const next = applyReplacement(code, patch.replacements[i], self);
                if (next === code) {
                    result.status = "no-effect";
                    failed = true;
                } else {
                    code = next;
                    result.status = "applied";
                    applied.push({ patchIndex, replacementIndex: i });
                }
            } catch (err) {
                result.status = "errored";
                result.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
                failed = true;
            }
            result.ms = now() - started;

            if (failed && patch.group) {
                code = before;
                applied.length = appliedBefore;
                outcome.replacements.forEach((r, j) => {
                    if (j < i && r.status === "applied") r.status = "undone";
                    else if (j > i) r.status = "not-run";
                });
                break;
            }
        }
        outcome.status = statusOfPatch(outcome);
    });

    // Check the result once. Only if it does not parse, find which replacements broke it and drop just those.
    if (!canParse(code)) {
        const byPatch = new Map<number, number[]>();
        for (const step of applied) byPatch.set(step.patchIndex, [...(byPatch.get(step.patchIndex) ?? []), step.replacementIndex]);

        let good = original;
        for (const [patchIndex, indexes] of byPatch) {
            const { patch, outcome } = targeting[patchIndex];
            const self = selfOf(patch.plugin);
            // A group is one unit: it stays whole or goes whole. Other patches go one replacement at a time.
            const units = patch.group ? [indexes] : indexes.map(i => [i]);

            for (const unit of units) {
                let candidate = good;
                const results: Array<[number, ReplacementStatus]> = [];
                for (const i of unit) {
                    try {
                        const next = applyReplacement(candidate, patch.replacements[i], self);
                        results.push([i, next === candidate ? "no-effect" : "applied"]);
                        candidate = next;
                    } catch {
                        results.push([i, "errored"]);
                    }
                }
                const noLongerApplies = results.some(([, status]) => status !== "applied");
                if (!noLongerApplies && canParse(candidate)) {
                    good = candidate;
                } else if (!noLongerApplies && unit.length === 1 && patch.replacements[unit[0]].perMatch) {
                    const placed = applyPlaceByPlace(good, patch.replacements[unit[0]], self, canParse);
                    if (placed.kept > 0) {
                        good = placed.code;
                        if (placed.kept < placed.tried) problems.push(`a replacement by ${patch.plugin} on module ${moduleId} broke the code in ${placed.tried - placed.kept} of ${placed.tried} places, which were left as they were`);
                    } else {
                        outcome.replacements[unit[0]].status = "not-applicable";
                    }
                } else {
                    // Either some replacement no longer matches (an earlier one was dropped), or the unit made the code invalid.
                    for (const [i, status] of results) {
                        outcome.replacements[i].status = status !== "applied" ? status : noLongerApplies ? "undone" : "syntax-error";
                    }
                    problems.push(`a replacement by ${patch.plugin} on module ${moduleId} broke the code and was dropped`);
                }
            }
            outcome.status = statusOfPatch(outcome);
        }
        code = good;
    }

    const patchedBy = [...new Set(targeting.filter(t => t.outcome.replacements.some(r => r.status === "applied")).map(t => t.patch.plugin))];
    return { moduleId, code, changed: code !== original, patchedBy, outcomes, problems };
}
