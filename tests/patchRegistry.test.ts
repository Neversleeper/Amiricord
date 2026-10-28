/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RegisteredPatch } from "../src/webpack/compileModule";
import { PatchRegistry } from "../src/webpack/patchRegistry";

const source = (body: string) => `function(e,t){${body}}`;
const patch = (plugin: string, find: string, extra: Partial<RegisteredPatch> = {}): RegisteredPatch =>
    ({ plugin, find, replacements: [{ match: find, replace: find + "+1" }], ...extra });

describe("PatchRegistry", () => {
    it("consumes a patch with the first module that contains it", () => {
        const registry = new PatchRegistry();
        registry.add(patch("A", "t.a=1"));
        assert.equal(registry.hasPending(), true);

        const first = registry.compile("1", source("t.a=1"));
        assert.equal(first.changed, true);
        assert.equal(registry.hasPending(), false);

        const second = registry.compile("2", source("t.a=1"));
        assert.equal(second.changed, false);
    });

    it("keeps a patch marked all for every module", () => {
        const registry = new PatchRegistry();
        registry.add(patch("A", "t.a=1", { all: true }));
        assert.equal(registry.compile("1", source("t.a=1")).changed, true);
        assert.equal(registry.hasPending(), true);
        assert.equal(registry.compile("2", source("t.a=1")).changed, true);
    });

    it("keeps a patch waiting while no module contains it", () => {
        const registry = new PatchRegistry();
        registry.add(patch("A", "t.zzz=1"));
        registry.compile("1", source("t.a=1"));
        assert.equal(registry.hasPending(), true);
        assert.deepEqual(registry.neverMatched().map(p => p.plugin), ["A"]);
    });

    it("counts a patch that found its module but did nothing as matched", () => {
        const registry = new PatchRegistry();
        registry.add({ plugin: "A", find: "t.a=1", replacements: [{ match: "nothing here", replace: "x" }] });
        registry.compile("1", source("t.a=1"));
        assert.deepEqual(registry.neverMatched(), []);
        assert.equal(registry.hasPending(), false);
    });

    it("consumes a patch skipped by the build range and does not report it as never matched", () => {
        const registry = new PatchRegistry();
        registry.add(patch("A", "t.a=1", { discord: { minBuild: 500 } }));
        const result = registry.compile("1", source("t.a=1"), { build: 100 });
        assert.equal(result.changed, false);
        assert.equal(registry.hasPending(), false);
        assert.deepEqual(registry.neverMatched(), []);
    });

    it("maps the outcomes of later patches to the right entry when earlier ones are already consumed", () => {
        const registry = new PatchRegistry();
        registry.add(patch("A", "t.a=1"));
        registry.add(patch("B", "t.b=1"));
        registry.compile("1", source("t.a=1"));
        registry.compile("2", source("t.b=1"));
        assert.deepEqual(registry.neverMatched(), []);
        assert.equal(registry.hasPending(), false);
    });

    it("removes the patches of one plugin", () => {
        const registry = new PatchRegistry();
        registry.add(patch("A", "t.a=1"));
        registry.add(patch("B", "t.b=1"));
        assert.equal(registry.removeByPlugin("A"), 1);
        assert.equal(registry.compile("1", source("t.a=1")).changed, false);
        assert.equal(registry.compile("2", source("t.b=1")).changed, true);
    });
});
