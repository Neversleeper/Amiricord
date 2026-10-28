/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { SettingsClient } from "../src/api/settingsClient";
import plugin from "../src/testcordplugins/MoreAlts/index";
import manifest from "../src/testcordplugins/MoreAlts/plugin.json";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const patch = plugin.patches![0] as { find: string; replacements: Array<{ match: RegExp; replace: string; }>; };
// Through the engine's own compiler, which understands `i` (any variable name) in the pattern.
const registered: RegisteredPatch = { ...plugin.patches![0], plugin: "MoreAlts" };

describe("MoreAlts", () => {
    // The shape of Discord's own account store in build 652418 (read from its public code, 2026-10-28), as a module function.
    const store = (limit: string) => `function(e,t,n){class h{static displayName="MultiAccountStore"}let f=new h(o.h,{CONNECTION_OPEN:function(e){let{user:t}=e;n.push({id:t.id}),(_=n).length>${limit}&&_.splice(${limit}).forEach(e=>{let{id:t}=e;E(t)})},LOGOUT:function(e){}})}`;

    it("looks for Discord's account store", () => {
        assert.equal(patch.find, "static displayName=\"MultiAccountStore\"");
        assert.ok(store("5").includes(patch.find));
        assert.equal(patch.replacements.length, 1);
    });

    it("replaces both fives of the limit, and only them", () => {
        const result = compileModule("1", store("5"), [registered]);
        assert.equal(result.outcomes[0].replacements[0].status, "applied");
        assert.match(result.code, /\(_=n\)\.length>[^&]*altLimit\(\)&&_\.splice\(.*?altLimit\(\)\)\.forEach\(e=>\{let\{id:t\}=e;E\(t\)\}\)\},LOGOUT/);
        assert.equal(result.code.split("altLimit()").length - 1, 2, "both places");
        assert.ok(!/length>5|splice\(5\)/.test(result.code), "no five is left");
    });

    it("leaves code alone when the limit is not the plain number five", () => {
        for (const limit of ["limit", "6", "50"]) {
            const result = compileModule("1", store(limit), [registered]);
            assert.ok(!result.code.includes("altLimit"), limit);
            assert.notEqual(result.outcomes[0]?.replacements[0]?.status, "applied", limit);
        }
    });

    afterEach(() => { plugin.settings!.unbind(); });

    it("gives the limit from the setting, default 10", () => {
        assert.equal(plugin.altLimit(), 10);
        plugin.settings!.bind(new SettingsClient({ schema: 1, plugins: { MoreAlts: { values: { amtOfAcounts: 25 } } } }, () => undefined), "MoreAlts");
        assert.equal(plugin.altLimit(), 25);
    });

    it("keeps the setting between 5 (Discord's own limit) and 100 whole accounts", () => {
        plugin.settings!.bind(new SettingsClient({ schema: 1, plugins: {} }, () => undefined), "MoreAlts");
        const store = (plugin.settings as unknown as { store: Record<string, number>; }).store;
        store.amtOfAcounts = 5;
        assert.equal(store.amtOfAcounts, 5);
        for (const bad of [0, 1, 4, -1, 101, 2.5]) assert.throws(() => { store.amtOfAcounts = bad; }, TypeError, String(bad));
    });

    it("declares a patch plugin that starts early and asks for nothing", () => {
        assert.equal(manifest.startAt, "init");
        assert.deepEqual(manifest.permissions, {});
        assert.equal(manifest.origin, "testcord");
    });
});
