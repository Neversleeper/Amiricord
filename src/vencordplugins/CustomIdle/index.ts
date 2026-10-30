/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin CustomIdle (author newwares) as found in TestCord's copy of Vencord's plugins. Same three patches. The original, when you come back, shows a bar at the top with a button to go online again; the engine has no such bar, so with "stay idle" on the plugin leaves the idle status as it is (change your status to go online); with it off you go online at once, as in Discord.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    idleTimeout: { type: "number", default: 10, min: 0, max: 60, integer: true, description: "Minutes before Discord goes idle (0 turns automatic idle off). Needs a restart" },
    remainInIdle: { type: "boolean", default: true, description: "When you come back to Discord, stay idle until you change your status yourself" }
});

let dispatcher: { get(): { dispatch(event: { type: string; idle: boolean; }): void; } | undefined; } | undefined;

/** The idle time in milliseconds; Infinity for "never". */
export function idleMs(minutes: number): number {
    return minutes === 0 ? Infinity : minutes * 60000;
}

const plugin: PluginCode & { getIdleTimeout(): number; handleOnline(): void; } = {
    settings,
    patches: [
        {
            find: "type:\"IDLE\",idle:",
            lazy: true,
            required: false,
            replacements: [
                { match: /(?<=Date\.now\(\)-\i>)\i\.\i\|\|/, replace: "$self.getIdleTimeout()||" },
                // Idle no longer depends on the "away" time (notifications on the phone keep the person's setting or 10 minutes at most)
                { match: /Math\.min\((\i\*\i\.\i\.\i\.SECOND),\i\.\i\)/, replace: "$1" },
                { match: /\i\.\i\.dispatch\({type:"IDLE",idle:!1}\)/, replace: "$self.handleOnline()" }
            ]
        }
    ],

    start(ctx) {
        dispatcher = ctx.common.FluxDispatcher;
    },
    stop() {
        dispatcher = undefined;
    },

    getIdleTimeout() {
        return idleMs(settings.store.idleTimeout);
    },

    handleOnline() {
        if (!settings.store.remainInIdle) dispatcher?.get()?.dispatch({ type: "IDLE", idle: false });
    }
};

export default plugin;
