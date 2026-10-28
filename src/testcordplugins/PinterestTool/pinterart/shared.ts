/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What his screens import from his `shared.ts`, rebuilt on Amiricord's own pieces: the theme code is ours (`../theme.ts`, ported from the same plugin), the settings are
// the plugin's (`../settings.ts`) with the `use` hook his screens call, and the main-process calls are the shim in `host.ts`.

import { currentReact } from "../../../api/jsxRuntime";
import { settings as pluginSettings } from "../settings";
import type { PinterestSearchPayload } from "../types";

export type { AppearanceSetting, PinterestTheme, ResolvedAppearance } from "../theme";
export { getPinterestFullStyle, PINTEREST_THEMES, resolveAppearance, resolvePinterestTheme } from "../theme";
export type { PinterestImageResult, PinterestSearchPayload, SearchKind, SearchTarget } from "../types";
export { Native } from "./host";

export interface NativeMediaResult {
    data: ArrayBuffer;
    dataUrl: string;
    type: string;
    filename: string;
}

export interface SearchBucketState {
    data: PinterestSearchPayload | null;
    activeQuery: string;
    bookmark: string[] | null;
    page: number;
    loadingNextPage: boolean;
    error: string;
}

/** The class-name builder of his screens: `cl("grid")` gives `vc-pinterest-tool-grid`, and a list of names is joined. */
export const cl = (...names: Array<string | false | null | undefined>): string =>
    names.map(name => (typeof name === "string" && name ? `vc-pinterest-tool-${name}` : "")).filter(Boolean).join(" ");

type Store = typeof pluginSettings.store;

/** The settings the way his screens use them: `settings.store.x` to read and write, `settings.use([...])` to read and redraw when one changes. */
export const settings = {
    store: pluginSettings.store,
    use<K extends keyof Store>(keys: readonly K[]): Pick<Store, K> {
        const react = currentReact();
        const [, bump] = react.useState(0);
        react.useEffect(() => pluginSettings.subscribe(() => { bump(count => count + 1); }), []);
        const values = {} as Pick<Store, K>;
        for (const key of keys) values[key] = pluginSettings.store[key];
        return values;
    }
};
