/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
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

// Adapted for Amiricord (2026) from the plugin StreamerModeOnStream (author icedmarina) as found in TestCord's copy of Vencord's plugins
// (commit af92dba). Same behaviour, written against Amiricord's engine: the events go through the engine's `flux`, and Discord's dispatcher
// and user store come from the plugin's own finders. One difference: the original reads `getCurrentUser().id` without checking that there is a
// current user, which throws if a stream event arrives before the account is loaded; here such an event is ignored. It also matched any key that
// merely ends with your id's digits; here the id must be the last part of the key.

import type { PluginCode } from "../../renderer/engine";

interface StreamEvent {
    streamKey?: unknown;
}

interface Dispatcher {
    dispatch(action: { type: string; key: string; value: boolean; }): void;
}

interface Users {
    getCurrentUser(): { id: string; } | null | undefined;
}

let tools: { dispatcher: Dispatcher; users: Users; } | undefined;

/** Streamer mode follows your own stream only: a stream key ends with ":" and the id of the user who streams. */
export function toggleStreamerMode(event: StreamEvent, value: boolean): void {
    if (!tools || typeof event?.streamKey !== "string") return;
    const me = tools.users.getCurrentUser()?.id;
    if (!me || !(event.streamKey === me || event.streamKey.endsWith(`:${me}`))) return;
    tools.dispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: "enabled", value });
}

const plugin: PluginCode = {
    async start(ctx) {
        const [dispatcher, users] = await Promise.all([
            ctx.finders.byProps<Dispatcher>("dispatch", "subscribe").ready(),
            ctx.finders.byStore<Users>("UserStore").ready()
        ]);
        tools = { dispatcher, users };
    },

    stop() {
        tools = undefined;
    },

    flux: {
        STREAM_CREATE: (event: StreamEvent) => { toggleStreamerMode(event, true); },
        STREAM_DELETE: (event: StreamEvent) => { toggleStreamerMode(event, false); }
    }
};

export default plugin;
