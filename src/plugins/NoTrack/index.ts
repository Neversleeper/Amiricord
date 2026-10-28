/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// NoTrack, a core plugin: stops Discord from creating its usage reports, metrics and crash reports, and counts what it stopped ("stopped inside
// Discord", never mixed with what the network rules cancel). It does NOT touch the mod-detection flag: the privacy self-test measured it as false
// without any patch. The idea of what to stop is the one every privacy mod has; the patch texts were found by reading Discord's current code
// (docs/analysis-15-notrack.md section 7) and everything here is written from scratch. Design: docs/design-05-privacy-engine.md section 5.

import { definePluginSettings } from "../../api/pluginSettings";
import type { EnginePluginContext, PluginCode } from "../../renderer/engine";
import { gateSentry, quietMaker, type StoreMaker } from "./quiet";

const settings = definePluginSettings({
    disableAnalytics: {
        type: "boolean", default: true, restartNeeded: true,
        description: "Stop Discord from creating its usage reports and metrics. Features that rely on those reports, such as badge progress, may stop updating while this is on."
    },
    disableCrashReports: {
        type: "boolean", default: true, restartNeeded: true,
        description: "Stop Discord from starting its crash reporting."
    }
});

let context: EnginePluginContext | undefined;
let release: (() => void) | null = null;

const report = (what: string) => { context?.reportError("NoTrack", new Error(what)); };

const plugin: PluginCode & {
    quietAnalytics(maker: StoreMaker): StoreMaker;
    metricsTimerOff(): boolean;
    stopMetric(): boolean;
} = {
    settings,

    patches: [
        {
            // The one module that makes Discord's analytics store: it hands `analyticsTrackingStoreMaker` the actions the store reacts to.
            // Our function wraps the maker, so the store has the shape Discord expects but reacts to nothing and its queue never fills.
            find: "AnalyticsActionHandlers.handle",
            replacements: [{ match: /\(0,\i\.analyticsTrackingStoreMaker\)/, replace: "$self.quietAnalytics($&)" }]
        },
        {
            // The module of Discord's metrics counter: a timer sends what piled up every two minutes, and two methods add to the pile.
            find: ".METRICS_V2",
            replacements: [
                { match: /this\._intervalId=(?=setInterval\()/, replace: "this._intervalId=$self.metricsTimerOff()?void 0:" },
                { match: /(?:increment|distribution)\(\i(?:,\i)?\)\{/g, replace: "$&if($self.stopMetric())return;" }
            ]
        }
    ],

    /** Called by the patched Discord code in place of its analytics store maker. */
    quietAnalytics(maker) {
        return quietMaker(maker, {
            enabled: () => settings.store.disableAnalytics,
            // Asked on every event: while protection is paused the event is Discord's own again.
            paused: () => context?.privacy?.paused?.() === true,
            onTrack: () => { context?.privacy?.stopped("analytics"); },
            onUnexpected: () => { report("Discord's analytics store was configured in a way this version does not know; it was left as it is"); }
        });
    },

    /** True when the metrics timer must not start. */
    metricsTimerOff() {
        return settings.store.disableAnalytics;
    },

    /** Called at the start of each metrics method: true means "do nothing", and counts it. */
    stopMetric() {
        if (!settings.store.disableAnalytics || context?.privacy?.paused?.()) return false;
        try {
            context?.privacy?.stopped("metrics");
        } catch {
            // Counting must never disturb Discord.
        }
        return true;
    },

    start(ctx) {
        context = ctx;
        if (settings.store.disableCrashReports) {
            // Discord's wrappers call `window.DiscordSentry?.method(...)`; with the object never published each call does nothing.
            release = gateSentry(globalThis, () => { ctx.privacy?.stopped("crash-reports"); });
            if (!release) report("Discord's crash-report object could not be kept out of the page");
        }
    },

    stop() {
        release?.();
        release = null;
        context = undefined;
    }
};

export default plugin;
