/*
 * Amiricord, a Discord client mod
 * Copyright (c) 2026 szlcx404 and Neversleeper
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PatchRegistry } from "../src/webpack/patchRegistry";
import { evaluateMainSignals, installWebpackHook, MainSignalInput, MainSignalReport } from "../src/webpack/webpackHook";

const good: MainSignalInput = {
    stack: "Error\n at https://canary.discord.com/assets/web.abc123.js:1:1",
    requireSource: "function n(e){var t=r[e];if(void 0!==t)return t.exports;var i=r[e]={exports:{}};return o[e](i,i.exports,n),i.exports}",
    bundlePath: "/assets/",
    chunkUrlSource: "e=>\"\"+({1:\"a\"}[e]||e)+\".\"+{1:\"x\"}[e]+\".js\""
};

const failing = (input: MainSignalInput) => evaluateMainSignals(input).signals.filter(s => !s.ok).map(s => s.name);

describe("evaluateMainSignals", () => {
    it("accepts the web app's bundle", () => {
        assert.equal(evaluateMainSignals(good).main, true);
    });

    it("rejects each kind of wrong bundle through its own signal", () => {
        assert.deepEqual(failing({ ...good, stack: "Error\n at file:///x/assets/web.js" }), ["script-url"]);
        assert.deepEqual(failing({ ...good, stack: "Error\n at https://x/assets/sentry.abc.js:1:1" }), ["known-file"]);
        assert.deepEqual(failing({ ...good, stack: "Error\n at https://x/other.js:1:1" }), ["known-file"]);
        assert.deepEqual(failing({ ...good, requireSource: "function(){}" }), ["require-shape"]);
        assert.deepEqual(failing({ ...good, bundlePath: "/other/" }), ["bundle-path"]);
        assert.deepEqual(failing({ ...good, chunkUrlSource: "" }), ["real-chunk-urls"]);
        assert.deepEqual(failing({ ...good, chunkUrlSource: "()=>\"\"" }), ["real-chunk-urls"]);
        assert.deepEqual(failing({ ...good, chunkUrlSource: "function(){return\"x\"}" }), ["real-chunk-urls"]);
    });
});

/** A function standing for `__webpack_require__`, with the hooked object as its prototype. */
function fakeBundle(target: object, shape = true) {
    // Function.prototype.toString.call reads the real source, so the text the signal looks for is written in the body.
    const wreq = (shape ? function () { return "exports:{}"; } : function () { return "other"; }) as unknown as Record<string, unknown>;
    Object.setPrototypeOf(wreq, target);
    return wreq;
}

// Function.prototype.toString.call reads the real source, so the bundle's text comes from this function.
const realChunkUrls = (e: string) => "" + e + "." + { 1: "x" }[1] + ".js";

function hook(stack: string) {
    const target = Object.create(Function.prototype) as object;
    const mains: unknown[] = [];
    const rejected: MainSignalReport[] = [];
    const stop = installWebpackHook({
        target,
        getStack: () => stack,
        wrapOptions: { registry: new PatchRegistry() },
        onMain: w => mains.push(w),
        onRejected: r => rejected.push(r)
    });
    return { target, mains, rejected, stop };
}

function boot(wreq: Record<string, unknown>, modules: object, path: unknown = "/assets/") {
    wreq.m = modules;
    wreq.u = realChunkUrls;
    wreq.p = path;
}

describe("installWebpackHook", () => {
    it("replaces the modules of the main instance with wrapped ones", () => {
        const { target, mains } = hook(good.stack);
        const original = { 1: () => 1 };
        const wreq = fakeBundle(target);
        boot(wreq, original);
        assert.equal(mains.length, 1);
        assert.notEqual(wreq.m, original);
        assert.equal(typeof (wreq.m as Record<string, unknown>)[1], "function");
    });

    it("leaves other bundles alone and reports why", () => {
        const { target, mains, rejected } = hook("Error\n at https://x/assets/sentry.js:1:1");
        const original = { 1: () => 1 };
        const wreq = fakeBundle(target);
        boot(wreq, original);
        assert.equal(mains.length, 0);
        assert.equal(rejected.length, 1);
        assert.deepEqual(rejected[0].signals.filter(s => !s.ok).map(s => s.name), ["known-file"]);
        assert.equal(wreq.m, original);
    });

    it("keeps working for the main instance after a rejected one", () => {
        const { target, mains } = hook(good.stack);
        boot(fakeBundle(target, false), { 1: () => 1 });
        boot(fakeBundle(target), { 2: () => 2 });
        assert.equal(mains.length, 1);
    });

    it("keeps ordinary assignments of `m` and `p` working on the instance", () => {
        const { target } = hook(good.stack);
        const wreq = fakeBundle(target);
        wreq.m = { a: 1 };
        wreq.p = "/x/";
        assert.equal(wreq.p, "/x/");
        assert.deepEqual(wreq.m, { a: 1 });
    });

    it("stops listening once the main instance is found", () => {
        const { target } = hook(good.stack);
        boot(fakeBundle(target), { 1: () => 1 });
        const another = fakeBundle(target);
        another.m = { a: 1 };
        assert.equal(Object.getOwnPropertyDescriptor(another, "p"), undefined);
    });

    it("stops listening when asked", () => {
        const { target, stop } = hook(good.stack);
        stop();
        const wreq = fakeBundle(target);
        wreq.m = { a: 1 };
        assert.equal(Object.getOwnPropertyDescriptor(wreq, "p"), undefined);
    });
});
