/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin Experiments (authors Megu, Ven, Nickyux, BanTheNons and Nuckyz) of Vencord. Every patch kept here was checked against the text of
// Discord's web build 653945 and each regular expression matches once in its module. Left out, and why:
//  - the warning card on the experiments page, the layout fix and the "Search experiments" anchor: that screen is not in the part of the build that was read, so there is nothing to patch;
//  - the three patches of the option "Help button as developer menu" (`hasBugReporterAccess`, `staff-help-popout`): the original switched them with a `predicate`, which Amiricord's patches
//    do not have, and the first one cannot be done at run time;
//  - the patch for `dev://playground/` links: its text is no longer in the build.
// Not tried in a real Discord at the time of writing. The experiments page itself is a lazy screen: whether it opens was not seen.

import type { PluginCode } from "../../renderer/engine";

/** Whether the label of an experiment, written in a `dev://experiment/...` link, is the one asked for (letters and numbers only, any case). */
export function matchExperiment(url: string, label: string): boolean {
    const items = url.split("/");
    const labelCleaned = label.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
    const urlEndCleaned = items[items.length - 1]?.replace(/[^a-zA-Z0-9]+/g, "").toLowerCase();
    return !!labelCleaned && urlEndCleaned !== undefined && labelCleaned === urlEndCleaned;
}

const plugin: PluginCode & { matchExperiment: typeof matchExperiment; } = {
    matchExperiment,

    patches: [
        {
            find: "Object.defineProperties(this,{isDeveloper",
            replacements: [{ match: /(?<={isDeveloper:\{[^}]+?,get:\(\)=>)\i/, replace: "true" }]
        },
        {
            find: 'type:"user",revision',
            replacements: [{ match: /!(\i)(?=&&"CONNECTION_OPEN")/, replace: "!($1=true)" }]
        },
        {
            // Experiment links and their embed. The second one stops a client crash with experiment names that are odd.
            find: "Clear Treatment ",
            replacements: [
                { match: /\i\?\.isStaff\(\)/, replace: "true" },
                { match: /\.isStaffPersonal\(\).+?if\(null==(\i)\|\|null==\i(?=\)return null;)/, replace: "$&||({})[$1]!=null" }
            ]
        },
        {
            find: "}getServerAssignment(",
            replacements: [{ match: /}getServerAssignment\((\i),\i,\i\){/, replace: "$&if($1==null)return;" }]
        },
        {
            // Lets the last part of `dev://experiment/...` hold letters and negative numbers.
            find: '"^dev://experiment/',
            replacements: [{ match: /\[0-9\]\+(?=\)\)\?\$")/, replace: "[a-zA-Z0-9-]+" }]
        },
        {
            // Links an experiment by its label and not only by its value.
            find: ".EXPERIMENT_TREATMENT&&null",
            replacements: [{ match: /(?<=find\(\i=>)((\i).value===\i)/, replace: "{return($1)||($self.matchExperiment(arguments[0].url,$2.label))}" }]
        }
    ]
};

export default plugin;
