/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Adapted for Amiricord (2026) from the plugin WebRTCLeakPrevent (author Irritably) as found in TestCord's plugins (commit af92dba). Same
// behaviour: it replaces the page's `RTCPeerConnection` with a subclass that forces the ICE transport policy ("relay" sends the call through
// a relay server only, so the other side does not see your own address; "all" is Discord's normal behaviour). Written against Amiricord's
// engine. Differences, none tried in a real Discord yet:
//  - the policy is read once when the plugin starts, and the setting is marked as needing a restart;
//  - on stop the original constructor is put back only if it is still ours, so a plugin that wrapped it after us is not undone;
//  - the replacement is done on an object given to a function, so tests can check it without a real browser;
//  - if the page has no connection constructor at all, the start fails and is reported, instead of looking switched on while protecting nothing;
//  - logging goes through `console.info` with a prefix, only when the "debug log" setting is on.
// Warning for whoever switches it on: "relay only" can make voice and video fail if Discord's relay is not reachable from your network.
// Not verified in a real call.

import { definePluginSettings } from "../../api/pluginSettings";
import type { PluginCode } from "../../renderer/engine";

const settings = definePluginSettings({
    icePolicy: {
        type: "select",
        default: "relay",
        restartNeeded: true,
        description: "ICE transport policy. Relay forces TURN relay only (best privacy), public allows public IP discovery.",
        options: [
            { label: "Relay Only (Best Privacy)", value: "relay" },
            { label: "Public (Default Discord)", value: "all" }
        ]
    },
    enableLogs: { type: "boolean", default: false, description: "Enable debug logging to the console." }
});

/** The little of the browser's connection this plugin uses, written here so the file needs no browser types. */
export interface IceConfiguration { iceTransportPolicy?: string; [key: string]: unknown; }
export interface ConnectionLike { getConfiguration(): IceConfiguration; setConfiguration(configuration: IceConfiguration): void; }
export type Connection = new (configuration?: IceConfiguration) => ConnectionLike;
type Name = "RTCPeerConnection" | "webkitRTCPeerConnection";

/** The part of the page this plugin touches. */
export interface Target {
    RTCPeerConnection?: Connection;
    webkitRTCPeerConnection?: Connection;
}

type Log = (...args: unknown[]) => void;

const NAMES: readonly Name[] = ["RTCPeerConnection", "webkitRTCPeerConnection"];

/** A subclass of `Original` that always asks for `policy`, whatever Discord's configuration says. */
export function createPatchedConnection(Original: Connection, policy: string, log?: Log): Connection {
    return class extends Original {
        constructor(configuration?: IceConfiguration) {
            super({ ...configuration, iceTransportPolicy: policy });
            if (log) log(`RTCPeerConnection created - ICE policy: ${this.getConfiguration().iceTransportPolicy}`);
        }

        setConfiguration(configuration: IceConfiguration): void {
            if (log && configuration.iceTransportPolicy !== policy) log(`Discord tried to change the ICE policy to ${configuration.iceTransportPolicy}; forcing ${policy}`);
            super.setConfiguration({ ...configuration, iceTransportPolicy: policy });
        }
    };
}

/** Replace the connection constructors found on `target`. Returns the function that puts them back (only the ones still ours), or undefined when there was none. */
export function patchConnections(target: Target, policy: string, log?: Log): (() => void) | undefined {
    const done: Array<{ name: Name; original: Connection; ours: Connection; }> = [];
    for (const name of NAMES) {
        const original = target[name];
        if (typeof original === "undefined") continue;
        const ours = createPatchedConnection(original, policy, log);
        target[name] = ours;
        done.push({ name, original, ours });
    }
    if (done.length === 0) return undefined;
    return () => {
        for (const { name, original, ours } of done) {
            if (target[name] === ours) target[name] = original;
        }
    };
}

let restore: (() => void) | undefined;

const plugin: PluginCode = {
    settings,

    start() {
        const log: Log | undefined = settings.store.enableLogs ? (...args) => console.info("[WebRTCLeakPrevent]", ...args) : undefined;
        if (settings.store.icePolicy === "all") {
            log?.("Switched on with the public policy: nothing is changed");
            return;
        }
        restore = patchConnections(globalThis as unknown as Target, settings.store.icePolicy, log);
        if (!restore) throw new Error("WebRTCLeakPrevent: this page has no RTCPeerConnection to protect");
        log?.("WebRTC leak prevention active");
    },

    stop() {
        restore?.();
        restore = undefined;
    }
};

export default plugin;
