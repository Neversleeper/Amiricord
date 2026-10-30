/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Part of the Amiricord port of AutoRedeem (original plugin: TestCord, by x2b and irritably).
 */

// The five values AutoRedeem used to keep as plain settings but that are credentials: the three CAPTCHA service keys, the VoidSolver proxy
// (`http://user:pass@ip:port`) and the webhook address (its path holds the webhook's token). Amiricord keeps settings out of secrets on purpose
// (`src/shared/settings.ts`: "Secrets (tokens, keys) never go here"), so they are plugin secrets: the page can save one, clear one and ask whether one
// exists, and only the plugin's native code can read it (`host.secret`). The names must match `secrets` in plugin.json.
//
// The page cannot read a secret back, so the queue asks "is there a key?" through this small cache, which is filled once at start and kept up to date by
// the settings window (the only place that saves or clears them).

import type { EnginePluginContext } from "../../renderer/engine";

export const SECRET_NAMES = ["noneCapApiKey", "noCaptchaAiApiKey", "voidSolverApiKey", "voidSolverProxy", "webhookUrl"] as const;
export type SecretName = typeof SECRET_NAMES[number];

/** The secrets that are CAPTCHA service keys (a change of one of them can end a CAPTCHA pause). */
export const CAPTCHA_KEY_SECRETS: readonly SecretName[] = ["noneCapApiKey", "noCaptchaAiApiKey", "voidSolverApiKey"];

export interface SecretsState {
    /** Whether the secret was saved, as of the last refresh or change. */
    has(name: SecretName): boolean;
    /** Ask the main process which secrets exist. Never rejects: a secret that cannot be asked about counts as missing. */
    refresh(): Promise<void>;
    /** Save a secret (the text is trimmed; an empty text clears it). Rejects with the reason when the main process refuses. */
    save(name: SecretName, value: string): Promise<void>;
    clear(name: SecretName): Promise<void>;
    /** Be told after every change, with the name that changed (`undefined` after a refresh). Returns the way to stop. */
    subscribe(listener: (changed: SecretName | undefined) => void): () => void;
    /** Changes with every change; what a React subscription compares. */
    version(): number;
}

export function createSecretsState(ctx: Pick<EnginePluginContext, "secrets">): SecretsState {
    const present = new Set<SecretName>();
    const listeners = new Set<(changed: SecretName | undefined) => void>();
    let version = 0;

    const changed = (name: SecretName | undefined) => {
        version++;
        for (const listener of [...listeners]) {
            try { listener(name); } catch { /* a broken listener does not stop the others */ }
        }
    };

    return {
        has: name => present.has(name),

        async refresh() {
            await Promise.all(SECRET_NAMES.map(async name => {
                let exists = false;
                try {
                    exists = await ctx.secrets.has(name);
                } catch {
                    exists = false;
                }
                if (exists) present.add(name);
                else present.delete(name);
            }));
            changed(undefined);
        },

        async save(name, value) {
            const text = value.trim();
            if (!text) {
                await ctx.secrets.clear(name);
                present.delete(name);
            } else {
                await ctx.secrets.set(name, text);
                present.add(name);
            }
            changed(name);
        },

        async clear(name) {
            await ctx.secrets.clear(name);
            present.delete(name);
            changed(name);
        },

        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        version: () => version
    };
}
