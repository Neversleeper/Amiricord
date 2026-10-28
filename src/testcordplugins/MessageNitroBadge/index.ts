/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin MessageNitroBadge (author x2b) as found in TestCord's plugins (commit af92dba). It switches on
// Discord's "social proofing" experiment, which draws a Nitro badge next to your own name in messages (servers only; other people's badges are
// not shown). Written against Amiricord's engine; the original's settings notice and its dependency on an Experiments plugin are not kept.
// Differences, none tried in a real Discord yet:
//  - the dispatcher comes from the plugin's own finders and the plugin waits for it; if a stop comes before it shows up, nothing is sent;
//  - the choice is a select with the two treatments Discord has (1 and 2) and needs a restart, as in the original;
//  - on stop the experiment is put back to "no choice" (the original did the same).
// This only changes what the page shows on your side. Not verified: that Discord still has this experiment, and that its override message is
// accepted while the page is running.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const EXPERIMENT_ID = "2023-10_social_proofing_message_nitro_badge";

const settings = definePluginSettings({
    experimentTreatment: {
        type: "select",
        default: "1",
        restartNeeded: true,
        description: "Which treatment to enable the experiment with",
        options: [
            { label: "Treatment 1: Prefer BOTH nitro badge AND role icon(s)", value: "1" },
            { label: "Treatment 2: Prefer role icon(s) over nitro badge if both are present", value: "2" }
        ]
    }
});

interface Dispatcher {
    dispatch(action: { type: string; experimentId: string; experimentBucket: number | null; }): void;
}

let dispatcher: Dispatcher | undefined;
/** Changes at every stop, so a start that was still waiting for the dispatcher knows it must not send anything. */
let generation = 0;

/** Ask Discord to use `bucket` for the experiment (null puts it back to no choice). */
export function overrideExperiment(target: Dispatcher, bucket: number | null): void {
    target.dispatch({ type: "EXPERIMENT_OVERRIDE_BUCKET", experimentId: EXPERIMENT_ID, experimentBucket: bucket });
}

const plugin: PluginCode = {
    settings,

    async start(ctx) {
        const mine = ++generation;
        const found = await ctx.finders.byProps<Dispatcher>("dispatch", "subscribe").ready();
        if (mine !== generation) return;
        dispatcher = found;
        overrideExperiment(found, Number(settings.store.experimentTreatment));
    },

    stop() {
        generation++;
        if (dispatcher) overrideExperiment(dispatcher, null);
        dispatcher = undefined;
    }
};

export default plugin;
