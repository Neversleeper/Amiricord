/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin SortFriends (authors Megu and CallMeGii; listed in TestCord as SortFriendRequests) as found in TestCord's copy of Vencord's
// plugins. The patches are the original's, with the translation key FRIEND_REQUEST_CANCEL written as its hash (`eaq81S`). The dates are shown only while the setting
// "Show dates on friend requests" is on (read when the plugin starts: a change needs a restart). Differences: Discord's tooltip and text components are not used, the
// date is a plain text with the full date as its hover title, and the little clock icon of the subtext is drawn as the original's SVG with the same path.
// Not checked against a live page: whether the three anchors still match on the current build is NOT known.

import { currentReact } from "../../api/jsxRuntime";
import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import type { PatchDefinition } from "../../webpack/compileModule";

type React = { createElement(...args: unknown[]): unknown; };
interface Relationships { getSince?(id: string): string | undefined; }
interface Row { type?: number; user?: { id: string; }; }

const settings = definePluginSettings({
    showDates: { type: "boolean", default: false, restartNeeded: true, description: "Show dates on friend requests" }
} as const);

const formatter = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", year: "numeric" });
const CLOCK = "M12 23a11 11 0 1 0 0-22 11 11 0 0 0 0 22Zm1-18a1 1 0 1 0-2 0v7c0 .27.1.52.3.7l3 3a1 1 0 0 0 1.4-1.4L13 11.58V5Z";

let context: EnginePluginContext | undefined;

function sinceOf(userId: string | undefined): Date {
    const store = context?.common.RelationshipStore.get() as Relationships | undefined;
    return new Date(userId ? store?.getSince?.(userId) ?? Number.NaN : Number.NaN);
}

const plugin: PluginCode & {
    wrapSort(comparator: (row: Row) => unknown, row: Row): unknown;
    makeSubtext(user: { id: string; } | undefined, original: unknown): unknown;
    WrapperDateComponent(props: { user?: { id: string; }; children?: unknown; }): unknown;
} = {
    settings,

    get patches(): PatchDefinition[] {
        const patches: PatchDefinition[] = [{
            find: "getRelationshipCounts(){",
            lazy: true,
            replacements: [{ match: /\}\)\.sortBy\((.+?)\)\.value\(\)/, replace: "}).sortBy(row => $self.wrapSort(($1), row)).value()" }]
        }];
        if (settings.store.showDates) {
            patches.push(
                {
                    find: "peopleListItemRef",
                    lazy: true,
                    required: false,
                    replacements: [{
                        match: /(?<=children:.*user:(\i),.*subText:).+?(?=,hovered:\i,showAccountIdentifier)/,
                        replace: "$self.makeSubtext($1, $&)"
                    }]
                },
                {
                    find: ".t.eaq81S",
                    lazy: true,
                    required: false,
                    replacements: [{
                        match: /(?<=children:\[)\(0,.{0,100}user:\i,hovered:\i.+?(?=,\(0)(?<=user:(\i).+?)/,
                        replace: "$self.WrapperDateComponent({user:$1,children:$&})"
                    }]
                }
            );
        }
        return patches;
    },

    start(ctx) {
        context = ctx;
    },

    stop() {
        context = undefined;
    },

    /** Incoming (3) and outgoing (4) requests go by the date they were made, newest first; every other row keeps Discord's order. */
    wrapSort(comparator, row) {
        return row.type === 3 || row.type === 4 ? -sinceOf(row.user?.id).getTime() : comparator(row);
    },

    makeSubtext(user, original) {
        const since = sinceOf(user?.id);
        if (Number.isNaN(since.getTime())) return null;
        const react = currentReact() as React;
        return react.createElement("div", { style: { display: "flex", flexDirection: "column", lineHeight: "0.9rem" } },
            react.createElement("span", null, original),
            react.createElement("div", { style: { display: "flex", alignItems: "center" } },
                react.createElement("svg", { "aria-hidden": true, role: "img", width: 8, height: 8, fill: "none", viewBox: "0 0 24 24", style: { marginRight: "4px", display: "inline-block" } },
                    react.createElement("path", { fill: "var(--input-placeholder-text)", fillRule: "evenodd", d: CLOCK, clipRule: "evenodd" })),
                react.createElement("span", null, `Added - ${since.toDateString()}`)));
    },

    WrapperDateComponent({ user, children }) {
        const since = sinceOf(user?.id);
        const react = currentReact() as React;
        return react.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            children,
            Number.isNaN(since.getTime()) ? null : react.createElement("span", { title: since.toLocaleString(), style: { fontSize: "12px", color: "var(--text-muted, var(--input-placeholder-text))" } }, formatter.format(since)));
    }
};

export default plugin;
