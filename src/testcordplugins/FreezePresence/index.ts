/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin FreezePresence (by Neversleeper, who posted it in TestCord as nnenaza) as found in TestCord.
// "Make everyone appear Online" answers Discord's presence store with "online" for every person but you, and stops the full presence refresh that would
// undo it. Checked on build 653945 against the main bundle: the store module is found by `clientStatuses:`; the first `return x[y]??z;` in it is the
// answer of `getStatus` for the whole account (the two others belong to other methods), and `getClientStatus(e){return m[e]}` matches once.
// Differences, NOT verified in a real Discord:
//  - "Freeze the member list" keeps the original patch on the member list component (its update check), but that component is not in the main bundle of this
//    build (Discord loads it later), so the anchor could not be checked and the original text is probably out of date: the patch is optional, and if it does
//    not match the option does nothing;
//  - Discord's dispatcher of this build has `addInterceptor` but no `removeInterceptor`, so the filter is added once and switched on and off with a flag;
//  - the original also held back the event `PASSIVE_UPDATE_V1`; it no longer exists in this build, so only `PRESENCES_REPLACE` is held back;
//  - the original sent an empty `PRESENCE_UPDATES` to make Discord draw again; that is kept.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    freezeList: { type: "boolean", default: false, description: "Freeze the member list: stop it from jumping around when people change status (needs a restart of Discord; see the note in the plugin's code)." },
    fakeAllOnline: { type: "boolean", default: false, description: "Make everyone appear as Online (green) in the member list." }
});

interface InterceptingDispatcher {
    dispatch(event: { type: string; [key: string]: unknown; }): void;
    addInterceptor?(interceptor: (event: { type?: unknown; }) => unknown): void;
}

// The presence events the original held back while "everyone is online" is on.
const HELD_BACK = new Set(["PRESENCES_REPLACE"]);

let fakeOnline = false;
let frozen = false;
let userStore: { get(): { getCurrentUser(): { id: string; } | undefined; } | undefined; } | undefined;
let dispatcher: InterceptingDispatcher | undefined;
let interceptorAdded = false;
let generation = 0;

function interceptor(event: { type?: unknown; }): unknown {
    // Returning `true` makes Discord's dispatcher drop the event.
    return fakeOnline && typeof event.type === "string" && HELD_BACK.has(event.type) ? true : undefined;
}

function redraw(): void {
    // An empty presence update is enough for Discord to draw the lists again.
    dispatcher?.dispatch({ type: "PRESENCE_UPDATES", updates: [] });
}

function setFakeOnline(on: boolean): void {
    if (fakeOnline === on) return;
    if (on && !interceptorAdded && dispatcher?.addInterceptor) {
        dispatcher.addInterceptor(interceptor);
        interceptorAdded = true;
    }
    fakeOnline = on;
    redraw();
}

const plugin: PluginCode & { isFrozen(): boolean; fakeOnlineStatus(userId: unknown): string | null; } = {
    settings,

    patches: [
        {
            // The member list component's update check. Not in the main bundle of build 653945: optional and lazy.
            find: "e.channel.id!==this.props.channel.id||e.version!==this.props.version",
            lazy: true,
            required: false,
            replacements: [{
                match: /shouldComponentUpdate\((\i)\)\{return \i\.channel\.id!==this\.props\.channel\.id\|\|\i\.version!==this\.props\.version\|\|\i\.groups\.length!==this\.props\.groups\.length\}/,
                replace: "shouldComponentUpdate($1){if($self.isFrozen())return $1.channel.id!==this.props.channel.id||$1.rows!==this.props.rows;return $1.channel.id!==this.props.channel.id||$1.version!==this.props.version||$1.groups.length!==this.props.groups.length}"
            }]
        },
        {
            // The presence store: what `getStatus` and `getClientStatus` answer.
            find: "clientStatuses:",
            replacements: [
                { match: /return (\i)\[(\i)\]\?\?(\i);/, replace: "return $self.fakeOnlineStatus($2)??$1[$2]??$3;" },
                { match: /getClientStatus\((\i)\)\{return (\i)\[(\i)\]\}/, replace: 'getClientStatus($1){if($self.fakeOnlineStatus($1))return{desktop:"online"};return $2[$3]}' }
            ]
        }
    ],

    isFrozen: () => frozen,

    fakeOnlineStatus(userId: unknown): string | null {
        if (!fakeOnline || typeof userId !== "string") return null;
        if (userId === userStore?.get()?.getCurrentUser()?.id) return null;
        return "online";
    },

    async start(ctx) {
        const mine = ++generation;
        const found = await ctx.common.FluxDispatcher.ready();
        // A stop, or a newer start, that came while Discord's dispatcher was being found: leave everything as it is.
        if (mine !== generation) return;
        dispatcher = found as unknown as InterceptingDispatcher;
        userStore = ctx.common.UserStore;
        frozen = settings.store.freezeList;
        setFakeOnline(settings.store.fakeAllOnline);
        const offFreeze = settings.onChange("freezeList", value => { if (mine === generation) frozen = value; });
        const offFake = settings.onChange("fakeAllOnline", value => { if (mine === generation) setFakeOnline(value); });
        ctx.onDispose(() => { offFreeze(); offFake(); });
    },

    stop() {
        generation++;
        frozen = false;
        setFakeOnline(false);
        dispatcher = undefined;
        userStore = undefined;
    }
};

export default plugin;
