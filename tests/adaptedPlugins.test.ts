/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The plugins adapted from other projects (first batch). Each one is run with a fake context whose finders answer when the test says so,
// so what is checked is exactly what the plugin does with Discord's objects: apply, undo, and never apply after a stop.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { SettingsClient } from "../src/api/settingsClient";
import noNitro from "../src/equicordplugins/NoNitroUpsell/index";
import type { EnginePluginContext } from "../src/renderer/engine";
import quietHours, { inQuietHours } from "../src/testcordplugins/QuietHours/index";
import dontRound from "../src/vencordplugins/DontRoundMyTimestamps/index";
import streamerMode, { toggleStreamerMode } from "../src/vencordplugins/StreamerModeOn/index";

/** A finder that answers when `answer()` is called, like the real one answers when Discord's module is loaded. */
function lateFinder<T>() {
    let resolveValue: (value: T) => void = () => undefined;
    const promise = new Promise<T>(resolve => { resolveValue = resolve; });
    return { finder: { ready: () => promise }, answer: (value: T) => resolveValue(value) };
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe("DontRoundMyTimestamps", () => {
    const moment = () => {
        const calls: Array<(value: number) => number> = [];
        return { calls, relativeTimeRounding: (rounder?: (value: number) => number) => { if (rounder) calls.push(rounder); } };
    };

    function context(late: ReturnType<typeof lateFinder<ReturnType<typeof moment>>>, asked: string[][] = []) {
        return {
            finders: { byProps: (...props: string[]) => { asked.push(props); return late.finder; } }
        } as unknown as EnginePluginContext;
    }

    beforeEach(() => { dontRound.stop?.({} as EnginePluginContext); });

    it("rounds down once Discord's moment is there, and puts rounding back to normal when it stops", async () => {
        const late = lateFinder<ReturnType<typeof moment>>();
        const asked: string[][] = [];
        const m = moment();
        const started = dontRound.start!(context(late, asked));
        late.answer(m);
        await started;
        assert.deepEqual(asked, [["parseTwoDigitYear"]]);
        assert.deepEqual(m.calls, [Math.floor]);
        dontRound.stop!({} as EnginePluginContext);
        assert.deepEqual(m.calls, [Math.floor, Math.round]);
    });

    it("applies nothing when it is stopped before moment shows up", async () => {
        const late = lateFinder<ReturnType<typeof moment>>();
        const m = moment();
        const started = dontRound.start!(context(late));
        dontRound.stop!({} as EnginePluginContext);
        late.answer(m);
        await started;
        assert.deepEqual(m.calls, [], "neither floor nor round: it never touched moment");
    });

    it("does nothing when stopped without having started, and does not put rounding back twice", async () => {
        assert.doesNotThrow(() => dontRound.stop!({} as EnginePluginContext));
        const late = lateFinder<ReturnType<typeof moment>>();
        const m = moment();
        const started = dontRound.start!(context(late));
        late.answer(m);
        await started;
        dontRound.stop!({} as EnginePluginContext);
        dontRound.stop!({} as EnginePluginContext);
        assert.deepEqual(m.calls, [Math.floor, Math.round]);
    });

    it("lets the start fail, so the engine reports it, when moment never shows up", async () => {
        const failing = { finders: { byProps: () => ({ ready: () => Promise.reject(new Error("found nothing")) }) } } as unknown as EnginePluginContext;
        await assert.rejects(Promise.resolve(dontRound.start!(failing)), /found nothing/);
    });
});

describe("NoNitroUpsell", () => {
    type State = { premiumTypeActual?: number; premiumTypeOverride?: number; };

    function setup(initial: State = {}) {
        const state: State = { ...initial };
        const store = { getState: () => state };
        const handlers: Array<{ type: string; callback: () => void; }> = [];
        const dispatcher = {
            subscribe: (type: string, callback: () => void) => { handlers.push({ type, callback }); },
            unsubscribe: (type: string, callback: () => void) => { const i = handlers.findIndex(h => h.type === type && h.callback === callback); if (i >= 0) handlers.splice(i, 1); }
        };
        const dispatcherLate = lateFinder<typeof dispatcher>();
        const storeLate = lateFinder<typeof store>();
        const asked: string[] = [];
        const ctx = {
            finders: {
                byProps: (...props: string[]) => { asked.push(`props:${props.join(",")}`); return dispatcherLate.finder; },
                byStore: (name: string) => { asked.push(`store:${name}`); return storeLate.finder; }
            }
        } as unknown as EnginePluginContext;
        return { state, handlers, ctx, asked, dispatcherLate, storeLate, dispatcher, store };
    }

    beforeEach(() => { noNitro.stop?.({} as EnginePluginContext); });

    it("sets the override to Nitro, listens for new connections, and undoes both when it stops", async () => {
        const s = setup({ premiumTypeActual: 0 });
        const started = noNitro.start!(s.ctx);
        s.dispatcherLate.answer(s.dispatcher);
        s.storeLate.answer(s.store);
        await started;
        assert.deepEqual(s.asked.sort(), ["props:dispatch,subscribe", "store:OverridePremiumTypeStore"]);
        assert.equal(s.state.premiumTypeOverride, 2);
        assert.deepEqual(s.handlers.map(h => h.type), ["CONNECTION_OPEN"]);

        noNitro.stop!({} as EnginePluginContext);
        assert.equal(s.state.premiumTypeOverride, undefined);
        assert.deepEqual(s.handlers, []);
    });

    it("sets the override again on a new connection when Discord reset it, and leaves it alone when it is already set", async () => {
        const s = setup({ premiumTypeActual: 0 });
        const started = noNitro.start!(s.ctx);
        s.dispatcherLate.answer(s.dispatcher);
        s.storeLate.answer(s.store);
        await started;
        s.state.premiumTypeOverride = undefined;
        s.handlers[0].callback();
        assert.equal(s.state.premiumTypeOverride, 2);
        s.state.premiumTypeOverride = 2;
        s.handlers[0].callback();
        assert.equal(s.state.premiumTypeOverride, 2);
    });

    it("applies and subscribes to nothing when it is stopped before Discord's code shows up", async () => {
        const s = setup();
        const started = noNitro.start!(s.ctx);
        noNitro.stop!({} as EnginePluginContext);
        s.dispatcherLate.answer(s.dispatcher);
        s.storeLate.answer(s.store);
        await started;
        assert.equal(s.state.premiumTypeOverride, undefined);
        assert.deepEqual(s.handlers, []);
    });

    it("does nothing when stopped without having started", () => {
        assert.doesNotThrow(() => noNitro.stop!({} as EnginePluginContext));
    });

    it("lets the start fail, so the engine reports it, when one of Discord's pieces never shows up", async () => {
        const failing = {
            finders: {
                byProps: () => ({ ready: () => Promise.resolve({ subscribe: () => undefined, unsubscribe: () => undefined }) }),
                byStore: () => ({ ready: () => Promise.reject(new Error("no store")) })
            }
        } as unknown as EnginePluginContext;
        await assert.rejects(Promise.resolve(noNitro.start!(failing)), /no store/);
        await tick();
        assert.doesNotThrow(() => noNitro.stop!({} as EnginePluginContext));
    });
});

describe("StreamerModeOn", () => {
    type Action = { type: string; key: string; value: boolean; };

    function setup(currentUserId: string | null = "42") {
        const dispatched: Action[] = [];
        const dispatcher = { dispatch: (action: Action) => { dispatched.push(action); } };
        const users = { getCurrentUser: () => (currentUserId === null ? undefined : { id: currentUserId }) };
        const asked: string[] = [];
        const ctx = {
            finders: {
                byProps: (...props: string[]) => { asked.push(`props:${props.join(",")}`); return { ready: () => Promise.resolve(dispatcher) }; },
                byStore: (name: string) => { asked.push(`store:${name}`); return { ready: () => Promise.resolve(users) }; }
            }
        } as unknown as EnginePluginContext;
        return { dispatched, ctx, asked };
    }
    const handler = (name: "STREAM_CREATE" | "STREAM_DELETE") => streamerMode.flux![name] as (event: unknown) => void;

    beforeEach(() => { streamerMode.stop!({} as EnginePluginContext); });

    it("turns streamer mode on when your own stream starts and off when it ends", async () => {
        const s = setup();
        await streamerMode.start!(s.ctx);
        assert.deepEqual(s.asked.sort(), ["props:dispatch,subscribe", "store:UserStore"]);
        handler("STREAM_CREATE")({ streamKey: "guild:1:2:42" });
        handler("STREAM_DELETE")({ streamKey: "guild:1:2:42" });
        assert.deepEqual(s.dispatched, [
            { type: "STREAMER_MODE_UPDATE", key: "enabled", value: true },
            { type: "STREAMER_MODE_UPDATE", key: "enabled", value: false }
        ]);
    });

    it("ignores other people's streams, malformed events, a missing account, and anything before start or after stop", async () => {
        const s = setup();
        handler("STREAM_CREATE")({ streamKey: "guild:1:2:42" });
        assert.deepEqual(s.dispatched, [], "before start");
        await streamerMode.start!(s.ctx);
        handler("STREAM_CREATE")({ streamKey: "guild:1:2:7" });
        handler("STREAM_CREATE")({ streamKey: 42 });
        handler("STREAM_CREATE")({});
        assert.doesNotThrow(() => handler("STREAM_CREATE")(undefined));
        assert.deepEqual(s.dispatched, []);
        streamerMode.stop!({} as EnginePluginContext);
        handler("STREAM_CREATE")({ streamKey: "guild:1:2:42" });
        assert.deepEqual(s.dispatched, [], "after stop");
        const noAccount = setup(null);
        await streamerMode.start!(noAccount.ctx);
        assert.doesNotThrow(() => handler("STREAM_CREATE")({ streamKey: "guild:1:2:42" }));
        handler("STREAM_CREATE")({ streamKey: "guild:1:2:undefined" });
        assert.deepEqual(noAccount.dispatched, []);
    });

    it("needs the whole id at the end of the key, so another account whose id ends with the same digits does not count", async () => {
        const s = setup("42");
        await streamerMode.start!(s.ctx);
        toggleStreamerMode({ streamKey: "guild:1:2:142" }, true);
        assert.equal(s.dispatched.length, 0);
        toggleStreamerMode({ streamKey: "guild:1:2:42" }, true);
        toggleStreamerMode({ streamKey: "42" }, true);
        assert.equal(s.dispatched.length, 2);
    });
});

describe("QuietHours", () => {
    it("knows when an hour is inside the window, including a window that passes midnight and an empty one", () => {
        assert.equal(inQuietHours(23, 23, 8), true);
        assert.equal(inQuietHours(2, 23, 8), true);
        assert.equal(inQuietHours(7, 23, 8), true);
        assert.equal(inQuietHours(8, 23, 8), false, "the end hour is outside");
        assert.equal(inQuietHours(12, 23, 8), false);
        assert.equal(inQuietHours(9, 9, 17), true);
        assert.equal(inQuietHours(16, 9, 17), true);
        assert.equal(inQuietHours(17, 9, 17), false);
        assert.equal(inQuietHours(3, 9, 17), false);
        assert.equal(inQuietHours(9, 9, 9), false, "start equal to end is an empty window");
    });

    function setup(values: Record<string, number> = {}) {
        quietHours.settings!.unbind();
        quietHours.settings!.bind(new SettingsClient({ schema: 1, plugins: { QuietHours: { values } } }, () => undefined), "QuietHours");
        const played: Array<{ self: unknown; args: unknown[]; }> = [];
        const sounds = { playSound(this: unknown, ...args: unknown[]) { played.push({ self: this, args }); return "played"; } };
        const original = sounds.playSound;
        const asked: string[] = [];
        const ctx = { finders: { byProps: (...props: string[]) => { asked.push(props.join(",")); return { ready: () => Promise.resolve(sounds) }; } } } as unknown as EnginePluginContext;
        return { sounds, original, played, ctx, asked };
    }
    const at = (hour: number) => mock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 1, hour, 30).getTime() });

    beforeEach(() => { quietHours.stop!({} as EnginePluginContext); });
    afterEach(() => { mock.timers.reset(); });

    it("silences the sound inside the window and lets it play outside, with Discord's own arguments and object", async () => {
        const s = setup();
        await quietHours.start!(s.ctx);
        assert.deepEqual(s.asked, ["playSound,createSound"]);
        at(23);
        assert.equal(s.sounds.playSound("ping"), undefined);
        assert.equal(s.played.length, 0);
        mock.timers.reset();
        at(12);
        assert.equal(s.sounds.playSound("ping", 2), "played");
        assert.equal(s.played.length, 1);
        assert.deepEqual(s.played[0].args, ["ping", 2]);
        assert.equal(s.played[0].self, s.sounds);
    });

    it("takes only whole hours from 0 to 23 from the saved settings, and the default otherwise", () => {
        const store = () => (quietHours.settings as unknown as { store: { start: number; end: number; }; }).store;
        setup({ start: 7.5, end: 30 });
        assert.deepEqual([store().start, store().end], [23, 8]);
        setup({ start: 6, end: 22 });
        assert.deepEqual([store().start, store().end], [6, 22]);
    });

    it("uses the hours the person set", async () => {
        const s = setup({ start: 12, end: 14 });
        await quietHours.start!(s.ctx);
        at(13);
        assert.equal(s.sounds.playSound("x"), undefined);
        mock.timers.reset();
        at(23);
        assert.equal(s.sounds.playSound("x"), "played");
    });

    it("puts Discord's own function back on stop, but not over a function someone else put there later", async () => {
        const s = setup();
        await quietHours.start!(s.ctx);
        assert.notEqual(s.sounds.playSound, s.original);
        quietHours.stop!({} as EnginePluginContext);
        assert.equal(s.sounds.playSound, s.original);

        const t = setup();
        await quietHours.start!(t.ctx);
        const theirs = () => "theirs";
        t.sounds.playSound = theirs as typeof t.sounds.playSound;
        quietHours.stop!({} as EnginePluginContext);
        assert.equal(t.sounds.playSound, theirs);
    });

    it("lets the start fail, so it is reported, when Discord's sound module never shows up; and stopping without starting is harmless", async () => {
        const ctx = { finders: { byProps: () => ({ ready: () => Promise.reject(new Error("no sounds")) }) } } as unknown as EnginePluginContext;
        await assert.rejects(Promise.resolve(quietHours.start!(ctx)), /no sounds/);
        assert.doesNotThrow(() => quietHours.stop!({} as EnginePluginContext));
    });
});

describe("the manifests of the adapted plugins", () => {
    const read = (path: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "src", path, "plugin.json"), "utf8")) as Record<string, unknown>;

    for (const [path, origin, id] of [
        ["vencordplugins/DontRoundMyTimestamps", "vencord", "DontRoundMyTimestamps"], ["equicordplugins/NoNitroUpsell", "equicord", "NoNitroUpsell"],
        ["vencordplugins/StreamerModeOn", "vencord", "StreamerModeOn"], ["testcordplugins/QuietHours", "testcord", "QuietHours"]
    ] as const) {
        it(`${id}: off by default, no permissions, starts when Discord's code is ready, and credits the original`, () => {
            const manifest = read(path);
            assert.equal(manifest.id, id);
            assert.equal(manifest.origin, origin);
            assert.equal(manifest.enabledByDefault, false);
            assert.deepEqual(manifest.permissions, {});
            assert.equal(manifest.startAt, "webpackReady");
            assert.ok(Array.isArray(manifest.credits) && manifest.credits.length > 0, "adapted code must credit the original");
            assert.equal(manifest.license, "GPL-3.0-or-later");
        });
    }
});
