/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Adapted for Amiricord (2026) from the plugin DontRoundMyTimestamps as found in TestCord's copy of Vencord's plugins (commit af92dba): same
// behaviour, written against Amiricord's engine. `moment` is found through the plugin's own finders instead of TestCord's `@webpack/common`,
// and the plugin waits for it instead of assuming it is there. Switching it off (or a stop before the finder answers) puts the rounding back.

import type { PluginCode } from "../../renderer/engine";

/** The one function of Discord's `moment` this plugin uses. */
interface Moment {
    relativeTimeRounding(rounder?: (value: number) => number): unknown;
}

let moment: Moment | undefined;
/** Changes at every stop, so a start that was still waiting for `moment` knows it must not apply anything. */
let generation = 0;

const plugin: PluginCode = {
    async start(ctx) {
        const mine = ++generation;
        const found = await ctx.finders.byProps<Moment>("parseTwoDigitYear").ready();
        if (mine !== generation) return;
        moment = found;
        moment.relativeTimeRounding(Math.floor);
    },

    stop() {
        generation++;
        moment?.relativeTimeRounding(Math.round);
        moment = undefined;
    }
};

export default plugin;
