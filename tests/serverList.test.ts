/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildServerList, createServerListHub, MAX_SERVER_LIST_ELEMENTS_PER_PLUGIN } from "../src/api/serverList";

const make = (component: unknown, key: string, plugin: string) => ({ component, key, plugin });
const A = () => null;
const B = () => null;
const C = () => null;

describe("elements in the server list", () => {
    it("gives the elements of one place, highest priority first and then in the order they were added", () => {
        const hub = createServerListHub();
        hub.add("P", "above", A, 0);
        hub.add("Q", "above", B, 5);
        hub.add("P", "below", C, 0);
        hub.add("Q", "above", C, 0);
        const above = hub.render("above", make) as ReturnType<typeof make>[];
        assert.deepEqual(above.map(entry => entry.component), [B, A, C]);
        assert.deepEqual(above.map(entry => entry.plugin), ["Q", "P", "Q"]);
        assert.equal(new Set(above.map(entry => entry.key)).size, 3, "every element has its own key");
        assert.equal((hub.render("below", make) as unknown[]).length, 1);
        assert.deepEqual(hub.render("in", make), []);
    });

    it("refuses a bad place or something that is not a component, and adds the same element once", () => {
        const hub = createServerListHub();
        assert.equal(hub.add("P", "left" as never, A, 0), false);
        assert.equal(hub.add("P", "above", "text" as never, 0), false);
        assert.equal(hub.add("P", "above", A, 0), true);
        assert.equal(hub.add("P", "above", A, 0), true);
        assert.equal((hub.render("above", make) as unknown[]).length, 1);
    });

    it("limits what one plugin may add", () => {
        const hub = createServerListHub();
        for (let i = 0; i < MAX_SERVER_LIST_ELEMENTS_PER_PLUGIN; i++) assert.equal(hub.add("P", "in", () => null, 0), true);
        assert.equal(hub.add("P", "in", () => null, 0), false);
        assert.equal(hub.add("Q", "in", () => null, 0), true, "another plugin has its own allowance");
    });

    it("takes a plugin's elements back when it stops, and draws nothing if making an element fails", () => {
        const hub = createServerListHub();
        let dispose = () => undefined as void;
        const plugin = buildServerList(hub, "P", callback => { dispose = callback; });
        plugin.add("above", A);
        assert.equal((hub.render("above", make) as unknown[]).length, 1);
        assert.deepEqual(hub.render("above", () => { throw new Error("no React"); }), []);
        dispose();
        assert.deepEqual(hub.render("above", make), []);
    });

    it("tells the listeners when something is added or taken back, so the list can be drawn again without a restart", () => {
        const hub = createServerListHub();
        let calls = 0;
        const stop = hub.subscribe(() => { calls++; });
        const first = hub.version();
        hub.add("P", "above", A, 0);
        hub.add("P", "above", A, 0);
        assert.equal(calls, 1, "adding the same element twice changes nothing");
        assert.notEqual(hub.version(), first);
        hub.removeAll("Q");
        assert.equal(calls, 1, "taking back from a plugin with nothing changes nothing");
        hub.removeAll("P");
        assert.equal(calls, 2);
        stop();
        hub.add("P", "below", B, 0);
        assert.equal(calls, 2, "a listener that stopped is not called");
    });
});
