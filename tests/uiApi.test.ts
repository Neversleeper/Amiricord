/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import questify from "../src/equicordplugins/Questify/index";
import uiApi from "../src/plugins/UiApi/index";
import { compileModule, type RegisteredPatch } from "../src/webpack/compileModule";

const serverListPatch: RegisteredPatch = { ...uiApi.patches![1], plugin: "UiApi" };
const questifyPatch = (questify.patches as RegisteredPatch[]).find(patch => String(patch.find).includes("guildDiscoveryButton"));

// The scroll area of Discord's server list in build 653945, cut down.
const listModule = `function(e,t,n){function i2(e){let{scrollToTop:n,lurkingGuildIds:i}=e;return null}function i3(e){let{guildDiscoveryButton:t}=e;return null}function Z(){return(0,r.jsxs)(g.Ch,{children:[(0,r.jsx)(i2,{scrollToTop:Z,lurkingGuildIds:A}),(0,r.jsx)(nD,{}),(0,r.jsx)(i3,{guildDiscoveryButton:ee,disableAppDownload:n,isOverlay:i,renderTreeNode:Q,lurkingGuildIds:A})]})}}`;

describe("UiApi server list patch", () => {
    it("adds the 'in' and 'below' places to the plain list", () => {
        const result = compileModule("1", listModule, [serverListPatch]);
        assert.equal(result.code.split("renderServerList(\"in\")").length - 1, 1);
        assert.equal(result.code.split("renderServerList(\"below\")").length - 1, 1);
    });

    it("still adds the 'in' place after Questify has wrapped the element that follows the separator (build 653945: it did not)", () => {
        assert.ok(questifyPatch, "Questify has a patch on the server list");
        const result = compileModule("1", listModule, [questifyPatch!, serverListPatch]);
        assert.ok(result.code.includes("__amiricordOriginal:i3"), "Questify's change is there");
        assert.equal(result.code.split("renderServerList(\"in\")").length - 1, 1);
        assert.equal(result.code.split("renderServerList(\"below\")").length - 1, 1);
        assert.ok(!result.outcomes.some(outcome => outcome.replacements.some(replacement => replacement.status !== "applied")));
    });

    const real = "probe/module-source-684770.json";
    it("takes both places in the real server list module of build 653945, with and without Questify, and still parses (only when the probe dump is on this machine)", { skip: !existsSync(real) }, () => {
        const { id, text } = JSON.parse(readFileSync(real, "utf8")) as { id: string; text: string; };
        for (const patches of [[serverListPatch], [questifyPatch!, serverListPatch]]) {
            const result = compileModule(id, text, patches);
            assert.equal(result.code.split("renderServerList(\"in\")").length - 1, 1);
            assert.equal(result.code.split("renderServerList(\"below\")").length - 1, 1);
        }
    });
});
