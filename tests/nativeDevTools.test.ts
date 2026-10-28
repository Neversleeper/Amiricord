/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerNativeCall, type NativeDevToolsApi, type NativeEvent, NativeHost, type NativeHostApi, type NativeResponse } from "../src/main/nativeHost";
import type { NativeWindow } from "../src/main/nativeWindow";

type Host = NativeHostApi & Partial<NativeDevToolsApi>;

function window(over: Partial<{ can: boolean; opens: boolean; throws: boolean; }> = {}) {
    const log = { cans: 0, opens: 0 };
    const fake: NativeWindow = {
        canOpenDevTools: () => { log.cans++; if (over.throws) throw new Error("no"); return over.can !== false; },
        openDevTools: () => { log.opens++; if (over.throws) throw new Error("no"); return over.opens !== false; }
    };
    return { fake, log };
}

function setup() {
    const events: NativeEvent[] = [];
    const seen: Host[] = [];
    const modules = {
        Dev: {
            probe: (host: Host) => { seen.push(host); return { can: typeof host.canOpenDevTools, open: typeof host.openDevTools }; },
            can: (host: Host) => host.canOpenDevTools!(),
            open: (host: Host) => host.openDevTools!(),
            keep: (host: Host) => { seen.push(host); return true; }
        },
        Plain: { probe: (host: Host) => ({ can: typeof host.canOpenDevTools, open: typeof host.openDevTools }) }
    };
    const host = new NativeHost({
        plugins: {
            Dev: { functions: ["probe", "can", "open", "keep"], hosts: [], devtools: true, load: () => modules.Dev },
            Plain: { functions: ["probe"], hosts: [], load: () => modules.Plain }
        },
        fetch: async () => ({ status: 200, ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "", json: async () => ({}) } as NativeResponse),
        onEvent: event => { events.push(event); },
        callTimeoutMs: 200
    });
    const call = (plugin: string, fn: string, win?: NativeWindow) => host.call({ plugin, fn, args: [] }, win);
    return { host, events, seen, call };
}

describe("the developer tools in the native host", () => {
    it("gives a plugin that declared the permission both functions, and a plugin that did not, neither, even when a window is passed", async () => {
        const t = setup();
        const win = window().fake;
        assert.deepEqual(await t.call("Dev", "probe", win), { ok: true, value: { can: "function", open: "function" } });
        assert.deepEqual(await t.call("Plain", "probe", win), { ok: true, value: { can: "undefined", open: "undefined" } });
    });

    it("asks the window that made the call whether it can open its tools", async () => {
        const t = setup();
        assert.deepEqual(await t.call("Dev", "can", window({ can: true }).fake), { ok: true, value: true });
        assert.deepEqual(await t.call("Dev", "can", window({ can: false }).fake), { ok: true, value: false });
        assert.equal(t.events.some(e => e.type === "devtools"), false, "only asking is not an event");
    });

    it("opens the tools of that window, answers whether they opened, and records it", async () => {
        const t = setup();
        const yes = window({ opens: true });
        assert.deepEqual(await t.call("Dev", "open", yes.fake), { ok: true, value: true });
        assert.equal(yes.log.opens, 1);
        const no = window({ opens: false });
        assert.deepEqual(await t.call("Dev", "open", no.fake), { ok: true, value: false });
        assert.deepEqual(t.events.filter(e => e.type === "devtools"), [
            { type: "devtools", plugin: "Dev", opened: true },
            { type: "devtools", plugin: "Dev", opened: false }
        ]);
    });

    it("answers false for both when the call came with no window", async () => {
        const t = setup();
        assert.deepEqual(await t.call("Dev", "can"), { ok: true, value: false });
        assert.deepEqual(await t.call("Dev", "open"), { ok: true, value: false });
        assert.deepEqual(t.events.filter(e => e.type === "devtools"), [{ type: "devtools", plugin: "Dev", opened: false }]);
    });

    it("answers false instead of failing when the window throws", async () => {
        const t = setup();
        const broken = window({ throws: true }).fake;
        assert.deepEqual(await t.call("Dev", "can", broken), { ok: true, value: false });
        assert.deepEqual(await t.call("Dev", "open", broken), { ok: true, value: false });
    });

    it("opens the tools of the window of EACH call, not of an earlier one", async () => {
        const t = setup();
        const first = window();
        const second = window();
        await t.call("Dev", "open", first.fake);
        await t.call("Dev", "open", second.fake);
        await t.call("Dev", "open", first.fake);
        assert.deepEqual([first.log.opens, second.log.opens], [2, 1]);
    });

    it("keeps the plugin's own host (its network and its secrets) the same for every call", async () => {
        const t = setup();
        await t.call("Dev", "keep", window().fake);
        await t.call("Dev", "keep", window().fake);
        assert.equal(typeof t.seen[0].fetch, "function", "it still has the network helper");
        assert.equal(typeof t.seen[0].secret, "function", "and the secrets");
        assert.equal(t.seen[0].fetch, t.seen[1].fetch);
        assert.equal(t.seen[0].secret, t.seen[1].secret);
        assert.notEqual(t.seen[0], t.seen[1], "the host with the tools is made again for each call");
    });

    it("only reaches the window through answerNativeCall for a page that is Discord's, and passes the window along", async () => {
        const t = setup();
        const win = window();
        const refused = await answerNativeCall(t.host, () => false, "https://evil.example", { plugin: "Dev", fn: "open", args: [] }, win.fake);
        assert.equal(refused.ok, false);
        assert.equal(win.log.opens, 0, "an untrusted caller never touches the window");
        const allowed = await answerNativeCall(t.host, () => true, "https://discord.com/app", { plugin: "Dev", fn: "open", args: [] }, win.fake);
        assert.deepEqual(allowed, { ok: true, value: true });
        assert.equal(win.log.opens, 1);
    });
});
