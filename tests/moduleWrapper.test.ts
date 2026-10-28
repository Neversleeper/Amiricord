/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RegisteredPatch } from "../src/webpack/compileModule";
import { FactoryError, wrapModuleFactories, WrapOptions } from "../src/webpack/moduleWrapper";
import { PatchRegistry } from "../src/webpack/patchRegistry";

type Mod = { exports: Record<string, unknown>; };
type Factory = (m: Mod, e: Record<string, unknown>, r?: unknown) => unknown;

function setup(patches: RegisteredPatch[], extra: Partial<WrapOptions> = {}) {
    const registry = new PatchRegistry();
    patches.forEach(p => registry.add(p));
    const errors: FactoryError[] = [];
    const loaded: Array<[string, unknown]> = [];
    const options: WrapOptions = { registry, onError: e => errors.push(e), onModuleLoaded: (id, exp) => loaded.push([id, exp]), ...extra };
    return { registry, errors, loaded, options };
}

/** A factory whose source text is exactly `body`, as Discord's are. */
// The tests need functions built from text, like the patched modules the engine builds.
// eslint-disable-next-line no-new-func
const factory = (body: string) => new Function("e", "t", "r", body) as Factory;

const run = (modules: Record<string, unknown>, id: string): Mod => {
    const module: Mod = { exports: {} };
    (modules[id] as Factory)(module, module.exports, null);
    return module;
};

const swap = (find: string, replace: string, extra: Partial<RegisteredPatch> = {}): RegisteredPatch =>
    ({ plugin: "A", find, replacements: [{ match: find, replace }], ...extra });

describe("wrapModuleFactories", () => {
    it("runs a patched factory with Discord's own arguments", () => {
        const { options } = setup([swap("e.exports.v=1", "e.exports.v=2")]);
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.equal(run(wrapped, "1").exports.v, 2);
    });

    it("leaves a module alone when no patch targets it and reports it as loaded", () => {
        const { options, loaded } = setup([swap("never present", "x")]);
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.equal(run(wrapped, "1").exports.v, 1);
        assert.equal(loaded.length, 1);
        assert.equal(loaded[0][0], "1");
    });

    it("wraps modules added after the call", () => {
        const { options } = setup([swap("e.exports.v=1", "e.exports.v=3")]);
        const wrapped = wrapModuleFactories({}, options);
        wrapped[7] = factory("e.exports.v=1");
        assert.equal(run(wrapped, "7").exports.v, 3);
    });

    it("does not wrap twice and keeps values that are not functions", () => {
        const { options, loaded } = setup([]);
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1"), 2: "text" }, options);
        wrapped[1] = wrapped[1];
        assert.equal(wrapped[2], "text");
        run(wrapped, "1");
        assert.equal(loaded.length, 1);
    });

    it("still shows Discord's original source through toString", () => {
        const { options } = setup([swap("e.exports.v=1", "e.exports.v=2")]);
        const original = factory("e.exports.v=1");
        const text = Function.prototype.toString.call(original);
        const wrapped = wrapModuleFactories({ 1: original }, options);
        run(wrapped, "1");
        assert.equal(String(wrapped[1]), text);
    });

    it("stops inspecting modules once nothing is pending", () => {
        const { options, registry } = setup([swap("e.exports.v=1", "e.exports.v=2")]);
        let compiled = 0;
        const wrapped = wrapModuleFactories(
            { 1: factory("e.exports.v=1"), 2: factory("e.exports.w=1") },
            { ...options, onCompiled: () => { compiled++; } }
        );
        run(wrapped, "1");
        assert.equal(registry.hasPending(), false);
        run(wrapped, "2");
        assert.equal(compiled, 1);
    });

    it("falls back to the original and reports when the patched code cannot be evaluated", () => {
        const { options, errors } = setup([swap("e.exports.v=1", "e.exports.v=2")], { evaluate: () => { throw new SyntaxError("nope"); } });
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.equal(run(wrapped, "1").exports.v, 1);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].phase, "evaluate");
        assert.deepEqual(errors[0].plugins, ["A"]);
    });

    it("runs the original when a patched factory throws before touching its exports", () => {
        const { options, errors } = setup([swap("e.exports.v=1", "throw new Error('boom')")]);
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.equal(run(wrapped, "1").exports.v, 1);
        assert.equal(errors[0].phase, "run");
        assert.equal(errors[0].fellBack, true);
    });

    it("rethrows when the failed run already left something in the exports", () => {
        const { options, errors } = setup([swap("e.exports.w=1", "e.exports.w=1;throw new Error('late')")]);
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.w=1") }, options);
        assert.throws(() => run(wrapped, "1"), /late/);
        assert.equal(errors[0].fellBack, false);
    });

    it("rethrows an error of an unpatched module without claiming a fallback", () => {
        const { options, errors } = setup([]);
        const wrapped = wrapModuleFactories({ 1: factory("throw new Error('discord')") }, options);
        assert.throws(() => run(wrapped, "1"), /discord/);
        assert.equal(errors[0].fellBack, false);
    });

    it("does not fall back when the option is off", () => {
        const { options } = setup([swap("e.exports.v=1", "throw new Error('boom')")], { fallbackToOriginal: false });
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.throws(() => run(wrapped, "1"), /boom/);
    });

    it("survives a listener that throws", () => {
        const { options } = setup([], { onModuleLoaded: () => { throw new Error("listener"); } });
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.equal(run(wrapped, "1").exports.v, 1);
    });

    it("passes the build number to the compiler", () => {
        const { options } = setup([swap("e.exports.v=1", "e.exports.v=2", { discord: { minBuild: 500 } })], { getBuild: () => 100 });
        const wrapped = wrapModuleFactories({ 1: factory("e.exports.v=1") }, options);
        assert.equal(run(wrapped, "1").exports.v, 1);
    });
});
