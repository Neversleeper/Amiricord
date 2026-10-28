/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Wave 2 of the plugins adapted from TestCord's `testcordplugins`: the first ones with logic (LazyMessageRender, UniversalVolume,
// MessageNitroBadge, WebRTCLeakPrevent). Each one runs with a fake context, so what is checked is what the plugin does with Discord's objects.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SettingsClient } from "../src/api/settingsClient";
import { refuseCss } from "../src/api/styles";
import type { EnginePluginContext, PluginCode } from "../src/renderer/engine";
import lazyMessageRender, { buildCss, selectorOf } from "../src/testcordplugins/LazyMessageRender/index";
import messageNitroBadge, { overrideExperiment } from "../src/testcordplugins/MessageNitroBadge/index";
import universalVolume, { levelChannel } from "../src/testcordplugins/UniversalVolume/index";
import webRtc, { type Connection, createPatchedConnection, patchConnections } from "../src/testcordplugins/WebRTCLeakPrevent/index";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));

function lateFinder<T>() {
    let resolveValue: (value: T) => void = () => undefined;
    const promise = new Promise<T>(resolve => { resolveValue = resolve; });
    return { finder: { ready: () => promise }, answer: (value: T) => resolveValue(value) };
}

function bind(plugin: PluginCode, id: string, values: Record<string, unknown> = {}) {
    plugin.settings!.unbind();
    const client = new SettingsClient({ schema: 1, plugins: { [id]: { values } } } as never, () => undefined);
    plugin.settings!.bind(client, id);
}

describe("manifests of wave 2", () => {
    for (const id of ["LazyMessageRender", "UniversalVolume", "MessageNitroBadge", "WebRTCLeakPrevent"]) {
        it(`${id}: off by default, no permissions, credits kept`, () => {
            const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "src", "testcordplugins", id, "plugin.json"), "utf8"));
            assert.equal(manifest.id, id);
            assert.equal(manifest.enabledByDefault, false);
            assert.deepEqual(manifest.permissions, {});
            assert.equal(manifest.origin, "testcord");
            assert.equal(manifest.license, "GPL-3.0-or-later");
            assert.ok(manifest.authors[0].name.length > 0);
            assert.ok(manifest.credits[0].name.includes(manifest.authors[0].name));
        });
    }
});

describe("LazyMessageRender", () => {
    it("turns Discord's class value into a selector and refuses anything that is not plain class names", () => {
        assert.equal(selectorOf("row_ab1"), ".row_ab1");
        assert.equal(selectorOf(" a  b-2 "), ".a.b-2");
        for (const bad of ["", "a{b}", "a b;", "a>b", "a.b", 3, null, undefined]) assert.equal(selectorOf(bad), undefined, String(bad));
    });

    it("builds the style with the row selector in every rule and passes the style rules", () => {
        const css = buildCss("row_ab1")!;
        assert.equal(refuseCss(css), undefined);
        assert.match(css, /^\.row_ab1:hover,\n\.row_ab1:focus-within \{\n    position: relative;\n    z-index: 2;\n\}/);
        assert.match(css, /\.row_ab1:hover \+ \.row_ab1,/);
        assert.match(css, /\.row_ab1:has\(\+ \.row_ab1:focus-within\) \{\n    z-index: 1;/);
        assert.equal(buildCss("bad{}"), undefined);
    });

    it("asks for messageListItem and adds the style once", async () => {
        const added: string[] = [];
        const asked: string[][] = [];
        const ctx = {
            addStyle: (css: string) => { added.push(css); },
            finders: { byProps: (...props: string[]) => { asked.push(props); return { ready: () => Promise.resolve({ messageListItem: "row_ab1" }) }; } }
        } as unknown as EnginePluginContext;
        await lazyMessageRender.start!(ctx);
        assert.deepEqual(asked, [["messageListItem"]]);
        assert.equal(added.length, 1);
        assert.match(added[0], /^\.row_ab1:hover/);
    });

    it("fails the start and adds nothing when Discord gives no usable name", async () => {
        const added: string[] = [];
        const ctx = {
            addStyle: (css: string) => { added.push(css); },
            finders: { byProps: () => ({ ready: () => Promise.resolve({ messageListItem: "x y{" }) }) }
        } as unknown as EnginePluginContext;
        await assert.rejects(Promise.resolve(lazyMessageRender.start!(ctx)), /message row/);
        assert.equal(added.length, 0);
    });
});

describe("UniversalVolume", () => {
    function setup(values: Record<string, unknown> = {}) {
        bind(universalVolume, "UniversalVolume", values);
        const calls: Array<[string, number]> = [];
        const state = { channel: "c1" as string | null, states: { me: { userId: "me" }, a: { userId: "a" }, b: { userId: "b" } } as Record<string, { userId: string; }> | null };
        const reported: string[] = [];
        const disposers: Array<() => void> = [];
        const volume = { setLocalVolume: (id: string, v: number) => { calls.push([id, v]); } };
        const ctx = {
            finders: { byProps: (...props: string[]) => { asked.push(props); return { ready: () => Promise.resolve(volume) }; } },
            common: {
                VoiceStateStore: { ready: () => Promise.resolve({ getVoiceStatesForChannel: (_c: string) => state.states }) },
                SelectedChannelStore: { ready: () => Promise.resolve({ getVoiceChannelId: () => state.channel }) },
                UserStore: { ready: () => Promise.resolve({ getCurrentUser: () => ({ id: "me" }) }) }
            },
            onDispose: (undo: () => void) => { disposers.push(undo); },
            reportError: (source: string) => { reported.push(source); }
        } as unknown as EnginePluginContext;
        const asked: string[][] = [];
        return { ctx, calls, state, reported, disposers, asked, volume };
    }

    beforeEach(() => { universalVolume.stop!({} as EnginePluginContext); });

    it("sets everyone but you to the chosen volume when it starts, once each", async () => {
        const s = setup();
        await universalVolume.start!(s.ctx);
        assert.deepEqual(s.asked, [["setLocalVolume", "toggleLocalMute"]]);
        assert.deepEqual(s.calls, [["a", 100], ["b", 100]]);
        levelChannel();
        assert.equal(s.calls.length, 2, "nobody is set twice");
    });

    it("sets a person who joins later, and starts again when you change channel", async () => {
        const s = setup({ targetVolume: 50 });
        await universalVolume.start!(s.ctx);
        s.state.states!.c = { userId: "c" };
        const handler = universalVolume.flux!.VOICE_STATE_UPDATES as unknown as () => void;
        handler();
        assert.deepEqual(s.calls.slice(2), [["c", 50]]);
        s.state.channel = "c2";
        handler();
        assert.deepEqual(s.calls.slice(3).map(c => c[0]), ["a", "b", "c"]);
    });

    it("does nothing when you are not in a voice channel or the channel has no states", async () => {
        const s = setup();
        s.state.channel = null;
        await universalVolume.start!(s.ctx);
        assert.equal(s.calls.length, 0);
        s.state.channel = "c1";
        s.state.states = null;
        levelChannel();
        assert.equal(s.calls.length, 0);
    });

    it("sets everyone again when the volume setting changes", async () => {
        const s = setup();
        await universalVolume.start!(s.ctx);
        (universalVolume as unknown as { settings: { store: { targetVolume: number; }; }; }).settings.store.targetVolume = 150;
        assert.deepEqual(s.calls.slice(2), [["a", 150], ["b", 150]]);
    });

    it("refuses a volume outside 0 to 200", async () => {
        const s = setup();
        await universalVolume.start!(s.ctx);
        const store = (universalVolume as unknown as { settings: { store: { targetVolume: number; }; }; }).settings.store;
        assert.throws(() => { store.targetVolume = 201; });
        assert.throws(() => { store.targetVolume = -1; });
        assert.equal(store.targetVolume, 100);
    });

    it("reports a failing volume function and goes on with the next person", async () => {
        const s = setup();
        s.volume.setLocalVolume = (id: string, v: number) => { if (id === "a") throw new Error("boom"); s.calls.push([id, v]); };
        await universalVolume.start!(s.ctx);
        assert.deepEqual(s.reported, ["setLocalVolume"]);
        assert.deepEqual(s.calls, [["b", 100]]);
    });

    it("does nothing after a stop, even if a late event arrives or Discord's objects show up late", async () => {
        const s = setup();
        await universalVolume.start!(s.ctx);
        universalVolume.stop!(s.ctx);
        s.calls.length = 0;
        levelChannel();
        assert.equal(s.calls.length, 0);

        const late = lateFinder<unknown>();
        const calls: unknown[] = [];
        const ctx = {
            finders: { byProps: () => late.finder },
            common: {
                VoiceStateStore: { ready: () => Promise.resolve({ getVoiceStatesForChannel: () => ({ a: { userId: "a" } }) }) },
                SelectedChannelStore: { ready: () => Promise.resolve({ getVoiceChannelId: () => "c1" }) },
                UserStore: { ready: () => Promise.resolve({ getCurrentUser: () => ({ id: "me" }) }) }
            },
            onDispose: () => undefined,
            reportError: () => undefined
        } as unknown as EnginePluginContext;
        const started = universalVolume.start!(ctx);
        universalVolume.stop!(ctx);
        late.answer({ setLocalVolume: (...args: unknown[]) => { calls.push(args); } });
        await started;
        await tick();
        levelChannel();
        assert.deepEqual(calls, []);
    });
});

describe("MessageNitroBadge", () => {
    function setup(values: Record<string, unknown> = {}, late = lateFinder<{ dispatch(action: unknown): void; }>()) {
        bind(messageNitroBadge, "MessageNitroBadge", values);
        const sent: unknown[] = [];
        const asked: string[][] = [];
        const ctx = { finders: { byProps: (...props: string[]) => { asked.push(props); return late.finder; } } } as unknown as EnginePluginContext;
        late.answer({ dispatch: (action: unknown) => { sent.push(action); } });
        return { ctx, sent, asked, late };
    }
    const action = (bucket: number | null) => ({ type: "EXPERIMENT_OVERRIDE_BUCKET", experimentId: "2023-10_social_proofing_message_nitro_badge", experimentBucket: bucket });

    beforeEach(() => { messageNitroBadge.stop!({} as EnginePluginContext); });

    it("sends the chosen treatment on start and puts the experiment back on stop", async () => {
        const s = setup();
        await messageNitroBadge.start!(s.ctx);
        assert.deepEqual(s.asked, [["dispatch", "subscribe"]]);
        assert.deepEqual(s.sent, [action(1)]);
        messageNitroBadge.stop!(s.ctx);
        assert.deepEqual(s.sent, [action(1), action(null)]);
        messageNitroBadge.stop!(s.ctx);
        assert.equal(s.sent.length, 2, "a second stop sends nothing");
    });

    it("uses treatment 2 when that is the saved choice", async () => {
        const s = setup({ experimentTreatment: "2" });
        await messageNitroBadge.start!(s.ctx);
        assert.deepEqual(s.sent, [action(2)]);
    });

    it("sends nothing when it is stopped before the dispatcher shows up", async () => {
        bind(messageNitroBadge, "MessageNitroBadge");
        const late = lateFinder<{ dispatch(action: unknown): void; }>();
        const sent: unknown[] = [];
        const ctx = { finders: { byProps: () => late.finder } } as unknown as EnginePluginContext;
        const started = messageNitroBadge.start!(ctx);
        messageNitroBadge.stop!(ctx);
        late.answer({ dispatch: (a: unknown) => { sent.push(a); } });
        await started;
        assert.deepEqual(sent, []);
    });

    it("overrideExperiment sends one override with the bucket given", () => {
        const sent: unknown[] = [];
        overrideExperiment({ dispatch: a => { sent.push(a); } }, 2);
        assert.deepEqual(sent, [action(2)]);
    });

    it("refuses a treatment that is not 1 or 2", () => {
        bind(messageNitroBadge, "MessageNitroBadge", { experimentTreatment: "9" });
        const store = (messageNitroBadge as unknown as { settings: { store: { experimentTreatment: string; }; }; }).settings.store;
        assert.equal(store.experimentTreatment, "1", "a saved value that does not fit gives the default");
    });
});

describe("WebRTCLeakPrevent", () => {
    /** A stand-in for the browser's constructor that remembers the configuration it was given. */
    class FakeConnection {
        config: Record<string, unknown>;
        constructor(configuration?: Record<string, unknown>) { this.config = { ...configuration }; }
        getConfiguration() { return this.config; }
        setConfiguration(configuration: Record<string, unknown>) { this.config = { ...configuration }; }
    }
    const Fake = FakeConnection as unknown as Connection;
    const global = globalThis as unknown as { RTCPeerConnection?: unknown; webkitRTCPeerConnection?: unknown; };
    let saved: { rtc: unknown; webkit: unknown; };

    beforeEach(() => { saved = { rtc: global.RTCPeerConnection, webkit: global.webkitRTCPeerConnection }; webRtc.stop!({} as EnginePluginContext); });
    afterEach(() => {
        if (saved.rtc === undefined) delete global.RTCPeerConnection; else global.RTCPeerConnection = saved.rtc;
        if (saved.webkit === undefined) delete global.webkitRTCPeerConnection; else global.webkitRTCPeerConnection = saved.webkit;
    });

    it("forces the policy on a new connection and keeps the rest of Discord's configuration", () => {
        const Patched = createPatchedConnection(Fake, "relay");
        const connection = new Patched({ iceServers: [{ urls: "x" }], iceTransportPolicy: "all" }) as unknown as FakeConnection;
        assert.deepEqual(connection.config, { iceServers: [{ urls: "x" }], iceTransportPolicy: "relay" });
        assert.deepEqual((new Patched() as unknown as FakeConnection).config, { iceTransportPolicy: "relay" });
        assert.ok(new Patched() instanceof FakeConnection);
    });

    it("forces the policy back when Discord changes the configuration later, and says so in the log", () => {
        const lines: string[] = [];
        const Patched = createPatchedConnection(Fake, "relay", (...args) => lines.push(args.join(" ")));
        const connection = new Patched({}) as unknown as FakeConnection;
        connection.setConfiguration({ iceTransportPolicy: "all", bundlePolicy: "max-bundle" });
        assert.deepEqual(connection.config, { iceTransportPolicy: "relay", bundlePolicy: "max-bundle" });
        assert.equal(lines.length, 2);
        assert.match(lines[0], /created - ICE policy: relay/);
        assert.match(lines[1], /tried to change the ICE policy to all; forcing relay/);
        connection.setConfiguration({ iceTransportPolicy: "relay" });
        assert.equal(lines.length, 2, "no line when Discord asks for the same policy");
    });

    it("replaces both constructors on the target and puts them back, only if they are still ours", () => {
        class Other extends FakeConnection { }
        const target: { RTCPeerConnection?: Connection; webkitRTCPeerConnection?: Connection; } = { RTCPeerConnection: Fake, webkitRTCPeerConnection: Other as unknown as Connection };
        const restore = patchConnections(target, "relay")!;
        assert.notEqual(target.RTCPeerConnection, Fake);
        assert.notEqual(target.webkitRTCPeerConnection, Other);
        const second = target.webkitRTCPeerConnection;
        const somebodyElse = class extends FakeConnection { } as unknown as Connection;
        target.RTCPeerConnection = somebodyElse;
        restore();
        assert.equal(target.RTCPeerConnection, somebodyElse, "a constructor wrapped by somebody else is left alone");
        assert.equal(target.webkitRTCPeerConnection, Other);
        assert.notEqual(second, Other);
    });

    it("returns nothing when the target has no constructor", () => {
        assert.equal(patchConnections({}, "relay"), undefined);
    });

    it("on start with relay it patches the page and on stop it puts the constructor back", () => {
        global.RTCPeerConnection = Fake;
        delete global.webkitRTCPeerConnection;
        bind(webRtc, "WebRTCLeakPrevent");
        webRtc.start!({} as EnginePluginContext);
        assert.notEqual(global.RTCPeerConnection, Fake);
        assert.equal(((new (global.RTCPeerConnection as Connection)({ iceTransportPolicy: "all" })) as unknown as FakeConnection).config.iceTransportPolicy, "relay");
        webRtc.stop!({} as EnginePluginContext);
        assert.equal(global.RTCPeerConnection, Fake);
    });

    it("does not touch the page when the policy is public", () => {
        global.RTCPeerConnection = Fake;
        bind(webRtc, "WebRTCLeakPrevent", { icePolicy: "all" });
        webRtc.start!({} as EnginePluginContext);
        assert.equal(global.RTCPeerConnection, Fake);
        webRtc.stop!({} as EnginePluginContext);
        assert.equal(global.RTCPeerConnection, Fake);
    });

    it("fails the start when the page has no connection constructor", () => {
        delete global.RTCPeerConnection;
        delete global.webkitRTCPeerConnection;
        bind(webRtc, "WebRTCLeakPrevent");
        assert.throws(() => webRtc.start!({} as EnginePluginContext), /no RTCPeerConnection/);
    });

    it("writes log lines to the console only when the log setting is on", () => {
        global.RTCPeerConnection = Fake;
        const lines: unknown[][] = [];
        const original = console.info;
        console.info = (...args: unknown[]) => { lines.push(args); };
        try {
            bind(webRtc, "WebRTCLeakPrevent");
            webRtc.start!({} as EnginePluginContext);
            webRtc.stop!({} as EnginePluginContext);
            assert.equal(lines.length, 0);
            bind(webRtc, "WebRTCLeakPrevent", { enableLogs: true });
            webRtc.start!({} as EnginePluginContext);
            webRtc.stop!({} as EnginePluginContext);
            assert.ok(lines.length >= 1);
            assert.equal(lines[0][0], "[WebRTCLeakPrevent]");
        } finally { console.info = original; }
    });
});
