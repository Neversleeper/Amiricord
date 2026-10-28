/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The parts of NoTrack that do not need Discord, so they are tested on their own: turning the configuration of Discord's analytics store into a
// quiet one, and shutting the door of Discord's crash-report object. Design: docs/analysis-15-notrack.md section 7.

/** What Discord passes to the function that makes its analytics store: among other things, the actions the store reacts to. */
export interface StoreConfig {
    actionHandler?: Record<string, unknown>;
    [key: string]: unknown;
}

export type StoreMaker = (config: StoreConfig) => unknown;

/**
 * The same configuration, except that every action does nothing and says "nothing changed" (what a Flux action handler answers). `TRACK`, the
 * action that carries the usage events, first calls `onTrack`, so what was stopped can be counted. Returns null when the configuration does not
 * have the shape Discord used when this was written: the caller then leaves it alone instead of breaking Discord.
 * The store is made once, when Discord starts, so a pause cannot be decided then: `passThrough` is asked on every event and, while it says true,
 * Discord's own handler runs and nothing is counted. A `passThrough` that throws counts as false (the event stays stopped).
 */
export function quietConfig(config: unknown, onTrack: () => void, passThrough?: () => boolean): StoreConfig | null {
    if (typeof config !== "object" || config === null) return null;
    const handlers = (config as StoreConfig).actionHandler;
    if (typeof handlers !== "object" || handlers === null || Array.isArray(handlers)) return null;

    const letThrough = (): boolean => {
        try {
            return passThrough?.() === true;
        } catch {
            return false;
        }
    };
    const quiet: Record<string, (...args: unknown[]) => unknown> = {};
    for (const action of Object.keys(handlers)) {
        const original = handlers[action];
        quiet[action] = (...args) => {
            if (typeof original === "function" && letThrough()) return original(...args);
            if (action === "TRACK") {
                try {
                    onTrack();
                } catch {
                    // Counting must never disturb Discord.
                }
            }
            return false;
        };
    }
    return { ...(config as StoreConfig), actionHandler: quiet };
}

/**
 * Wraps Discord's store maker: the store it makes has the same shape, but reacts to nothing, so no event is ever queued or sent.
 * When the configuration is not as expected, Discord's own maker runs unchanged and `onUnexpected` hears about it.
 */
export function quietMaker(maker: StoreMaker, hooks: { onTrack(): void; onUnexpected(): void; enabled(): boolean; paused?(): boolean; }): StoreMaker {
    if (typeof maker !== "function") return maker;
    return config => {
        if (!hooks.enabled()) return maker(config);
        const quiet = quietConfig(config, hooks.onTrack, hooks.paused);
        if (!quiet) {
            try {
                hooks.onUnexpected();
            } catch {
                // Reporting must never disturb Discord.
            }
            return maker(config);
        }
        return maker(quiet);
    };
}

/**
 * Discord's code calls `window.DiscordSentry?.something(...)` everywhere. If that object never appears, each call is a harmless no-op.
 * This defines the property so that reading it gives nothing and assigning it is ignored, which is what Sentry's own script does to publish its object.
 * Returns the function that puts things back, or null when the property could not be defined.
 */
export function gateSentry(target: object, onAssigned?: () => void): (() => void) | null {
    try {
        const before = Object.getOwnPropertyDescriptor(target, "DiscordSentry");
        if (before && before.configurable === false) return null;
        Object.defineProperty(target, "DiscordSentry", {
            configurable: true,
            enumerable: false,
            get: () => undefined,
            set: () => {
                try {
                    onAssigned?.();
                } catch {
                    // Counting must never disturb Discord.
                }
            }
        });
        return () => {
            try {
                Reflect.deleteProperty(target, "DiscordSentry");
                if (before) Object.defineProperty(target, "DiscordSentry", before);
            } catch {
                // Nothing more can be done.
            }
        };
    } catch {
        return null;
    }
}
