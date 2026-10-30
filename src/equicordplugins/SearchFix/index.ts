/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SearchFix (author Jaxx) as found in Equicord's copy of Vencord's plugins. Same patch and same rule. Discord only answers for the first 5000 results of a search (this is what causes the error), so the plugin jumps to the opposite sort order when you ask past that; a result that neither order reaches shows offset 0.

import type { PluginCode } from "../../renderer/engine";

const MAX_OFFSET = 5000;

interface SearchQuery { offset: number; sort_order?: string; }

/** Turns a search that asks past the limit into one the other sort order can answer. */
export function fixQuery(query: SearchQuery): void {
    if (query.offset <= MAX_OFFSET) return;
    query.sort_order = query.sort_order === "asc" ? "desc" : "asc";
    query.offset = 0;
}

const plugin: PluginCode & { main(query: SearchQuery): void; } = {
    patches: [
        {
            find: "\"SearchQueryStore\";",
            lazy: true,
            required: false,
            replacements: [{ match: /\i\.searchResultsQuery=(\i)/, replace: "$&,$self.main($1)" }]
        }
    ],

    main(query) {
        fixQuery(query);
    }
};

export default plugin;
