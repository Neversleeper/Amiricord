/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { SettingsClient } from "../src/api/settingsClient";
import plugin from "../src/testcordplugins/MoreAlts/index";
import manifest from "../src/testcordplugins/MoreAlts/plugin.json";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const patch = plugin.patches![0] as { find: string; replacements: Array<{ match: RegExp; replace: string; }>; };
// Through the engine's own compiler, which understands `i` (any variable name) in the pattern.
const registered: RegisteredPatch = { ...plugin.patches![0], plugin: "MoreAlts" };
const registeredWindow: RegisteredPatch = { ...plugin.patches![1], plugin: "MoreAlts" };

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

    const real = "probe/module-source-274303.json";
    it("takes the patch in the real account store of build 653945 and still parses (only when the probe dump is on this machine)", { skip: !existsSync(real) }, () => {
        const { id, text } = JSON.parse(readFileSync(real, "utf8")) as { id: string; text: string; };
        const result = compileModule(id, text, [registered]);
        assert.equal(result.outcomes[0].replacements[0].status, "applied");
        assert.equal(result.code.split("altLimit()").length - 1, 2);
        assert.ok(!/length>5|splice(5)/.test(result.code));
    });

    // The shape of Discord's "Manage Accounts" window in build 653945, cut down: the three places where it checks the limit.
    const windowModule = (button: string, effect: string, message: string) => `function(e,t,s){function A(e){let{multiAccountUsers:x}=e,[C,U]=i.useState(!1);return i.useEffect(()=>{if(C)N(g.intl.format(g.t.HAuRSM,{${message}}));else U(!1)},[b,C]),i.useEffect(()=>{${effect}},[x]),jsx(l.a,{actions:[{onClick:()=>{${button}}}]})}}`;
    const windowOf = (limit: string) => windowModule(`x.length>=${limit}?U(!0):(s(),(0,f.D)())`, `x.length<${limit}&&U(!1)`, `maxNumAccounts:${limit}`);

    it("looks for the window by the number it names, and takes all three places as a group that is lazy and optional", () => {
        const second = plugin.patches![1] as { find: string; group?: boolean; lazy?: boolean; required?: boolean; replacements: unknown[]; };
        assert.equal(second.find, "maxNumAccounts:5");
        assert.ok(windowOf("5").includes(second.find));
        assert.equal(second.group, true);
        assert.equal(second.lazy, true);
        assert.equal(second.required, false);
        assert.equal(second.replacements.length, 3);
    });

    it("turns the three fives of the window into the setting, and only them", () => {
        const result = compileModule("1", windowOf("5"), [registeredWindow]);
        assert.equal(result.outcomes[0].status, "applied");
        assert.equal(result.code.split("altLimit()").length - 1, 3);
        assert.match(result.code, /x\.length>=[^?]*altLimit\(\)\?U\(!0\):/);
        assert.match(result.code, /x\.length<[^&]*altLimit\(\)&&U\(!1\)/);
        assert.match(result.code, /maxNumAccounts:[^}]*altLimit\(\)\}/);
        assert.ok(!/length>=5|length<5|maxNumAccounts:5/.test(result.code), "no five is left");
        assert.ok(result.code.includes("i.useState(!1)"), "other numbers stay");
    });

    it("changes none of them when one of the three is not as expected (the button and the notice must agree)", () => {
        const odd = windowModule("x.length>=5?U(!0):(s(),(0,f.D)())", "x.length<=5&&U(!1)", "maxNumAccounts:5");
        const result = compileModule("1", odd, [registeredWindow]);
        assert.equal(result.code.includes("altLimit"), false);
        assert.notEqual(result.outcomes[0].status, "applied");
    });

    const realWindow = "probe/module-source-623161.json";
    it("takes the window patch in the real Manage Accounts module of build 653945 and still parses (only when the probe dump is on this machine)", { skip: !existsSync(realWindow) }, () => {
        const { id, text } = JSON.parse(readFileSync(realWindow, "utf8")) as { id: string; text: string; };
        const result = compileModule(id, text, [registeredWindow]);
        assert.equal(result.outcomes[0].status, "applied");
        assert.equal(result.code.split("altLimit()").length - 1, 3);
        assert.ok(!/length>=5|length<5|maxNumAccounts:5/.test(result.code));
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

    // The list of accounts in the profile panel (build 653945), cut down: Discord's menu with one row per account and "Manage Accounts" last.
    const registeredList: RegisteredPatch = { ...plugin.patches![2], plugin: "MoreAlts" };
    const listModule = `function(e,t,n){return(0,i.jsx)(eU,{navId:"switch-accounts-submenu","aria-label":"Switch accounts",onClose:t,children:D})}`;

    it("gives the list of accounts in the profile panel a class of ours, and only that menu", () => {
        const third = plugin.patches![2] as { find: string; lazy?: boolean; required?: boolean; };
        assert.equal(third.find, "navId:\"switch-accounts-submenu\"");
        assert.equal(third.lazy, true);
        assert.equal(third.required, false);
        const result = compileModule("1", listModule, [registeredList]);
        assert.equal(result.outcomes[0].status, "applied");
        assert.ok(result.code.includes("navId:\"switch-accounts-submenu\",className:\"amiricord-account-list\",\"aria-label\""));
        assert.equal(result.code.split("amiricord-account-list").length - 1, 1);
        const other = compileModule("1", listModule.replace("switch-accounts-submenu", "set-status-submenu"), [registeredList]);
        assert.ok(!other.code.includes("amiricord-account-list"));
    });

    it("adds the style that makes that list scroll", () => {
        const styles: Array<{ css: string; name?: string; }> = [];
        plugin.start!({ addStyle: (css: string, name?: string) => { styles.push({ css, name }); return { update() {}, remove() {} }; } } as never);
        assert.equal(styles.length, 1);
        assert.match(styles[0].css, /^\.amiricord-account-list\{[^}]*max-height:[^}]*overflow-y:auto/);
    });

    const realList = "probe/module-search-switcher.json";
    it("finds the menu in the real code of build 653945 once, with no class of Discord's on it (only when the probe dump is on this machine)", { skip: !existsSync(realList) }, () => {
        const dump = JSON.parse(readFileSync(realList, "utf8")) as { hits: Record<string, Array<{ snippet: string; }>>; };
        const snippet = dump.hits["switch-accounts-submenu"][0].snippet;
        const match = (plugin.patches![2] as { replacements: Array<{ match: RegExp; }>; }).replacements[0].match;
        assert.equal(snippet.split("navId:\"switch-accounts-submenu\",").length - 1, 1);
        assert.ok(match.test(snippet));
        assert.ok(!/navId:"switch-accounts-submenu",className:/.test(snippet));
    });

    it("declares a patch plugin that starts early and asks for nothing", () => {
        assert.equal(manifest.startAt, "init");
        assert.deepEqual(manifest.permissions, {});
        assert.equal(manifest.origin, "testcord");
    });
});
