/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The page script's entry. The preload wraps the bundle so that `__bridgeKey` names the bridge it exposed.
// Nothing else here: every decision is in `startEngine`.

import { choicesOf } from "../shared/settings";
import { Bridge, startEngine } from "./engine";
import { pluginModules } from "./pluginModules";
import { registryData } from "./registryData";
import type { SelfTestOptions } from "./selfTest";

declare const __bridgeKey: string;

const bridge = (globalThis as unknown as Record<string, Bridge | undefined>)[__bridgeKey];

if (bridge) {
    startEngine({
        bridge,
        registry: registryData,
        choices: choicesOf(bridge.bootInfo.settings),
        loadPlugin: id => {
            const load = pluginModules[id];
            if (!load) throw new Error(`there is no code for plugin "${id}" in this build`);
            return load();
        },
        selfTest: { webSocket: (globalThis as { WebSocket?: SelfTestOptions["webSocket"]; }).WebSocket }
    });
}
