/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's own event bus ("Flux"): a plugin lists the events it wants in `flux` and gives a function for each. The engine finds the
// dispatcher, subscribes when the plugin has started and takes every subscription back when the plugin stops or fails to start. A handler that
// throws, or whose promise is rejected, is reported against its plugin and never reaches Discord. Design: docs/analysis-38-flux.md.

/** The two methods of Discord's dispatcher this layer uses. */
export interface FluxDispatcherLike {
    subscribe(type: string, callback: (event: unknown) => void): void;
    unsubscribe(type: string, callback: (event: unknown) => void): void;
}

/**
 * A handler for one event. The event is whatever Discord dispatches for that type, so a plugin writes the shape it expects as the parameter
 * (`CONNECTION_OPEN(event: { user: object }) {}`): the method form below makes any single parameter type fit.
 */
export type FluxHandler = { handle(event: never): void | Promise<void>; }["handle"];

export type FluxHandlers = { [eventType: string]: FluxHandler; };

/**
 * Subscribe every handler. Returns the function that takes all of them back (safe to call more than once).
 * `report` hears about each failure of a handler, with the event type.
 */
export function subscribeFlux(dispatcher: FluxDispatcherLike, handlers: FluxHandlers, report: (eventType: string, error: unknown) => void): () => void {
    const subscribed: Array<{ type: string; callback: (event: unknown) => void; }> = [];
    const fail = (type: string, error: unknown) => {
        try {
            report(type, error);
        } catch {
            // Reporting must never disturb Discord.
        }
    };
    for (const type of Object.keys(handlers)) {
        const handler = handlers[type] as (event: unknown) => void | Promise<void>;
        if (typeof handler !== "function") continue;
        const callback = (event: unknown) => {
            try {
                const result = handler(event);
                if (result && typeof (result as Promise<void>).then === "function") (result as Promise<void>).then(undefined, error => fail(type, error));
            } catch (error) {
                fail(type, error);
            }
        };
        dispatcher.subscribe(type, callback);
        subscribed.push({ type, callback });
    }
    return () => {
        for (const { type, callback } of subscribed.splice(0)) {
            try {
                dispatcher.unsubscribe(type, callback);
            } catch {
                // Nothing more can be done.
            }
        }
    };
}
