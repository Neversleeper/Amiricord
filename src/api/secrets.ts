/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How a plugin's page code handles its own secrets (a cookie, a key declared in `secrets` of its plugin.json): it can save one, forget one, and ask whether one exists.
// It can never read one back: the value goes to the main process once, and only the plugin's native code can use it (`host.secret`). Design: docs/analysis-31-pinterest-tool-settings-and-storage.md.

import type { NativeBridge } from "./native";

export interface PluginSecrets {
    /** Whether the secret exists. */
    has(name: string): Promise<boolean>;
    /** Save the secret, encrypted by the main process. Rejects with the reason when it was refused. */
    set(name: string, value: string): Promise<void>;
    /** Forget the secret. */
    clear(name: string): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function buildSecrets(plugin: string, bridge: NativeBridge | undefined): PluginSecrets {
    const ask = async (action: "has" | "set" | "clear", name: string, value?: string): Promise<unknown> => {
        if (!bridge) throw new Error(`${plugin}: the main process is not reachable, so secrets are not available`);
        let answer: unknown;
        try {
            answer = await bridge({ action, plugin, name, ...(value === undefined ? {} : { value }) });
        } catch (error) {
            throw new Error(`${plugin}: the secret ${action} could not be done (${error instanceof Error ? error.message : String(error)})`);
        }
        if (!isRecord(answer) || typeof answer.ok !== "boolean") throw new Error(`${plugin}: the main process gave an answer about a secret that cannot be read`);
        if (!answer.ok) throw new Error(typeof answer.error === "string" ? answer.error : `${plugin}: the secret ${action} failed`);
        return answer.value;
    };
    return {
        has: async name => (await ask("has", name)) === true,
        set: async (name, value) => { await ask("set", name, value); },
        clear: async name => { await ask("clear", name); }
    };
}
