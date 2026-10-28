/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PatchDefinition, PatchReplacement } from "../../../webpack/compileModule";

export interface VencordPatch {
    find: string | RegExp;
    replacement: PatchReplacement | PatchReplacement[];
    predicate?(): boolean;
    group?: boolean;
    all?: boolean;
}

export function adaptPatches(patches: readonly VencordPatch[]): PatchDefinition[] {
    return patches
        .filter(patch => patch.predicate?.() ?? true)
        .map(({ predicate: _predicate, replacement, ...rest }) => ({
            ...rest,
            replacements: Array.isArray(replacement) ? replacement : [replacement],
            required: false
        }));
}
